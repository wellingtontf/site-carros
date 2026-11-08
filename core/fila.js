// Fila de pedidos da API. Cada chamada que muda algo vira um PEDIDO com número próprio, gravado em disco
// (.estado/api/pedidos/<id>.json; o corpo recebido fica em .estado/api/entrada/<id>.json até ser processado):
// se o servidor cair ou reiniciar, os pedidos que estavam na fila são processados quando ele voltar.
//
// Tipos de pedido:
//   estoque   troca o estoque inteiro do site            (PUT /v1/sites/<d>/estoque)
//   carro     inclui ou altera UM carro                   (PUT /v1/sites/<d>/carros/<id>)
//   remover   tira UM carro                               (DELETE /v1/sites/<d>/carros/<id>)
//   build     refaz o site sem mudar o estoque            (POST /v1/sites/<d>/build)
//   buscar    puxa o estoque das URLs de config/fontes.json (POST /v1/atualizar)
//
// Processamento: espera "atraso" ms sem chamada nova (junta rajadas), aplica os pedidos de cada site NA ORDEM em que
// chegaram, valida o estoque depois de cada um (um carro inválido é recusado sozinho, sem derrubar os outros), grava
// e reconstrói o site UMA vez. Status final de cada pedido: concluido | invalido | recusado | erro.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./caminhos');
const { carregarSite } = require('./build');
const AT = require('./atualizar');

const DIAS_GUARDAR = 7; // pedidos terminados ficam consultáveis por 7 dias
const FINAIS = new Set(['concluido', 'invalido', 'recusado', 'erro']);
const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; } };
const gravarAtomico = (arq, txt) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(`${arq}.tmp`, txt); fs.renameSync(`${arq}.tmp`, arq); };

// aoProcessarSite(site): chamado depois que o estoque de um site foi processado (o servidor agenda as fotos dele)
function criarFila({ atraso = 3000, publicar = false, log = console.log, atualizar = AT.atualizar, publicarPendentes = AT.publicarPendentes, aoProcessarSite = () => {} } = {}) {
  const pedidos = new Map();
  const esperando = new Map(); // id → [resolve] de quem chamou com ?esperar=
  let timer = null, rodando = false, seq = 0, ultimo = null;
  const arqPedido = (id) => path.join(C.pedidos(), `${id}.json`);
  const arqEntrada = (id) => path.join(C.entrada(), `${id}.json`);
  const salvar = (p) => gravarAtomico(arqPedido(p.id), JSON.stringify(p));

  // volta do disco: o que estava na fila (ou no meio do processamento quando o servidor caiu) é refeito
  const limite = Date.now() - DIAS_GUARDAR * 86400000;
  if (fs.existsSync(C.pedidos())) {
    for (const f of fs.readdirSync(C.pedidos()).filter((x) => x.endsWith('.json'))) {
      const p = lerJSON(path.join(C.pedidos(), f), null);
      if (!p || !p.id) continue;
      if (FINAIS.has(p.status) && Date.parse(p.fim || p.criado) < limite) { fs.rmSync(path.join(C.pedidos(), f), { force: true }); continue; }
      if (!FINAIS.has(p.status)) { p.status = 'na_fila'; salvar(p); }
      pedidos.set(p.id, p);
    }
  }

  function agendar(ms = atraso) { clearTimeout(timer); timer = setTimeout(() => processar().catch((e) => log(`erro na fila: ${e.stack || e.message}`)), ms); }
  if ([...pedidos.values()].some((p) => p.status === 'na_fila')) agendar();

  function adicionar({ tipo, site = null, carro = null, corpo, cliente, forcar = false }) {
    const id = `p${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}${crypto.randomBytes(2).toString('hex')}`;
    const p = { id, tipo, site, carro, cliente, forcar: !!forcar, status: 'na_fila', criado: new Date().toISOString(), n: seq, inicio: null, fim: null, erros: [], resultado: null };
    if (corpo !== undefined) gravarAtomico(arqEntrada(id), JSON.stringify(corpo));
    salvar(p);
    pedidos.set(id, p);
    agendar();
    return p;
  }

  function terminar(p, status, erros = [], resultado = null) {
    Object.assign(p, { status, erros: erros.slice(0, 50), resultado, fim: new Date().toISOString() });
    salvar(p);
    fs.rmSync(arqEntrada(p.id), { force: true });
    for (const r of esperando.get(p.id) || []) r(p);
    esperando.delete(p.id);
  }
  const voltar = (ps) => ps.forEach((p) => { p.status = 'na_fila'; p.inicio = null; salvar(p); });

  // ---- o processamento ----
  async function processar() {
    if (rodando) return agendar();
    const lote = [...pedidos.values()].filter((p) => p.status === 'na_fila').sort((a, b) => a.criado.localeCompare(b.criado) || a.n - b.n);
    if (!lote.length) return;
    rodando = true;
    const inicio = Date.now();
    let ocupado = false;
    try {
      for (const p of lote) { p.status = 'processando'; p.inicio = new Date().toISOString(); salvar(p); }

      // 1) puxar das fontes (config/fontes.json)
      const buscas = lote.filter((p) => p.tipo === 'buscar');
      if (buscas.length) {
        try {
          const todos = buscas.some((p) => !p.site);
          const r = await atualizar({ sites: todos ? null : [...new Set(buscas.map((p) => p.site))], forcar: buscas.some((p) => p.forcar), log });
          if (r.status === 'ocupado') { ocupado = true; voltar(buscas); }
          else for (const p of buscas) {
            const est = r.estoques.filter((e) => !p.site || e.id === p.site);
            const ruins = est.filter((e) => !['atualizado', 'igual'].includes(e.status));
            terminar(p, ruins.length ? (ruins.length === est.length ? ruins[0].status : 'concluido') : 'concluido', ruins.flatMap((e) => (e.erros || []).map((x) => `${e.id}: ${x}`)), { estoques: est });
          }
        } catch (e) { buscas.forEach((p) => terminar(p, 'erro', [e.message])); }
      }

      // 2) por site, na ordem de chegada
      const porSite = new Map();
      for (const p of lote.filter((x) => x.tipo !== 'buscar')) { if (!porSite.has(p.site)) porSite.set(p.site, []); porSite.get(p.site).push(p); }
      for (const [site, ps] of porSite) {
        try {
          const lojas = Object.keys(carregarSite(site).lojas || {});
          let carros = (lerJSON(C.estoque(site), null) || { carros: [] }).carros || [];
          const aplicados = [];
          for (const p of ps.filter((x) => x.tipo !== 'build')) {
            const corpo = lerJSON(arqEntrada(p.id), undefined);
            let novo;
            if (p.tipo === 'estoque') novo = corpo && corpo.carros;
            else if (p.tipo === 'carro') {
              const i = carros.findIndex((c) => c.id === p.carro);
              novo = i >= 0 ? carros.map((c, k) => (k === i ? corpo : c)) : [...carros, corpo];
            } else if (p.tipo === 'remover') {
              if (!carros.some((c) => c.id === p.carro)) { terminar(p, 'erro', [`carro "${p.carro}" não está no estoque`]); continue; }
              novo = carros.filter((c) => c.id !== p.carro);
            }
            if (p.tipo !== 'remover' && corpo === undefined) { terminar(p, 'erro', ['corpo do pedido perdido (.estado/api/entrada)']); continue; }
            const erros = AT.validarEstoque({ carros: novo }, lojas);
            if (erros.length) { terminar(p, 'invalido', erros); continue; }
            carros = novo;
            aplicados.push(p);
          }
          const builds = ps.filter((x) => x.tipo === 'build');
          if (!aplicados.length && !builds.length) continue;
          const r = await atualizar({ recebidos: aplicados.length ? { [site]: { carros } } : {}, refazer: builds.length ? [site] : [], forcar: ps.some((x) => x.forcar), log });
          if (r.status === 'ocupado') { ocupado = true; voltar([...aplicados, ...builds]); continue; }
          const est = r.estoques[0];
          for (const p of aplicados) {
            if (['atualizado', 'igual'].includes(est.status)) terminar(p, 'concluido', [], { estoque: est.status, carros: est.total, antes: est.antes ?? est.total });
            else terminar(p, est.status, est.erros || []);
          }
          for (const p of builds) terminar(p, 'concluido', [], { build: true, carros: carros.length });
          if (aplicados.length) aoProcessarSite(site);
        } catch (e) {
          log(`${site}: erro ${e.message}`);
          ps.filter((p) => !FINAIS.has(p.status)).forEach((p) => terminar(p, 'erro', [e.message]));
        }
      }

      // 3) publicar (se ligado) o que foi gerado
      const feitos = lote.filter((p) => p.status === 'concluido');
      if (publicar && feitos.length) {
        try {
          const pub = await publicarPendentes({ log });
          for (const p of feitos) { p.publicacao = !p.site || pub.publicados.includes(p.site) ? 'publicado' : pub.falhas.includes(p.site) ? 'falhou' : 'nada a publicar'; salvar(p); }
        } catch (e) { log(`publicação: ${e.message}`); for (const p of feitos) { p.publicacao = `falhou: ${e.message}`; salvar(p); } }
      }
      ultimo = { em: new Date().toISOString(), segundos: (Date.now() - inicio) / 1000, pedidos: lote.length };
    } finally {
      rodando = false;
      // pedidos antigos saem da memória e do disco
      for (const [id, p] of pedidos) if (FINAIS.has(p.status) && Date.parse(p.fim) < Date.now() - DIAS_GUARDAR * 86400000) { pedidos.delete(id); fs.rmSync(arqPedido(id), { force: true }); }
      if ([...pedidos.values()].some((p) => p.status === 'na_fila')) agendar(ocupado ? 5000 : atraso);
    }
  }

  return {
    adicionar,
    obter: (id) => pedidos.get(id) || null,
    listar: ({ site = null, cliente = null, limite = 20 } = {}) => [...pedidos.values()]
      .filter((p) => (!site || p.site === site) && (!cliente || p.cliente === cliente))
      .sort((a, b) => b.criado.localeCompare(a.criado) || b.n - a.n).slice(0, limite),
    // espera o pedido terminar (até ms); devolve o pedido como estiver
    aguardar: (id, ms) => new Promise((ok) => {
      const p = pedidos.get(id);
      if (!p || FINAIS.has(p.status)) return ok(p);
      const t = setTimeout(() => ok(pedidos.get(id)), ms);
      if (!esperando.has(id)) esperando.set(id, []);
      esperando.get(id).push((x) => { clearTimeout(t); ok(x); });
    }),
    // ids de carros que algum pedido na fila vai incluir (para o DELETE de um carro que acabou de ser enviado)
    carrosNaFila: (site) => new Set([...pedidos.values()].filter((p) => p.site === site && !FINAIS.has(p.status) && p.tipo === 'carro').map((p) => p.carro)),
    estado: () => ({ rodando, naFila: [...pedidos.values()].filter((p) => !FINAIS.has(p.status)).length, ultimo }),
    ocioso: () => !rodando && ![...pedidos.values()].some((p) => !FINAIS.has(p.status)),
    rodando: () => rodando,
    FINAIS,
  };
}

module.exports = { criarFila };
