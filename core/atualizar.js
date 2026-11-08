// Atualiza o estoque de um ou mais sites e refaz SÓ os arquivos afetados.
// Cada site tem UM JSON de carros: sites/<dominio>/estoque.json.
//   node core/cli.js atualizar                          busca o estoque de todos os sites de config/fontes.json
//   node core/cli.js atualizar trokey.com.br,outro.com  só esses
//   node core/cli.js atualizar --publicar               depois de gerar, publica só o que mudou (config/publicacao.json)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { construir, problemasProducao, registrarPendente } = require('./build');
const Sites = require('./sites');
const { travar, destravar } = require('./trava');
const Robots = require('./robots');
const C = require('./caminhos');

const ROOT = C.ROOT;
const ESTADO = C.ESTADO;
const ID_OK = /^[A-Za-z0-9._-]+$/;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (padrao !== undefined) return padrao; throw e; } };

const txt = (v) => typeof v === 'string' && v.trim() !== '';
const int = (v) => Number.isInteger(v);

// Confere o estoque inteiro. Se tiver QUALQUER erro, nada é gravado e o estoque antigo continua valendo.
// lojas = ids de site.lojas: com mais de uma loja, cada carro precisa dizer a sua em "loja".
function validarEstoque(obj, lojas = []) {
  const erros = [];
  if (!obj || !Array.isArray(obj.carros)) return ['o JSON precisa ter { "carros": [ ... ] }'];
  const anoMax = new Date().getFullYear() + 2;
  const vistos = new Set();
  const links = new Map();
  obj.carros.forEach((c, i) => {
    const q = `carro #${i + 1}${c && c.id ? ` (${c.id})` : ''}`;
    const e = (m) => { if (erros.length < 30) erros.push(`${q}: ${m}`); };
    if (!c || typeof c !== 'object') return e('não é um objeto');
    if (typeof c.id !== 'string' || !ID_OK.test(c.id)) e('id inválido (só letras, números, ponto, hífen e _)');
    else if (vistos.has(c.id)) e('id repetido');
    else vistos.add(c.id);
    for (const k of ['marca', 'modelo', 'versao', 'cor', 'cambio', 'combustivel']) if (!txt(c[k])) e(`"${k}" vazio ou ausente`);
    if (!int(c.ano) || c.ano < 1950 || c.ano > anoMax) e('ano inválido');
    if (typeof c.preco !== 'number' || !(c.preco > 0)) e('preco inválido');
    if (typeof c.km !== 'number' || c.km < 0) e('km inválido');
    // fotos: a quantidade (as fotos já estão no armazenamento) ou a lista de URLs (a plataforma baixa e converte: core/fotos.js)
    if (Array.isArray(c.fotos)) {
      if (c.fotos.length > 60) e('fotos: no máximo 60');
      else if (c.fotos.some((u) => typeof u !== 'string' || u.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(u))) e('fotos: cada item precisa ser uma URL http(s) sem espaço');
    } else if (!int(c.fotos) || c.fotos < 0 || c.fotos > 60) e('fotos deve ser inteiro de 0 a 60 ou lista de URLs');
    if (c.opcionais != null && !Array.isArray(c.opcionais)) e('opcionais deve ser lista');
    if (c.ordem != null && !(int(c.ordem) && c.ordem >= 0)) e('ordem deve ser inteiro >= 0 (posição de exibição; menor aparece primeiro)');
    if (c.destaque != null && typeof c.destaque !== 'boolean') e('destaque deve ser true ou false');
    if (c.carroceria != null && typeof c.carroceria !== 'string') e('carroceria deve ser texto (ex.: Hatch, Sedan, SUV)');
    // link da página do carro (opcional): o que o Revenda Mais já usa, para manter as URLs indexadas no Google
    if (c.link != null) {
      const l = typeof c.link === 'string' ? c.link.replace(/^\/+/, '').replace(/\/{2,}/g, '/') : '';
      if (!/^carros\/[^\s?#\\]+\.html$/.test(l) || /(^|\/)\.\.?(\/|$)/.test(l)) e('link inválido (precisa ser "carros/.../nome.html", sem espaço, "?", "#" ou "..")');
      else if (links.has(l)) e(`link repetido (igual ao do carro ${links.get(l)})`);
      else links.set(l, c.id);
    }
    if (!lojas.length) e('o site ainda não tem lojas: cadastre as lojas (PUT /v1/sites/<dominio>) antes do estoque');
    else if (c.loja != null ? !lojas.includes(c.loja) : lojas.length !== 1) e(c.loja != null ? `loja "${c.loja}" não existe no site (${lojas.join(', ')})` : `"loja" ausente (o site tem ${lojas.length} lojas: ${lojas.join(', ')})`);
  });
  return erros;
}

const arqEstoque = (id) => C.estoque(id);
const hashCarros = (o) => sha(JSON.stringify(o.carros));

// grava só se mudou; guarda cópia do anterior; recusa queda brusca (proteção contra API devolvendo lista vazia)
function gravarEstoque(id, obj, { forcar = false } = {}) {
  if (!Sites.existe(id)) return { id, status: 'invalido', erros: [`site "${id}" não existe (sites/${id}/site.json)`] };
  const erros = validarEstoque(obj, Sites.lojas(id));
  if (erros.length) return { id, status: 'invalido', erros };
  const antigo = lerJSON(arqEstoque(id), null);
  if (antigo && hashCarros(antigo) === hashCarros(obj)) return { id, status: 'igual', total: obj.carros.length };
  const antes = antigo ? antigo.carros.length : 0;
  if (!forcar && antes > 0 && obj.carros.length === 0) // estoque zerado quase sempre é erro da API, mesmo em loja pequena
    return { id, status: 'recusado', erros: [`estoque veio vazio (antes tinha ${antes} carros); confira a API ou use forçar`] };
  if (!forcar && antes >= 10 && obj.carros.length < antes * 0.5)
    return { id, status: 'recusado', erros: [`caiu de ${antes} para ${obj.carros.length} carros (mais de 50%); confira a API ou use forçar`] };
  if (antigo) {
    fs.mkdirSync(path.join(ESTADO, 'estoques-anteriores'), { recursive: true });
    fs.copyFileSync(arqEstoque(id), path.join(ESTADO, 'estoques-anteriores', `${id}.json`));
  }
  const final = { atualizado: new Date().toISOString(), carros: obj.carros };
  const tmp = arqEstoque(id) + '.tmp';
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(final));
  fs.renameSync(tmp, arqEstoque(id));
  return { id, status: 'atualizado', antes, total: obj.carros.length };
}

const expandir = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, n) => {
  if (process.env[n] == null) throw new Error(`variável de ambiente ${n} não definida (usada em config/fontes.json)`);
  return process.env[n];
});

async function buscar(id, fonte) {
  const cfg = typeof fonte === 'string' ? { url: fonte } : fonte;
  const url = expandir(cfg.url);
  const headers = Object.fromEntries(Object.entries(cfg.headers || {}).map(([k, v]) => [k, expandir(v)]));
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`API respondeu HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? { carros: j } : j;
}



// ---------- publicação: roda um comando por site, só com o que mudou ----------
function rodar(cmd) {
  return new Promise((res) => execFile('/bin/sh', ['-c', cmd], { cwd: ROOT, timeout: 10 * 60 * 1000 }, (err, out, errout) => res({ ok: !err, saida: (out || '') + (errout || '') })));
}
const aspas = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

async function publicarPendentes({ pasta = 'dist', log = console.log } = {}) {
  const cfg = lerJSON(C.config('publicacao.json'), null);
  if (!cfg || !cfg.comandoSite) throw new Error('crie config/publicacao.json (veja config/publicacao.exemplo.json)');
  const arq = path.join(ESTADO, pasta, 'pendente.json');
  const pend = lerJSON(arq, {});
  const ids = Object.keys(pend);
  if (!ids.length) { log('nada a publicar'); return { publicados: [], falhas: [] }; }
  const publicados = [], falhas = [];
  const fila = [...ids];
  const par = Math.max(1, cfg.paralelo || 4);
  await Promise.all(Array.from({ length: par }, async () => {
    while (fila.length) {
      const site = fila.shift();
      const p = pend[site];
      // nunca publica site que quebraria no ar (fotos em localhost, http...): fica pendente até corrigir o site.json
      let prob;
      try { prob = Sites.existe(site) ? problemasProducao(Sites.carregar(site)) : []; } catch (e) { prob = [`site.json ilegível: ${e.message}`]; }
      if (prob.length) { falhas.push(site); log(`RECUSADO ${site}: ${prob.join('; ')}`); continue; }
      const lista = p.completo ? '' : p.escritos.join('\n');
      const cmd = cfg.comandoSite
        .replace(/\{site\}/g, aspas(site)).replace(/\{pasta\}/g, aspas(path.join(pasta, site)))
        .replace(/\{completo\}/g, p.completo ? '1' : '0')
        .replace(/\{lista\}/g, aspas(p.escritos.map((x) => x.slice(site.length + 1)).join(',')))
        .replace(/\{removidos\}/g, aspas(p.removidos.map((x) => x.slice(site.length + 1)).join(',')));
      const r = await rodar(cmd);
      if (r.ok) { publicados.push(site); log(`publicado ${site} (${p.completo ? 'completo' : p.escritos.length + ' arquivo(s)'})`); }
      else { falhas.push(site); log(`FALHOU ${site}: ${r.saida.trim().slice(0, 300)}`); }
    }
  }));
  // só limpa o que foi publicado com sucesso; o resto fica para a próxima
  const atual = lerJSON(arq, {});
  for (const s of publicados) delete atual[s];
  fs.writeFileSync(arq, JSON.stringify(atual));
  return { publicados, falhas };
}

// Núcleo: recebe estoques (já em mãos, {dominio: json}) ou busca nas fontes; valida, grava e reconstrói só os sites que mudaram.
// refazer = sites para reconstruir mesmo sem mudança de estoque (ex.: o site.json mudou; pedido "build" da API)
async function atualizar({ sites: ids = null, recebidos = null, refazer = [], forcar = false, completo = false, publicar = false, log = console.log } = {}) {
  if (!travar()) return { status: 'ocupado' };
  try {
    const res = [];
    if (recebidos) {
      for (const [id, obj] of Object.entries(recebidos)) res.push(gravarEstoque(id, obj, { forcar }));
    } else {
      const fontes = lerJSON(C.config('fontes.json'), null);
      if (!fontes) throw new Error('crie config/fontes.json (veja config/fontes.exemplo.json)');
      for (const id of ids && ids.length ? ids : Object.keys(fontes)) {
        if (!fontes[id]) { res.push({ id, status: 'invalido', erros: ['sem fonte em config/fontes.json'] }); continue; }
        try { res.push(gravarEstoque(id, await buscar(id, fontes[id]), { forcar })); }
        catch (e) { res.push({ id, status: 'erro', erros: [e.message] }); }
      }
    }
    for (const r of res) {
      const d = r.status === 'atualizado' ? `${r.antes} → ${r.total} carros` : r.status === 'igual' ? `${r.total} carros, sem mudança` : (r.erros || []).slice(0, 5).join('; ');
      log(`${r.id}: estoque ${r.status}${d ? ' · ' + d : ''}`);
    }
    const mudou = res.filter((r) => r.status === 'atualizado').map((r) => r.id);
    // cada estoque pertence a um site só: refaz exatamente os sites cujo estoque mudou
    const sites = completo ? null : [...new Set([...mudou, ...refazer])];
    if (completo || sites.length) construir({ sites, completo });
    else log('nada mudou, nenhum site refeito');
    let pub = null;
    if (publicar) pub = await publicarPendentes({ log });
    return { status: 'ok', estoques: res, sites: sites === null ? 'todos' : sites, publicacao: pub };
  } finally { destravar(); }
}

// Reescreve SÓ o robots.txt dos sites já gerados (modelo novo em config/robots.txt): segundos para 2500 sites, sem
// passar pelo build. O que mudou entra nas pendências de publicação. Usa a mesma trava do build.
function reescreverRobots({ sites = null, pasta = 'dist' } = {}) {
  if (!travar()) return { status: 'ocupado' };
  try {
    const alterados = [], iguais = [], proprio = [], semUrl = [];
    for (const id of sites || Sites.listar()) {
      const site = Sites.carregar(id);
      if (!site.url) { semUrl.push(id); continue; }
      if (typeof site.robots === 'string') proprio.push(id); // o site tem o dele: o modelo não vale para ele
      const arq = path.join(C.saida(pasta), id, 'robots.txt');
      if (!fs.existsSync(path.dirname(arq))) continue; // nunca gerado: o build cria com o modelo novo
      const texto = Robots.textoRobots(site);
      if (fs.existsSync(arq) && fs.readFileSync(arq, 'utf8') === texto) { iguais.push(id); continue; }
      fs.writeFileSync(`${arq}.tmp`, texto);
      fs.renameSync(`${arq}.tmp`, arq);
      registrarPendente(pasta, id, { escritos: [`${id}/robots.txt`], removidos: [] }, false);
      alterados.push(id);
    }
    return { status: 'ok', alterados, iguais: iguais.length, comRobotsProprio: proprio, semUrl };
  } finally { destravar(); }
}

module.exports = { reescreverRobots, atualizar, validarEstoque, gravarEstoque, publicarPendentes };
