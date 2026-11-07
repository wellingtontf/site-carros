#!/usr/bin/env node
// Receptor HTTP: o outro sistema chama quando quiser. Um processo só, uma atualização por vez.
//   TOKEN_ATUALIZAR=... node core/servidor.js
//   POST /atualizar                  {"sites":["trokey.com.br"]}  ou vazio/{"todos":true}  → busca em config/fontes.json
//   PUT  /sites/<dominio>/estoque    corpo = o JSON de carros do site ({"carros":[...]})  (?forcar=1 ignora a trava de queda)
//   GET  /status
// Autenticação: Authorization: Bearer <TOKEN_ATUALIZAR>
const http = require('http');
const crypto = require('crypto');
const { atualizar } = require('./atualizar.js');

const PORT = +process.env.PORT || 8787;
const TOKEN = process.env.TOKEN_ATUALIZAR || '';
const ATRASO = +process.env.ATRASO_MS || 3000; // junta chamadas seguidas numa só
const PUBLICAR = /^(1|true|sim)$/i.test(process.env.PUBLICAR || '');
if (TOKEN.length < 16) { console.error('Defina TOKEN_ATUALIZAR com pelo menos 16 caracteres.'); process.exit(1); }

const ok = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
let fila = { todos: false, ids: new Set(), recebidos: {}, forcar: false };
let timer = null, rodando = false, ultimo = null;

function agendar() { clearTimeout(timer); timer = setTimeout(processar, ATRASO); }
async function processar() {
  if (rodando) return agendar();
  const lote = fila; fila = { todos: false, ids: new Set(), recebidos: {}, forcar: false };
  rodando = true;
  try {
    const inicio = Date.now();
    const base = { publicar: PUBLICAR, forcar: lote.forcar, log: (m) => console.log(m) };
    const rs = [];
    if (Object.keys(lote.recebidos).length) rs.push(await atualizar({ ...base, recebidos: lote.recebidos }));
    if (lote.todos || lote.ids.size) rs.push(await atualizar({ ...base, sites: lote.todos ? null : [...lote.ids] }));
    if (rs.some((r) => r.status === 'ocupado')) { console.log('ocupado (outro processo); tentando de novo'); Object.assign(fila, lote); return setTimeout(agendar, 5000); }
    ultimo = { em: new Date().toISOString(), segundos: (Date.now() - inicio) / 1000, resultado: rs };
  } catch (e) { console.error('erro:', e.message); ultimo = { em: new Date().toISOString(), erro: e.message }; }
  finally { rodando = false; if (fila.todos || fila.ids.size || Object.keys(fila.recebidos).length) agendar(); }
}

function corpo(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const p = [];
    req.on('data', (c) => { n += c.length; if (n > max) { rej(Object.assign(new Error('corpo grande demais'), { code: 413 })); req.destroy(); } else p.push(c); });
    req.on('end', () => res(Buffer.concat(p).toString('utf8')));
    req.on('error', rej);
  });
}
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  try {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m || !ok(m[1], TOKEN)) return json(res, 401, { erro: 'não autorizado' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, { rodando, naFila: fila.todos ? 'todos' : [...fila.ids, ...Object.keys(fila.recebidos)], ultimo });
    if (req.method === 'POST' && url.pathname === '/atualizar') {
      const t = await corpo(req, 100e3);
      const b = t.trim() ? JSON.parse(t) : {};
      if (b.sites && !(Array.isArray(b.sites) && b.sites.every((x) => typeof x === 'string'))) return json(res, 400, { erro: '"sites" deve ser lista de domínios' });
      if (b.sites && b.sites.length && !b.todos) b.sites.forEach((i) => fila.ids.add(i)); else fila.todos = true;
      fila.forcar = fila.forcar || url.searchParams.get('forcar') === '1';
      agendar();
      return json(res, 202, { aceito: true, mensagem: 'entrou na fila' });
    }
    const pm = /^\/sites\/([a-z0-9.-]+)\/estoque$/.exec(url.pathname);
    if (req.method === 'PUT' && pm) {
      const obj = JSON.parse(await corpo(req, 100e6));
      fila.recebidos[pm[1]] = obj;
      fila.forcar = fila.forcar || url.searchParams.get('forcar') === '1';
      agendar();
      return json(res, 202, { aceito: true });
    }
    json(res, 404, { erro: 'rota inexistente' });
  } catch (e) { json(res, e.code === 413 ? 413 : 400, { erro: e.message }); }
}).listen(PORT, () => console.log(`Receptor em :${PORT} (publicar=${PUBLICAR})`));
