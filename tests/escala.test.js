// Escala (Kubernetes): pods de API e de trabalhador separados, falando só pelo volume compartilhado (aqui, a pasta
// temporária; na AWS, o EFS). Vários trabalhadores dividem os sites, o mesmo site nunca é processado por dois ao mesmo
// tempo, pedido não se perde sem trabalhador e trava de pod morto é recuperada.
const A = require('./ajuda');
A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ADMIN = 'admin-da-plataforma-1234567';
const SITES = Array.from({ length: 8 }, (_, i) => `escala${i + 1}.com.br`);
const pods = [];
const porta = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const esperar = async (cond, ms = 20000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
async function subir(papel, env = {}) {
  const p = { papel, saida: '', porta: await porta() };
  p.proc = spawn(process.execPath, [path.join(A.PROJETO, 'api', 'servidor.js')], {
    env: { ...process.env, PAPEL: papel, PORT: String(p.porta), ATRASO_MS: '50', PARALELO: '1', TOKEN_ATUALIZAR: ADMIN, SITE_CARROS_RAIZ: A.raiz(), ...env },
  });
  p.proc.stdout.on('data', (d) => (p.saida += d)); p.proc.stderr.on('data', (d) => (p.saida += d));
  assert.ok(await esperar(() => p.saida.includes('API em')), p.saida);
  pods.push(p);
  return p;
}
const parar = async (p) => { p.proc.kill('SIGKILL'); await new Promise((ok) => p.proc.on('exit', ok)); pods.splice(pods.indexOf(p), 1); };
let api;
const req = async (metodo, caminho, corpo) => { const r = await fetch(`http://127.0.0.1:${api.porta}${caminho}`, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo), headers: { authorization: `Bearer ${ADMIN}` } }); return { status: r.status, j: await r.json() }; };

before(async () => {
  for (const s of SITES) A.criarSite(s, { carros: [A.carro(), A.carro()] });
  api = await subir('api');
});
after(() => pods.forEach((p) => p.proc.kill('SIGKILL')));

test('pod de API sozinho: aceita e enfileira; sem trabalhador, nada é processado (e nada se perde)', async () => {
  const r = await req('POST', `/v1/sites/${SITES[0]}/build`);
  assert.equal(r.status, 202);
  await new Promise((ok) => setTimeout(ok, 400));
  assert.equal((await req('GET', r.j.link)).j.status, 'na_fila');
  assert.ok(!A.existe(SITES[0], 'index.html'));
  // pod de trabalhador não atende API, mas responde saúde
  const t = await subir('trabalhador');
  assert.ok(await esperar(async () => (await req('GET', r.j.link)).j.status === 'concluido'), t.saida);
  const s = await fetch(`http://127.0.0.1:${t.porta}/v1/saude`);
  assert.equal((await s.json()).papel, 'trabalhador');
  assert.equal((await fetch(`http://127.0.0.1:${t.porta}/v1/sites`, { headers: { authorization: `Bearer ${ADMIN}` } })).status, 404);
});

test('dois trabalhadores dividem os sites de um "refazer todos" e todos terminam', async () => {
  if (pods.filter((p) => p.papel === 'trabalhador').length < 2) await subir('trabalhador');
  const r = await req('POST', '/v1/build?esperar=60', {});
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.total, SITES.length);
  assert.ok(SITES.every((s) => A.existe(s, 'index.html')));
  const trabalhadores = pods.filter((p) => p.papel === 'trabalhador');
  const fizeram = trabalhadores.map((t) => SITES.filter((s) => t.saida.includes(`${s}: `)).length);
  assert.ok(fizeram.every((n) => n > 0), `os dois trabalharam (${fizeram.join(' + ')})`);
});

test('rajada no MESMO site com dois trabalhadores: tudo aplicado, na ordem, sem conflito', async () => {
  const S = SITES[1];
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push(await req('PUT', `/v1/sites/${S}/carros/R${i}`, A.carro({ id: `R${i}`, preco: 1000 + i })));
  ps.push(await req('PUT', `/v1/sites/${S}/carros/R0`, A.carro({ id: 'R0', preco: 99 })));
  assert.ok(await esperar(async () => (await Promise.all(ps.map((p) => req('GET', p.j.link)))).every((x) => x.j.status === 'concluido')));
  const carros = A.lerJSON(S, 'estoque.json');
  assert.equal(carros.filter((c) => /^R\d$/.test(c.i)).length, 6);
  assert.equal(carros.find((c) => c.i === 'R0').p, 99, 'o último pedido vale');
});

test('trava de um pod que morreu no meio é recuperada (expira) e o site é processado', async () => {
  const S = SITES[2];
  const T = require('../core/trava.js');
  const lock = T.arquivo(`fila-principal-${S}`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, 'pod-que-morreu:1');
  const r = await req('POST', `/v1/sites/${S}/build`);
  await new Promise((ok) => setTimeout(ok, 500));
  assert.notEqual((await req('GET', r.j.link)).j.status, 'concluido', 'travado enquanto a trava vale');
  const velho = Date.now() / 1000 - 31 * 60;
  fs.utimesSync(lock, velho, velho);
  assert.ok(await esperar(async () => (await req('GET', r.j.link)).j.status === 'concluido'));
});

test('readiness e métricas para o Kubernetes', async () => {
  const pr = await fetch(`http://127.0.0.1:${api.porta}/v1/pronto`);
  assert.equal(pr.status, 200);
  const m = await (await fetch(`http://127.0.0.1:${api.porta}/metrics`)).text();
  assert.match(m, /^site_carros_fila_pedidos\{canal="principal"\} \d+$/m);
  assert.match(m, /^site_carros_fila_pedidos\{canal="fotos"\} \d+$/m);
});

test('publicação não perde o que foi gerado DURANTE a publicação', () => {
  const P = require('../core/pendentes.js');
  P.registrar('dist-x', 'a.com.br', { escritos: ['a.com.br/1.html'], removidos: [] });
  const res = P.reservar('dist-x', 'a.com.br');
  P.registrar('dist-x', 'a.com.br', { escritos: ['a.com.br/2.html'], removidos: [] }); // build no meio da publicação
  res.devolver(); // a publicação falhou
  assert.deepEqual(P.ler('dist-x', 'a.com.br').escritos.sort(), ['a.com.br/1.html', 'a.com.br/2.html']);
  const ok = P.reservar('dist-x', 'a.com.br');
  P.registrar('dist-x', 'a.com.br', { escritos: ['a.com.br/3.html'], removidos: [] });
  ok.confirmar(); // publicou 1 e 2
  assert.deepEqual(P.ler('dist-x', 'a.com.br').escritos, ['a.com.br/3.html'], 'o 3 fica para a próxima');
});

test('trava é renovada enquanto o trabalho dura (assíncrono e build síncrono longo)', async () => {
  const T = require('../core/trava.js');
  process.env.SITE_CARROS_TRAVA_EXPIRA_MS = '300';
  try {
    let tentouNoMeio = null;
    await T.comTrava('longo', async () => {
      await new Promise((ok) => setTimeout(ok, 800)); // bem mais que o prazo de 300 ms
      tentouNoMeio = T.travar('longo');
    });
    assert.equal(tentouNoMeio, false, 'outro pod não pega o site no meio do trabalho');
    // trabalho síncrono (como o build): sem o temporizador, quem renova é o próprio laço
    let roubou = null;
    await T.comTrava('sincrono', () => {
      const fim = Date.now() + 800;
      while (Date.now() < fim) T.renovarMinhas();
      roubou = T.travar('sincrono');
    });
    assert.equal(roubou, false);
    // e quem morre sem soltar: expira no prazo
    T.travar('morto');
    const velho = Date.now() / 1000 - 1;
    fs.utimesSync(T.arquivo('morto'), velho, velho);
    assert.equal(T.travar('morto'), true, 'trava de quem parou de renovar expira');
  } finally { delete process.env.SITE_CARROS_TRAVA_EXPIRA_MS; }
});

test('listar pedidos de um site lê só o índice dele (não a pasta inteira)', () => {
  const { criarFila } = require('../api/fila.js');
  const f = criarFila();
  const a = f.adicionar({ tipo: 'build', site: 'indice-a.com.br', cliente: 'x' });
  f.adicionar({ tipo: 'build', site: 'indice-b.com.br', cliente: 'y' });
  const a2 = f.adicionar({ tipo: 'build', site: 'indice-a.com.br', cliente: 'y' });
  assert.deepEqual(f.listar({ site: 'indice-a.com.br' }).map((p) => p.id), [a2.id, a.id]);
  assert.deepEqual(f.listar({ site: 'indice-a.com.br', cliente: 'x' }).map((p) => p.id), [a.id]);
  assert.equal(f.listar({ cliente: 'y' }).length, 2);
  // o índice não lê pedido de outro site: apagar os do site b não muda a lista do a
  assert.equal(f.listar({ site: 'indice-a.com.br', limite: 1 }).length, 1);
});
