// API de integração (core/servidor.js + core/fila.js + core/clientes.js): tokens por cliente, permissões por site,
// validação na hora (422), estoque inteiro, carro avulso, rajadas, fila que sobrevive a reinício e trava de queda.
const A = require('./ajuda');
A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const CL = require('../core/clientes.js');

const ID = 'loja-a.com.br';
const OUTRO = 'loja-b.com.br';
const ADMIN = 'token-admin-com-mais-de-16';
let srv, url, saidaSrv = '', tokA, tokTodos, tokDesligado;

const portaLivre = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const req = (metodo, caminho, { corpo, token = tokA } = {}) => fetch(url + caminho, {
  method: metodo, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  headers: token ? { authorization: `Bearer ${token}` } : {},
});
const reqJ = async (...a) => { const r = await req(...a); return { status: r.status, j: await r.json() }; };
const esperar = async (cond, ms = 10000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const estoque = (id = ID) => JSON.parse(fs.readFileSync(path.join(A.raiz(), 'sites', id, 'estoque.json'), 'utf8')).carros;
const carrosJson = (id = ID) => JSON.parse(fs.readFileSync(A.saida(id, 'carros.json'), 'utf8'));

async function subir(env = {}) {
  const porta = await portaLivre();
  const s = { url: `http://127.0.0.1:${porta}`, saida: '' };
  s.proc = spawn(process.execPath, [path.join(A.PROJETO, 'core', 'servidor.js')], {
    env: { ...process.env, PORT: String(porta), TOKEN_ATUALIZAR: ADMIN, ATRASO_MS: '50', SITE_CARROS_RAIZ: A.raiz(), ...env },
  });
  s.proc.stdout.on('data', (d) => (s.saida += d));
  s.proc.stderr.on('data', (d) => (s.saida += d));
  assert.ok(await esperar(() => s.saida.includes('API em')), `servidor não subiu: ${s.saida}`);
  return s;
}

before(async () => {
  A.criarSite(ID, { carros: Array.from({ length: 12 }, () => A.carro()) });
  A.criarSite(OUTRO, { carros: [A.carro()] });
  A.silencioso(() => require('../core/build.js').construir({}));
  tokA = CL.criarCliente('crm-loja-a', [ID]);
  tokTodos = CL.criarCliente('integrador', ['*']);
  tokDesligado = CL.criarCliente('desligado', ['*']);
  const todos = CL.lerClientes(); todos.desligado.ativo = false;
  fs.writeFileSync(path.join(A.raiz(), 'config', 'clientes.json'), JSON.stringify(todos));
  srv = await subir();
  url = srv.url;
  saidaSrv = srv.saida;
});
after(() => srv && srv.proc.kill());

test('o token fica só como hash no config/clientes.json', () => {
  const txt = fs.readFileSync(path.join(A.raiz(), 'config', 'clientes.json'), 'utf8');
  assert.ok(!txt.includes(tokA));
  assert.match(tokA, /^sc_/);
});

test('saúde sem token; o resto exige token válido e ativo', async () => {
  assert.equal((await req('GET', '/v1/saude', { token: null })).status, 200);
  assert.equal((await req('GET', '/v1/sites', { token: null })).status, 401);
  assert.equal((await req('GET', '/v1/sites', { token: 'sc_inventado_xxxxxxxxxxxxxxxxx' })).status, 401);
  assert.equal((await req('GET', '/v1/sites', { token: tokA + 'x' })).status, 401);
  assert.equal((await req('GET', '/v1/sites', { token: tokDesligado })).status, 401, 'cliente com "ativo": false');
});

test('cada cliente só vê e mexe nos sites dele', async () => {
  const { j } = await reqJ('GET', '/v1/sites');
  assert.deepEqual(j.sites.map((s) => s.site), [ID]);
  assert.equal(j.sites[0].carros, 12);
  assert.equal((await req('GET', `/v1/sites/${OUTRO}/estoque`)).status, 403);
  assert.equal((await req('PUT', `/v1/sites/${OUTRO}/estoque`, { corpo: { carros: [] } })).status, 403);
  assert.equal((await req('GET', `/v1/sites/${OUTRO}/estoque`, { token: tokTodos })).status, 200);
  assert.equal((await req('GET', `/v1/sites/${OUTRO}`, { token: ADMIN })).status, 200);
});

test('site inexistente, domínio esquisito e rota errada: 404 sem derrubar nada', async () => {
  assert.equal((await req('GET', '/v1/sites/nao-existe.com.br')).status, 404);
  assert.equal((await req('PUT', '/sites/..%2F..%2Fetc/estoque', { corpo: { carros: [] }, token: ADMIN })).status, 404);
  assert.equal((await req('PUT', '/sites/ABC.com/estoque', { corpo: { carros: [] }, token: ADMIN })).status, 404);
  assert.equal((await req('GET', '/v1/nada')).status, 404);
  assert.equal((await req('GET', '/v1/saude', { token: null })).status, 200);
});

test('JSON quebrado: 400; estoque inválido: 422 com a lista de erros e nada gravado', async () => {
  const antes = fs.readFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), 'utf8');
  assert.equal((await req('PUT', `/v1/sites/${ID}/estoque`, { corpo: '{quebrado' })).status, 400);
  const r = await reqJ('PUT', `/v1/sites/${ID}/estoque`, { corpo: { carros: [A.carro({ marca: '' }), A.carro({ ano: 1800 })] } });
  assert.equal(r.status, 422);
  assert.ok(r.j.erros.some((e) => /marca/.test(e)) && r.j.erros.some((e) => /ano/.test(e)), JSON.stringify(r.j));
  assert.equal(fs.readFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), 'utf8'), antes);
});

test('PUT do estoque inteiro com ?esperar: responde 200 já com o site refeito', async () => {
  const carros = estoque();
  carros[0].preco = 12345;
  const r = await reqJ('PUT', `/v1/sites/${ID}/estoque?esperar=20`, { corpo: { carros } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.status, 'concluido');
  assert.equal(r.j.resultado.estoque, 'atualizado');
  assert.ok(carrosJson().some((c) => c.p === 12345));
  // mesmo estoque de novo: concluído, sem mudança
  const igual = await reqJ('PUT', `/v1/sites/${ID}/estoque?esperar=20`, { corpo: carros }); // lista pura também vale
  assert.equal(igual.j.resultado.estoque, 'igual');
});

test('PUT sem esperar: 202 com número do pedido, acompanhado em /v1/pedidos/<id>', async () => {
  const carros = estoque();
  carros[1].km = 777;
  const r = await reqJ('PUT', `/v1/sites/${ID}/estoque`, { corpo: { carros } });
  assert.equal(r.status, 202);
  assert.equal(r.j.status, 'na_fila');
  assert.ok(await esperar(async () => (await reqJ('GET', r.j.link)).j.status === 'concluido'));
  assert.ok(carrosJson().some((c) => c.k === 777));
  // o pedido de um cliente não aparece para outro
  assert.equal((await req('GET', r.j.link, { token: tokTodos })).status, 404);
  assert.equal((await req('GET', r.j.link, { token: ADMIN })).status, 200);
});

test('carro avulso: inclui, altera e remove (com a página do carro acompanhando)', async () => {
  const novo = A.carro({ id: 'NOVO1' });
  delete novo.id;
  const inc = await reqJ('PUT', `/v1/sites/${ID}/carros/NOVO1?esperar=20`, { corpo: novo });
  assert.equal(inc.status, 200, JSON.stringify(inc.j));
  assert.ok(carrosJson().some((c) => c.i === 'NOVO1'));
  assert.equal((await reqJ('GET', `/v1/sites/${ID}/carros/NOVO1`)).j.preco, novo.preco);

  const alt = await reqJ('PUT', `/v1/sites/${ID}/carros/NOVO1?esperar=20`, { corpo: { ...novo, preco: 55555 } });
  assert.equal(alt.status, 200);
  assert.equal(carrosJson().find((c) => c.i === 'NOVO1').p, 55555);
  assert.equal(estoque().filter((c) => c.id === 'NOVO1').length, 1, 'alterar não duplica');

  const del = await reqJ('DELETE', `/v1/sites/${ID}/carros/NOVO1?esperar=20`);
  assert.equal(del.status, 200);
  assert.ok(!carrosJson().some((c) => c.i === 'NOVO1'));
  assert.equal((await req('DELETE', `/v1/sites/${ID}/carros/NOVO1`)).status, 404);
});

test('carro avulso inválido: 422; id do corpo diferente do endereço: 400', async () => {
  const r = await reqJ('PUT', `/v1/sites/${ID}/carros/RUIM1`, { corpo: { ...A.carro(), id: undefined, preco: -1, loja: 'nao-existe' } });
  assert.equal(r.status, 422);
  assert.ok(r.j.erros.some((e) => /preco/.test(e)) && r.j.erros.some((e) => /loja/.test(e)));
  assert.equal((await req('PUT', `/v1/sites/${ID}/carros/X1`, { corpo: A.carro({ id: 'X2' }) })).status, 400);
  assert.equal((await req('PUT', `/v1/sites/${ID}/carros/a%20b`, { corpo: A.carro() })).status, 400);
});

test('rajada de carros avulsos: todos entram, na ordem, num build só', async () => {
  const ids = ['R1', 'R2', 'R3', 'R4', 'R5'];
  const builds = () => (srv.saida.match(new RegExp(`${ID.replace(/\./g, '\\.')}: \\d+ carros`, 'g')) || []).length;
  const antes = builds();
  const rs = await Promise.all(ids.map((id) => reqJ('PUT', `/v1/sites/${ID}/carros/${id}`, { corpo: A.carro({ id }) })));
  assert.ok(rs.every((r) => r.status === 202));
  // e logo depois, um que altera o R1 (tem que valer o último)
  const ult = await reqJ('PUT', `/v1/sites/${ID}/carros/R1?esperar=20`, { corpo: A.carro({ id: 'R1', preco: 99 }) });
  assert.equal(ult.status, 200);
  for (const r of rs) assert.equal((await reqJ('GET', r.j.link)).j.status, 'concluido');
  assert.ok(ids.every((id) => carrosJson().some((c) => c.i === id)));
  assert.equal(carrosJson().find((c) => c.i === 'R1').p, 99);
  assert.ok(builds() - antes <= 2, `build demais para uma rajada: ${builds() - antes}`);
});

test('POST build refaz o site sem mudar o estoque', async () => {
  fs.rmSync(A.saida(ID, '404.html'));
  const r = await reqJ('POST', `/v1/sites/${ID}/build?esperar=20`);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.ok(A.existe(ID, '404.html'));
});

test('trava de queda: 409 recusado; com ?forcar=1 passa', async () => {
  const poucos = estoque().slice(0, 2);
  const r = await reqJ('PUT', `/v1/sites/${ID}/estoque?esperar=20`, { corpo: { carros: poucos } });
  assert.equal(r.status, 409, JSON.stringify(r.j));
  assert.equal(r.j.status, 'recusado');
  assert.ok(estoque().length > 2);
  const f = await reqJ('PUT', `/v1/sites/${ID}/estoque?esperar=20&forcar=1`, { corpo: { carros: poucos } });
  assert.equal(f.status, 200);
  assert.equal(estoque().length, 2);
});

test('rotas antigas continuam valendo (/status, PUT /sites/<d>/estoque)', async () => {
  assert.equal((await req('GET', '/status', { token: ADMIN })).status, 200);
  const r = await req('PUT', `/sites/${ID}/estoque`, { corpo: { carros: estoque() }, token: ADMIN });
  assert.equal(r.status, 202);
});

test('pedido na fila sobrevive a reinício do servidor', async () => {
  const lento = await subir({ ATRASO_MS: '60000' }); // não processa antes de cair
  const carros = estoque();
  carros[0].preco = 424242;
  const r = await fetch(`${lento.url}/v1/sites/${ID}/estoque`, { method: 'PUT', body: JSON.stringify({ carros }), headers: { authorization: `Bearer ${tokA}` } });
  const j = await r.json();
  assert.equal(r.status, 202);
  lento.proc.kill('SIGKILL');
  await new Promise((ok) => lento.proc.on('exit', ok));
  assert.ok(!carrosJson().some((c) => c.p === 424242), 'ainda não processou');
  const volta = await subir();
  try {
    assert.ok(await esperar(() => carrosJson().some((c) => c.p === 424242)), `não processou depois de voltar:\n${volta.saida}`);
    const ped = await (await fetch(`${volta.url}${j.link}`, { headers: { authorization: `Bearer ${tokA}` } })).json();
    assert.equal(ped.status, 'concluido');
  } finally { volta.proc.kill(); }
});

test('sem nenhum token configurado ou com TOKEN_ATUALIZAR curto: o servidor nem sobe', async () => {
  for (const env of [{ TOKEN_ATUALIZAR: 'curto' }, { TOKEN_ATUALIZAR: '', SITE_CARROS_RAIZ: fs.mkdtempSync(path.join(require('os').tmpdir(), 'sc-vazio-')) }]) {
    const p = spawn(process.execPath, [path.join(A.PROJETO, 'core', 'servidor.js')], { env: { ...process.env, SITE_CARROS_RAIZ: A.raiz(), ...env } });
    assert.equal(await new Promise((ok) => p.on('exit', ok)), 1);
  }
});
