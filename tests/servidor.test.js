// Receptor HTTP (core/servidor.js): autenticação, rotas, limites e o fluxo PUT → valida → grava → refaz o site.
const A = require('./ajuda');
A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ID = 'loja-a.com.br';
const TOKEN = 'token-de-teste-com-mais-de-16';
let srv, url, saidaSrv = '';

const portaLivre = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const req = (metodo, caminho, { corpo, token = TOKEN } = {}) => fetch(url + caminho, {
  method: metodo, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  headers: token ? { authorization: `Bearer ${token}` } : {},
});
const esperar = async (cond, ms = 8000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

before(async () => {
  A.criarSite(ID, { carros: Array.from({ length: 3 }, () => A.carro()) });
  A.silencioso(() => require('../core/build.js').construir({}));
  const porta = await portaLivre();
  url = `http://127.0.0.1:${porta}`;
  srv = spawn(process.execPath, [path.join(A.PROJETO, 'core', 'servidor.js')], {
    env: { ...process.env, PORT: String(porta), TOKEN_ATUALIZAR: TOKEN, ATRASO_MS: '50', SITE_CARROS_RAIZ: A.raiz() },
  });
  srv.stdout.on('data', (d) => (saidaSrv += d));
  srv.stderr.on('data', (d) => (saidaSrv += d));
  assert.ok(await esperar(() => saidaSrv.includes('Receptor em')), `servidor não subiu: ${saidaSrv}`);
});
after(() => srv && srv.kill());

test('sem token ou com token errado: 401', async () => {
  assert.equal((await req('GET', '/status', { token: null })).status, 401);
  assert.equal((await req('GET', '/status', { token: 'errado' })).status, 401);
  assert.equal((await req('GET', '/status', { token: TOKEN + 'x' })).status, 401);
});

test('status e rota inexistente', async () => {
  const r = await req('GET', '/status');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rodando, false);
  assert.equal((await req('GET', '/nada')).status, 404);
});

test('corpo inválido: 400 sem derrubar o servidor', async () => {
  assert.equal((await req('PUT', `/sites/${ID}/estoque`, { corpo: '{quebrado' })).status, 400);
  assert.equal((await req('POST', '/atualizar', { corpo: { sites: 'nao-e-lista' } })).status, 400);
  assert.equal((await req('GET', '/status')).status, 200, 'continua de pé');
});

test('domínio com caractere estranho na rota não é aceito', async () => {
  assert.equal((await req('PUT', '/sites/..%2F..%2Fetc/estoque', { corpo: { carros: [] } })).status, 404);
  assert.equal((await req('PUT', '/sites/ABC.com/estoque', { corpo: { carros: [] } })).status, 404);
});

test('PUT do estoque: aceita (202), grava e refaz o site em segundo plano', async () => {
  const carros = JSON.parse(fs.readFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), 'utf8')).carros;
  carros[0].preco = 12345;
  const r = await req('PUT', `/sites/${ID}/estoque`, { corpo: { carros } });
  assert.equal(r.status, 202);
  const ok = await esperar(() => JSON.parse(fs.readFileSync(A.saida(ID, 'carros.json'), 'utf8')).some((c) => c.p === 12345));
  assert.ok(ok, `site não foi refeito. Saída do servidor:\n${saidaSrv}`);
  const st = await (await req('GET', '/status')).json();
  assert.equal(st.ultimo.resultado[0].estoques[0].status, 'atualizado');
});

test('PUT de estoque inválido: aceita a chamada, mas não grava (e o status mostra o erro)', async () => {
  const antes = fs.readFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), 'utf8');
  await req('PUT', `/sites/${ID}/estoque`, { corpo: { carros: [A.carro({ marca: '' })] } });
  const ok = await esperar(async () => { const st = await (await req('GET', '/status')).json(); return st.ultimo && st.ultimo.resultado[0].estoques[0].status === 'invalido'; });
  assert.ok(ok);
  assert.equal(fs.readFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), 'utf8'), antes);
});

test('token curto: o servidor nem sobe', async () => {
  const p = spawn(process.execPath, [path.join(A.PROJETO, 'core', 'servidor.js')], { env: { ...process.env, TOKEN_ATUALIZAR: 'curto', SITE_CARROS_RAIZ: A.raiz() } });
  const codigo = await new Promise((ok) => p.on('exit', ok));
  assert.equal(codigo, 1);
});
