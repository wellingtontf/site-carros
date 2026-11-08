// Atualização de estoque (core/atualizar.js): fontes HTTP, validação, trava de queda, trava de execução e publicação.
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { atualizar, publicarPendentes } = require('../core/atualizar.js');

const ID = 'loja-a.com.br';
const OUTRO = 'loja-b.com.br';
const estoqueDe = (id) => JSON.parse(fs.readFileSync(path.join(A.raiz(), 'sites-config', id, 'estoque.json'), 'utf8'));
const config = (arq, obj) => fs.writeFileSync(path.join(A.raiz(), 'config', arq), JSON.stringify(obj));
const rodar = (opts) => A.silenciosoAsync(() => atualizar({ log: () => {}, ...opts })).then((x) => x.r);

// "API do Revenda Mais" de mentira: responde o que estiver em respostas[url]
let api, base;
const respostas = {};
before(async () => {
  api = http.createServer((req, res) => {
    const r = respostas[req.url];
    if (!r) { res.writeHead(404); return res.end(); }
    if (r.auth && req.headers.authorization !== r.auth) { res.writeHead(401); return res.end(); }
    if (r.status) { res.writeHead(r.status); return res.end('erro'); }
    if (r.lento) return; // nunca responde (para testar o timeout, se quiser)
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo));
  }).listen(0);
  await new Promise((ok) => api.on('listening', ok));
  base = `http://127.0.0.1:${api.address().port}`;
});
after(() => api.close());

beforeEach(() => {
  A.limpar();
  for (const k of Object.keys(respostas)) delete respostas[k];
  A.criarSite(ID, { carros: Array.from({ length: 12 }, () => A.carro()) });
  A.criarSite(OUTRO, { carros: [A.carro()] });
  A.silencioso(() => require('../core/build.js').construir({}));
});

test('estoque recebido válido: grava e refaz SÓ o site dele', async () => {
  const novo = estoqueDe(ID).carros.slice(0, 11);
  novo[0].preco = 1;
  const antesOutro = fs.statSync(A.saida(OUTRO, 'carros.json')).mtimeMs;
  const r = await rodar({ recebidos: { [ID]: { carros: novo } } });
  assert.equal(r.estoques[0].status, 'atualizado');
  assert.deepEqual(r.sites, [ID]);
  assert.equal(estoqueDe(ID).carros.length, 11);
  assert.equal(fs.statSync(A.saida(OUTRO, 'carros.json')).mtimeMs, antesOutro, 'outro site não foi tocado');
  assert.ok(fs.existsSync(path.join(A.raiz(), '.estado', 'estoques-anteriores', `${ID}.json`)), 'guarda o anterior');
});

test('estoque inválido: nada é gravado, o anterior continua valendo', async () => {
  const antes = estoqueDe(ID);
  const r = await rodar({ recebidos: { [ID]: { carros: [A.carro({ preco: 0 })] } } });
  assert.equal(r.estoques[0].status, 'invalido');
  assert.deepEqual(estoqueDe(ID), antes);
});

test('estoque igual: não faz nada', async () => {
  const r = await rodar({ recebidos: { [ID]: { carros: estoqueDe(ID).carros } } });
  assert.equal(r.estoques[0].status, 'igual');
  assert.deepEqual(r.sites, []);
});

test('trava de queda: caiu mais de 50% → recusa; forcar libera', async () => {
  const poucos = estoqueDe(ID).carros.slice(0, 5);
  let r = await rodar({ recebidos: { [ID]: { carros: poucos } } });
  assert.equal(r.estoques[0].status, 'recusado');
  assert.equal(estoqueDe(ID).carros.length, 12);
  r = await rodar({ recebidos: { [ID]: { carros: poucos } }, forcar: true });
  assert.equal(r.estoques[0].status, 'atualizado');
});

test('API devolvendo lista vazia é recusada (o erro mais perigoso: apagaria o site inteiro)', async () => {
  const r = await rodar({ recebidos: { [ID]: { carros: [] } } });
  assert.equal(r.estoques[0].status, 'recusado');
});

test('loja pequena (menos de 10 carros) recebendo lista vazia também é recusada', async () => {
  let r = await rodar({ recebidos: { [OUTRO]: { carros: [] } } });
  assert.equal(r.estoques[0].status, 'recusado');
  assert.equal(estoqueDe(OUTRO).carros.length, 1);
  r = await rodar({ recebidos: { [OUTRO]: { carros: [] } }, forcar: true });
  assert.equal(r.estoques[0].status, 'atualizado', 'com forçar, zera (loja fechou de verdade)');
});

test('site inexistente é recusado', async () => {
  const r = await rodar({ recebidos: { 'nao-existe.com.br': { carros: [] } } });
  assert.equal(r.estoques[0].status, 'invalido');
});

test('fontes.json: busca por HTTP, aceita lista direta e ${VAR} em url e headers', async () => {
  process.env.TOKEN_TESTE = 'Bearer segredo';
  const carros = estoqueDe(ID).carros.slice(0, 11);
  respostas['/a'] = { corpo: carros, auth: 'Bearer segredo' };
  config('fontes.json', { [ID]: { url: `${base}/a`, headers: { Authorization: '${TOKEN_TESTE}' } } });
  const r = await rodar({});
  assert.equal(r.estoques[0].status, 'atualizado', JSON.stringify(r.estoques));
  assert.equal(estoqueDe(ID).carros.length, 11);
});

test('fontes.json: HTTP 500, JSON quebrado, variável faltando e site sem fonte não derrubam nada', async () => {
  const antes = estoqueDe(ID);
  respostas['/erro'] = { status: 500 };
  respostas['/quebrado'] = { corpo: '{"carros": [' };
  config('fontes.json', { [ID]: `${base}/erro`, [OUTRO]: `${base}/quebrado` });
  let r = await rodar({});
  assert.deepEqual(r.estoques.map((e) => e.status), ['erro', 'erro']);
  assert.match(r.estoques[0].erros[0], /HTTP 500/);
  config('fontes.json', { [ID]: '${NAO_DEFINIDA}/x' });
  r = await rodar({});
  assert.match(r.estoques[0].erros[0], /NAO_DEFINIDA/);
  r = await rodar({ sites: [OUTRO] });
  assert.match(r.estoques[0].erros[0], /sem fonte/);
  assert.deepEqual(estoqueDe(ID), antes);
});

test('sem fontes.json: erro claro', async () => {
  await assert.rejects(() => rodar({}), /config\/fontes\.json/);
});

test('trava POR SITE: site ocupado → "ocupado"; outro site segue; trava velha (30 min) é ignorada', async () => {
  const T = require('../core/trava.js');
  const lock = T.arquivo(T.chaveSite(ID));
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, 'outro-pod:123');
  const c = estoqueDe(ID).carros; c[0].preco += 7;
  assert.equal((await rodar({ recebidos: { [ID]: { carros: c } } })).status, 'ocupado');
  // outro site não espera por este
  const o = estoqueDe(OUTRO).carros; o[0].preco += 7;
  const r = await rodar({ recebidos: { [ID]: { carros: c }, [OUTRO]: { carros: o } } });
  assert.equal(r.status, 'ok');
  assert.deepEqual([r.sites, r.ocupados], [[OUTRO], [ID]]);
  const velho = Date.now() / 1000 - 31 * 60;
  fs.utimesSync(lock, velho, velho);
  assert.equal((await rodar({ recebidos: { [ID]: { carros: c } } })).status, 'ok');
  assert.ok(!fs.existsSync(lock), 'libera a trava no fim');
});

test('trava é liberada mesmo se der erro no meio', async () => {
  const T = require('../core/trava.js');
  await assert.rejects(T.comTrava('teste-erro', () => { throw new Error('x'); }), /x/);
  assert.ok(!fs.existsSync(T.arquivo('teste-erro')));
  assert.equal((await T.comTrava(['b', 'a'], () => ({ status: 'ok' }))).status, 'ok');
});

test('publicar: roda o comando por site com {lista}; só limpa a pendência de quem deu certo', async () => {
  const log = path.join(A.raiz(), 'publicados.txt');
  // o site OUTRO "falha" na publicação
  config('publicacao.json', { paralelo: 2, comandoSite: `test {site} != '${OUTRO}' && echo {site}:{completo}:{lista} >> '${log}'` });
  const r = await A.silenciosoAsync(() => publicarPendentes({ log: () => {} })).then((x) => x.r);
  assert.deepEqual(r.publicados, [ID]);
  assert.deepEqual(r.falhas, [OUTRO]);
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(`^${ID.replace(/\./g, '\\.')}:1:`));
  assert.deepEqual(require('../core/pendentes').listar('sites-public'), [OUTRO], 'quem falhou continua pendente');
});

test('publicar: {lista} só com os arquivos que mudaram (publicação incremental)', async () => {
  A.limparPendentes();
  const c = estoqueDe(ID).carros;
  c[0].preco += 1;
  await rodar({ recebidos: { [ID]: { carros: c } } });
  const log = path.join(A.raiz(), 'lista.txt');
  config('publicacao.json', { comandoSite: `echo {lista} > '${log}'` });
  await A.silenciosoAsync(() => publicarPendentes({ log: () => {} }));
  const lista = fs.readFileSync(log, 'utf8').trim().split(',');
  assert.ok(lista.includes('carros.json'));
  assert.ok(lista.some((x) => x.startsWith('carros/') && x.endsWith('.html')));
  assert.ok(lista.length <= 6, `lista pequena, veio: ${lista}`); // carro, carros.json, estoque.xml, home, /multipla, 404 (vitrine)
});

test('publicar: nome de arquivo com aspas não injeta comando no shell', async () => {
  A.limparPendentes();
  require('../core/pendentes').registrar('sites-public', ID, { escritos: [`${ID}/x'; touch '${path.join(A.raiz(), 'HACK')}'; '.html`], removidos: [] });
  config('publicacao.json', { comandoSite: 'echo {lista} > /dev/null' });
  await A.silenciosoAsync(() => publicarPendentes({ log: () => {} }));
  assert.ok(!fs.existsSync(path.join(A.raiz(), 'HACK')));
});
