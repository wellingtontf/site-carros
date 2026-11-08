#!/usr/bin/env node
// API de integração: qualquer sistema (Revenda Mais, outro CRM, um script) manda o estoque dos sites dele e a
// plataforma valida, grava e refaz SÓ aquele site. Ela não conhece nenhum sistema de origem: o contrato é um só
// (docs/api.md) e cada sistema converte os dados dele para esse formato.
//
//   node core/cli.js cliente criar revenda-mais --sites "*"     cria o token de um sistema (aparece uma vez)
//   node core/servidor.js                                       sobe a API (PORT=8787)
//
//   GET    /v1/saude                               sem token: para o balanceador/monitor saber se está de pé
//   GET    /v1/sites                               sites que o token pode mexer (com total de carros e data)
//   GET    /v1/sites/<dominio>                     resumo do site, fotos pendentes/com erro, últimos pedidos
//   GET    /v1/sites/<dominio>/estoque             o estoque atual (para o outro sistema conferir/reconciliar)
//   PUT    /v1/sites/<dominio>/estoque             troca o estoque inteiro  {"carros":[...]}
//   PUT    /v1/sites/<dominio>/carros/<id>         inclui ou altera um carro {...}
//   DELETE /v1/sites/<dominio>/carros/<id>         tira um carro (vendido)
//   POST   /v1/sites/<dominio>/build               refaz o site sem mudar o estoque (ex.: mudou o site.json)
//   POST   /v1/atualizar                           puxa das URLs de config/fontes.json  {"sites":[...]} (vazio = todos)
//   GET    /v1/pedidos/<id>                        andamento de um pedido
//   GET    /v1/pedidos?site=<dominio>              últimos pedidos
//   GET    /v1/status                              situação da fila
// Quem muda algo recebe 202 + número do pedido. ?esperar=30 segura a resposta até o pedido terminar (máx. 120 s).
// ?forcar=1 libera a trava de queda de estoque (mais de 50% ou zerado).
// Autenticação: Authorization: Bearer <token>  (core/clientes.js; TOKEN_ATUALIZAR = admin, todos os sites)
// Variáveis: PORT (8787), ATRASO_MS (3000: junta chamadas seguidas), PUBLICAR=1 (publica depois de gerar).
// As rotas antigas sem /v1 (/status, /atualizar, PUT /sites/<d>/estoque) continuam funcionando.
const http = require('http');
const fs = require('fs');
const { idsSites, ID_SITE } = require('./build.js');
const AT = require('./atualizar.js');
const CL = require('./clientes.js');
const C = require('./caminhos');
const { criarFila } = require('./fila.js');
const Fotos = require('./fotos.js');

const PORT = +process.env.PORT || 8787;
const ADMIN = process.env.TOKEN_ATUALIZAR || '';
const ID_CARRO = /^[A-Za-z0-9._-]{1,80}$/;
const LIMITE = { estoque: 100e6, carro: 1e6, outro: 100e3 };

if (ADMIN && ADMIN.length < 16) { console.error('TOKEN_ATUALIZAR precisa ter pelo menos 16 caracteres.'); process.exit(1); }
let clientesIniciais;
try { clientesIniciais = CL.listarClientes(); } catch (e) { console.error(e.message); process.exit(1); }
if (!ADMIN && !clientesIniciais.length) {
  console.error('Nenhum token configurado. Crie um cliente: node core/cli.js cliente criar <nome> --sites "*"  (ou defina TOKEN_ATUALIZAR)');
  process.exit(1);
}

// fotos por URL: processadas em segundo plano; quando um site fica com fotos prontas, entra um pedido de build para ele
let fila = null;
const fotos = Fotos.criarTrabalhador({ log: (m) => console.log(m), aoTerminar: (site) => fila.adicionar({ tipo: 'build', site, cliente: 'fotos' }) });
fila = criarFila({ atraso: +process.env.ATRASO_MS || 3000, publicar: /^(1|true|sim)$/i.test(process.env.PUBLICAR || ''), log: (m) => console.log(m), aoProcessarSite: (s) => fotos.agendar(s) });
for (const s of idsSites()) fotos.agendar(s); // o que ficou pendente (servidor caiu no meio das fotos)

// ---------- utilidades HTTP ----------
class Erro extends Error { constructor(code, msg, extra = {}) { super(msg); this.code = code; this.extra = extra; } }
function corpo(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const p = [];
    req.on('data', (c) => { n += c.length; if (n > max) { rej(new Erro(413, `corpo grande demais (máx. ${max / 1e6} MB)`)); req.destroy(); } else p.push(c); });
    req.on('end', () => res(Buffer.concat(p).toString('utf8')));
    req.on('error', rej);
  });
}
async function corpoJSON(req, max, vazio) {
  const t = (await corpo(req, max)).trim();
  if (!t) { if (vazio !== undefined) return vazio; throw new Erro(400, 'corpo vazio (esperado JSON)'); }
  try { return JSON.parse(t); } catch (e) { throw new Erro(400, `JSON inválido: ${e.message}`); }
}
const enviar = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
const visao = (p) => p && ({
  pedido: p.id, tipo: p.tipo, site: p.site, ...(p.carro ? { carro: p.carro } : {}), status: p.status,
  criado: p.criado, inicio: p.inicio, fim: p.fim, erros: p.erros, resultado: p.resultado, ...(p.publicacao ? { publicacao: p.publicacao } : {}),
  link: `/v1/pedidos/${p.id}`,
});
// responde um pedido novo: 202 (na fila) ou, com ?esperar=N, o resultado (200 concluído; 422 inválido; 409 recusado; 500 erro)
async function responderPedido(res, url, p) {
  const seg = Math.min(120, Math.max(0, Number(url.searchParams.get('esperar')) || 0));
  if (!seg) return enviar(res, 202, visao(p));
  const fim = await fila.aguardar(p.id, seg * 1000);
  const code = { concluido: 200, invalido: 422, recusado: 409, erro: 500 }[fim.status] || 202;
  enviar(res, code, visao(fim));
}
const lerEstoque = (d) => { try { return JSON.parse(fs.readFileSync(C.estoque(d), 'utf8')); } catch (e) { return { carros: [] }; } };
const lojasDe = (d) => Object.keys(JSON.parse(fs.readFileSync(C.siteJson(d), 'utf8')).lojas || {});

// ---------- rotas ----------
async function rotear(req, res, url, cliente) {
  const m = req.method;
  const p = url.pathname;
  const forcar = url.searchParams.get('forcar') === '1';
  const site = (d) => {
    if (!ID_SITE.test(d) || !idsSites().includes(d)) throw new Erro(404, `site "${d}" não existe`);
    if (!CL.pode(cliente, d)) throw new Erro(403, `este token não tem acesso ao site "${d}"`);
    return d;
  };

  if (m === 'GET' && p === '/v1/status') return enviar(res, 200, { ...fila.estado(), cliente: cliente.nome });
  if (m === 'GET' && p === '/v1/sites') {
    return enviar(res, 200, { sites: idsSites().filter((d) => CL.pode(cliente, d)).map((d) => { const e = lerEstoque(d); return { site: d, carros: (e.carros || []).length, atualizado: e.atualizado || null }; }) });
  }
  if (m === 'POST' && p === '/v1/atualizar') {
    const b = await corpoJSON(req, LIMITE.outro, {});
    if (b.sites != null && !(Array.isArray(b.sites) && b.sites.every((x) => typeof x === 'string'))) throw new Erro(400, '"sites" deve ser uma lista de domínios');
    const lista = b.sites && b.sites.length && !b.todos ? b.sites.map(site) : null;
    if (!lista && !cliente.sites.includes('*')) throw new Erro(403, 'atualizar todos os sites exige um token com acesso a todos ("*"); informe "sites"');
    const ps = (lista || [null]).map((d) => fila.adicionar({ tipo: 'buscar', site: d, cliente: cliente.nome, forcar }));
    return lista && lista.length === 1 ? responderPedido(res, url, ps[0]) : enviar(res, 202, { pedidos: ps.map(visao) });
  }
  if (m === 'GET' && p === '/v1/pedidos') {
    const d = url.searchParams.get('site');
    if (d) site(d);
    return enviar(res, 200, { pedidos: fila.listar({ site: d, cliente: cliente.admin ? null : cliente.nome, limite: Math.min(200, Number(url.searchParams.get('limite')) || 20) }).map(visao) });
  }
  let r = /^\/v1\/pedidos\/([a-z0-9]+)$/.exec(p);
  if (m === 'GET' && r) {
    const ped = fila.obter(r[1]);
    if (!ped || (!cliente.admin && ped.cliente !== cliente.nome)) throw new Erro(404, 'pedido não encontrado');
    return enviar(res, 200, visao(ped));
  }

  r = /^\/v1\/sites\/([^/]+)(\/.*)?$/.exec(p);
  if (!r) throw new Erro(404, 'rota inexistente (veja docs/api.md)');
  const d = site(decodeURIComponent(r[1]));
  const resto = r[2] || '';

  if (m === 'GET' && resto === '') {
    const e = lerEstoque(d);
    return enviar(res, 200, { site: d, carros: (e.carros || []).length, atualizado: e.atualizado || null, fotos: Fotos.resumo(d), pedidos: fila.listar({ site: d, limite: 5 }).map(visao) });
  }
  if (m === 'GET' && resto === '/estoque') return enviar(res, 200, lerEstoque(d));
  if (m === 'PUT' && resto === '/estoque') {
    let b = await corpoJSON(req, LIMITE.estoque);
    if (Array.isArray(b)) b = { carros: b }; // aceita a lista pura também
    const erros = AT.validarEstoque(b, lojasDe(d));
    if (erros.length) throw new Erro(422, 'estoque inválido: nada foi gravado', { erros });
    return responderPedido(res, url, fila.adicionar({ tipo: 'estoque', site: d, corpo: { carros: b.carros }, cliente: cliente.nome, forcar }));
  }
  if (m === 'POST' && resto === '/build') {
    await corpo(req, LIMITE.outro);
    return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome }));
  }
  r = /^\/carros\/([^/]+)$/.exec(resto);
  if (r) {
    const id = decodeURIComponent(r[1]);
    if (!ID_CARRO.test(id)) throw new Erro(400, 'id do carro inválido (só letras, números, ponto, hífen e _)');
    if (m === 'GET') {
      const c = (lerEstoque(d).carros || []).find((x) => x.id === id);
      if (!c) throw new Erro(404, `carro "${id}" não está no estoque`);
      return enviar(res, 200, c);
    }
    if (m === 'PUT') {
      const c = await corpoJSON(req, LIMITE.carro);
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Erro(400, 'o corpo deve ser um carro (objeto JSON)');
      if (c.id != null && c.id !== id) throw new Erro(400, `"id" do corpo (${c.id}) diferente do endereço (${id})`);
      const carro = { ...c, id };
      const erros = AT.validarEstoque({ carros: [carro] }, lojasDe(d));
      if (erros.length) throw new Erro(422, 'carro inválido: nada foi gravado', { erros });
      return responderPedido(res, url, fila.adicionar({ tipo: 'carro', site: d, carro: id, corpo: carro, cliente: cliente.nome, forcar }));
    }
    if (m === 'DELETE') {
      if (!(lerEstoque(d).carros || []).some((x) => x.id === id) && !fila.carrosNaFila(d).has(id)) throw new Erro(404, `carro "${id}" não está no estoque`);
      return responderPedido(res, url, fila.adicionar({ tipo: 'remover', site: d, carro: id, cliente: cliente.nome, forcar }));
    }
  }
  throw new Erro(404, 'rota inexistente (veja docs/api.md)');
}

const servidor = http.createServer(async (req, res) => {
  const t0 = Date.now();
  let quem = '-';
  res.on('finish', () => console.log(`${req.method} ${req.url.split('?')[0]} ${quem} → ${res.statusCode} (${Date.now() - t0} ms)`));
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/v1/')) url.pathname = `/v1${url.pathname}`; // rotas antigas (/status, /atualizar, /sites/...)
    if (req.method === 'GET' && url.pathname === '/v1/saude') return enviar(res, 200, { ok: true, api: 'v1' });
    const tk = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    let cliente = null;
    try { cliente = tk ? CL.autenticar(tk[1].trim(), { tokenAdmin: ADMIN }) : null; } catch (e) { throw new Erro(500, e.message); }
    if (!cliente) return enviar(res, 401, { erro: 'não autorizado (Authorization: Bearer <token>)' });
    quem = cliente.nome;
    await rotear(req, res, url, cliente);
  } catch (e) {
    if (res.headersSent) return;
    enviar(res, e instanceof Erro ? e.code : 500, { erro: e.message, ...(e.extra || {}) });
    if (!(e instanceof Erro)) console.error(e.stack);
  }
});
servidor.listen(PORT, () => console.log(`API em :${PORT} (clientes: ${clientesIniciais.map((c) => c.nome).join(', ') || 'nenhum'}${ADMIN ? ' + admin' : ''})`));

// desligar com calma: termina o que está processando; o que está na fila fica no disco e roda na volta
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => {
  servidor.close();
  const sair = () => (fila.rodando() ? setTimeout(sair, 200) : process.exit(0));
  sair();
});
