// Fila de pedidos em ARQUIVOS num volume compartilhado (EFS no Kubernetes): vários pods de API gravam pedidos e
// vários pods de trabalhador (api/trabalhador.js) processam, sem banco nem serviço extra.
//
//   .estado/api/pedidos/<id>.json                    o pedido (status, resultado...): consultado por id, de qualquer pod
//   .estado/api/entrada/<id>.json                    o corpo recebido, até ser processado
//   .estado/api/fila/<canal>/<chave>/<marca>.json    "tem trabalho": canal principal|fotos, chave = o site
//   .estado/api/lotes/<id>.json                      pedidos de uma operação em vários sites ("todos")
//   .estado/api/indice/{site,cliente}/<x>/<id>       índice para listar pedidos de um site/cliente sem varrer todos
//
// Tipos: estoque | carro | remover | build | robots | buscar | criar | promover | renomear (canal principal); fotos (canal fotos).
// Status: na_fila → processando → concluido | invalido | recusado | erro.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../core/caminhos');

const FINAIS = new Set(['concluido', 'invalido', 'recusado', 'erro']);
const DIAS_GUARDAR = 7;
const base = () => path.join(C.ESTADO, 'api');
const dirPedidos = () => C.pedidos();
const dirEntrada = () => C.entrada();
const dirFila = (canal) => path.join(base(), 'fila', canal);
const dirLotes = () => path.join(base(), 'lotes');
const dirIndice = (tipo, valor) => path.join(base(), 'indice', tipo, String(valor).replace(/[^a-z0-9._-]/gi, '_'));
const indexar = (p) => { for (const [t, v] of [['site', p.site], ['cliente', p.cliente]]) if (v) { fs.mkdirSync(dirIndice(t, v), { recursive: true }); fs.writeFileSync(path.join(dirIndice(t, v), p.id), ''); } };
const arqPedido = (id) => path.join(dirPedidos(), `${id}.json`);
const arqEntrada = (id) => path.join(dirEntrada(), `${id}.json`);
const lerJSON = (p, padrao = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; } };
const gravar = (arq, obj) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); const tmp = `${arq}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, arq); };
const lerDir = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };
const CHAVE_OK = /^[a-z0-9][a-z0-9.-]{0,252}$/;
// id ordenável por tempo (base36 do instante) + aleatório: vários pods sem colisão
const novoId = (pref = 'p') => `${pref}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

function criarFila() {
  // ---------- gravar / consultar (API e trabalhador) ----------
  // completo (build): regerar todas as páginas do site, mantendo o histórico
  function adicionar({ tipo, site, carro = null, corpo, cliente, forcar = false, completo = false, lote = null, canal = tipo === 'fotos' ? 'fotos' : 'principal' }) {
    if (!CHAVE_OK.test(String(site))) throw new Error(`pedido sem site válido (${site})`);
    const id = novoId();
    const p = { id, tipo, site, carro, cliente, forcar: !!forcar, ...(completo ? { completo: true } : {}), lote, canal, status: 'na_fila', criado: new Date().toISOString(), inicio: null, fim: null, erros: [], resultado: null };
    if (corpo !== undefined) gravar(arqEntrada(id), corpo);
    gravar(arqPedido(id), p);
    indexar(p);
    // a marca na fila vai por último: o trabalhador só vê o pedido quando tudo dele já está gravado
    gravar(path.join(dirFila(canal), site, `${String(Date.now()).padStart(15, '0')}-${id}.json`), { id });
    return p;
  }
  const obter = (id) => (/^[a-z0-9]+$/.test(String(id)) ? lerJSON(arqPedido(id)) : null);
  const lerCorpo = (id) => lerJSON(arqEntrada(id), undefined);
  // espera o pedido terminar (até ms), olhando o arquivo: funciona mesmo se outro pod processar
  async function aguardar(id, ms) {
    const fim = Date.now() + ms;
    for (;;) {
      const p = obter(id);
      if (!p || FINAIS.has(p.status) || Date.now() >= fim) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // pedidos ainda não terminados de um site (o que tem marca na fila principal)
  const marcas = (canal, chave) => lerDir(path.join(dirFila(canal), chave)).filter((f) => f.endsWith('.json')).sort();
  const pendentesDoSite = (site, canal = 'principal') => marcas(canal, site).map((f) => obter(f.replace(/^\d+-|\.json$/g, ''))).filter((p) => p && !FINAIS.has(p.status));
  const carrosNaFila = (site) => new Set(pendentesDoSite(site).filter((p) => p.tipo === 'carro').map((p) => p.carro));
  // mais recentes primeiro (os ids crescem com o tempo). Com site/cliente, lê só o índice dele, não a pasta toda.
  function listar({ site = null, cliente = null, limite = 20 } = {}) {
    const r = [];
    const ids = site ? lerDir(dirIndice('site', site)) : cliente ? lerDir(dirIndice('cliente', cliente)) : lerDir(dirPedidos()).filter((x) => x.endsWith('.json')).map((x) => x.slice(0, -5));
    for (const id of ids.sort().reverse()) {
      const p = obter(id);
      if (p && (!site || p.site === site) && (!cliente || p.cliente === cliente)) r.push(p);
      if (r.length >= limite) break;
    }
    return r;
  }
  function estado() {
    const contar = (canal) => lerDir(dirFila(canal)).reduce((n, ch) => n + marcas(canal, ch).length, 0);
    return { naFila: contar('principal'), fotosNaFila: contar('fotos') };
  }

  // ---------- lotes (uma operação em muitos sites: um pedido por site, processados em paralelo) ----------
  function criarLote(ps, descricao) {
    const id = novoId('l');
    gravar(path.join(dirLotes(), `${id}.json`), { id, descricao, criado: new Date().toISOString(), pedidos: ps.map((p) => p.id) });
    return id;
  }
  function lote(id) {
    const l = /^l[a-z0-9]+$/.test(String(id)) ? lerJSON(path.join(dirLotes(), `${id}.json`)) : null;
    if (!l) return null;
    const contagem = {}; const problemas = [];
    for (const pid of l.pedidos) {
      const p = obter(pid);
      const st = p ? p.status : 'sumiu';
      contagem[st] = (contagem[st] || 0) + 1;
      if (p && FINAIS.has(st) && st !== 'concluido' && problemas.length < 50) problemas.push({ site: p.site, status: st, erros: p.erros.slice(0, 3) });
    }
    const terminados = l.pedidos.length - (contagem.na_fila || 0) - (contagem.processando || 0);
    return { lote: id, descricao: l.descricao, criado: l.criado, total: l.pedidos.length, terminados, concluido: terminados === l.pedidos.length, contagem, problemas, link: `/v1/lotes/${id}` };
  }
  async function aguardarLote(id, ms) {
    const fim = Date.now() + ms;
    for (;;) { const l = lote(id); if (!l || l.concluido || Date.now() >= fim) return l; await new Promise((r) => setTimeout(r, 200)); }
  }

  // ---------- usados pelo trabalhador ----------
  // chaves (sites) com trabalho no canal, com a idade da marca mais nova e da mais velha
  function chavesComTrabalho(canal) {
    const agora = Date.now();
    return lerDir(dirFila(canal)).map((chave) => {
      const ms = marcas(canal, chave);
      if (!ms.length) return null;
      return { chave, idadeMaisNova: agora - Number(ms[ms.length - 1].split('-')[0]), idadeMaisVelha: agora - Number(ms[0].split('-')[0]) };
    }).filter(Boolean);
  }
  // pedidos da chave, na ordem de chegada (com a marca de cada um)
  const pedidosDaChave = (canal, chave) => marcas(canal, chave).map((f) => { const p = obter(f.replace(/^\d+-|\.json$/g, '')); return p ? { ...p, _marca: path.join(dirFila(canal), chave, f) } : (fs.rmSync(path.join(dirFila(canal), chave, f), { force: true }), null); }).filter(Boolean);
  const salvar = (p) => { const { _marca, ...limpo } = p; gravar(arqPedido(p.id), limpo); };
  function marcarProcessando(ps) { for (const p of ps) { p.status = 'processando'; p.inicio = new Date().toISOString(); salvar(p); } }
  function terminar(p, status, erros = [], resultado = null) {
    Object.assign(p, { status, erros: erros.slice(0, 50), resultado, fim: new Date().toISOString() });
    salvar(p);
    fs.rmSync(arqEntrada(p.id), { force: true });
    if (p._marca) { fs.rmSync(p._marca, { force: true }); try { fs.rmdirSync(path.dirname(p._marca)); } catch (e) { /* ainda tem marca */ } }
  }
  const voltar = (ps) => ps.forEach((p) => { p.status = 'na_fila'; p.inicio = null; salvar(p); }); // a marca fica: outro giro pega
  const anotar = (p, campos) => { Object.assign(p, campos); salvar(p); };
  // pedidos terminados há mais de 7 dias saem do disco (o trabalhador chama de tempos em tempos)
  function limparAntigos() {
    const limite = Date.now() - DIAS_GUARDAR * 86400000;
    for (const f of lerDir(dirPedidos()).filter((x) => x.endsWith('.json'))) {
      const p = lerJSON(path.join(dirPedidos(), f));
      if (p && FINAIS.has(p.status) && Date.parse(p.fim || p.criado) < limite) fs.rmSync(path.join(dirPedidos(), f), { force: true });
    }
    for (const f of lerDir(dirLotes())) { const l = lerJSON(path.join(dirLotes(), f)); if (l && Date.parse(l.criado) < limite) fs.rmSync(path.join(dirLotes(), f), { force: true }); }
    // índice sem pedido (pedido apagado acima)
    for (const t of ['site', 'cliente']) for (const v of lerDir(path.join(base(), 'indice', t))) {
      const d = path.join(base(), 'indice', t, v);
      for (const id of lerDir(d)) if (!fs.existsSync(arqPedido(id))) fs.rmSync(path.join(d, id), { force: true });
      try { fs.rmdirSync(d); } catch (e) { /* ainda tem pedido */ }
    }
  }

  return { FINAIS, adicionar, obter, lerCorpo, aguardar, pendentesDoSite, carrosNaFila, listar, estado, criarLote, lote, aguardarLote,
    chavesComTrabalho, pedidosDaChave, marcarProcessando, terminar, voltar, anotar, limparAntigos };
}

module.exports = { criarFila };
