// Repositório de sites (core/sites.js) e operações de infraestrutura (core/operacoes.js): o único lugar que lista
// sites, site novo só com o domínio em todos os templates, e troca de domínio que volta atrás se algo falhar.
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Sites = require('../core/sites.js');
const Ops = require('../core/operacoes.js');
const { construir } = require('../core/build.js');

beforeEach(() => A.limpar());
const quieto = { log: () => {} };

test('listar: só pastas com site.json, em ordem; existe() não aceita caminho torto', () => {
  A.criarSite('b.com.br'); A.criarSite('a.com.br');
  fs.mkdirSync(path.join(A.raiz(), 'sites', 'sem-cadastro.com.br'));
  assert.deepEqual(Sites.listar(), ['a.com.br', 'b.com.br']);
  assert.equal(Sites.existe('a.com.br'), true);
  for (const x of ['sem-cadastro.com.br', '../sites/a.com.br', 'A.com.br', '', undefined]) assert.equal(Sites.existe(x), false, String(x));
  assert.deepEqual(Sites.resumo('a.com.br').carros, 0);
  assert.deepEqual(Sites.resumos((d) => d.startsWith('b')).map((r) => r.site), ['b.com.br']);
});

test('regra da casa: só core/sites.js lê a pasta sites/ (o resto usa o repositório)', () => {
  const codigo = [...A.listar(path.join(A.PROJETO, 'core')), ...A.listar(path.join(A.PROJETO, 'api'))].filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}motor${path.sep}`));
  const ruins = codigo.filter((f) => !f.endsWith(`core${path.sep}sites.js`) && /readdirSync\(\s*C\.SITES|idsSites|listarSites/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(ruins.map((f) => path.relative(A.PROJETO, f)), []);
});

test('site novo só com o domínio funciona em TODOS os templates (sem lojas e sem carros)', async () => {
  const tpls = fs.readdirSync(path.join(A.PROJETO, 'templates'));
  for (const t of tpls) {
    const d = `novo-${t}.com.br`;
    const r = await Ops.criarSite(d, { template: t }, quieto);
    assert.equal(r.status, 'ok', `${t}: ${JSON.stringify(r)}`);
    assert.equal(r.infra.status, 'nao_configurada');
    assert.deepEqual(A.verificarSiteGerado(d).slice(0, 5), [], `template ${t}`);
  }
});

test('criarSite: domínio existente ou cadastro inválido não cria nada', async () => {
  A.criarSite('ja.com.br');
  assert.equal((await Ops.criarSite('ja.com.br', {}, quieto)).status, 'existe');
  const r = await Ops.criarSite('ruim.com.br', { template: 'nao-existe' }, quieto);
  assert.equal(r.status, 'invalido');
  assert.ok(!fs.existsSync(path.join(A.raiz(), 'sites', 'ruim.com.br')));
});

test('renomearSite: se o build falhar no meio, tudo volta como estava', async () => {
  A.criarSite('velho.com.br', { carros: [A.carro()] });
  A.silencioso(() => construir({ sites: ['velho.com.br'] }));
  // estraga o template só para o build do domínio novo falhar
  const cfg = A.lerSite('velho.com.br'); cfg.template = 'some-durante-o-teste'; A.gravarSite('velho.com.br', cfg);
  await assert.rejects(Ops.renomearSite('velho.com.br', 'novo.com.br', quieto), /template/);
  assert.ok(fs.existsSync(path.join(A.raiz(), 'sites', 'velho.com.br', 'site.json')), 'cadastro voltou');
  assert.ok(A.existe('velho.com.br', 'index.html'), 'saída voltou');
  assert.ok(fs.existsSync(path.join(A.raiz(), '.estado', 'dist', 'velho.com.br.json')), 'estado voltou');
  assert.ok(!fs.existsSync(path.join(A.raiz(), 'sites', 'novo.com.br')) && !A.existe('novo.com.br', ''));
  assert.equal(A.lerSite('velho.com.br').url, 'https://velho.com.br', 'menções ao domínio voltaram');
});

test('renomearSite: troca o domínio no fontes.json e não mexe em domínio parecido', async () => {
  A.criarSite('loja.com', { site: { url: 'https://loja.com', rodape: { outro: 'https://loja.com.br', parecido: 'minhaloja.com' } } });
  fs.writeFileSync(path.join(A.raiz(), 'config', 'fontes.json'), JSON.stringify({ 'loja.com': 'https://api/x' }));
  const r = await Ops.renomearSite('loja.com', 'loja2.com', quieto);
  assert.equal(r.status, 'ok');
  const cad = A.lerSite('loja2.com');
  assert.equal(cad.url, 'https://loja2.com');
  assert.equal(cad.rodape.outro, 'https://loja.com.br', 'loja.com.br é outro domínio');
  assert.equal(cad.rodape.parecido, 'minhaloja.com');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(A.raiz(), 'config', 'fontes.json'), 'utf8')), { 'loja2.com': 'https://api/x' });
});

// ---------- rascunho → definitivo ----------
const todasPaginas = (d) => A.listar(A.saida(d)).filter((f) => f.endsWith('.html')).map((f) => [path.relative(A.saida(d), f), fs.readFileSync(f, 'utf8')]);

test('rascunho: toda página com noindex e robots.txt fechado (inclusive ao reescrever o robots de todos)', async () => {
  A.criarSite('rascunho.teste.com.br', { carros: [A.carro(), A.carro()], site: { rascunho: true } });
  A.criarSite('definitivo.teste.com.br', { carros: [A.carro()] });
  A.silencioso(() => construir({}));
  const semNoindex = todasPaginas('rascunho.teste.com.br').filter(([, h]) => !/<meta name="robots" content="noindex/.test(h)).map(([f]) => f);
  assert.deepEqual(semNoindex, []);
  assert.equal(A.ler('rascunho.teste.com.br', 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  assert.ok(todasPaginas('definitivo.teste.com.br').some(([, h]) => !/noindex/.test(h)), 'site definitivo continua indexável');
  require('../core/robots.js').gravarModelo('User-agent: *\nAllow: /\nSitemap: {{sitemap}}\n# modelo');
  await require('../core/atualizar.js').reescreverRobots();
  assert.equal(A.ler('rascunho.teste.com.br', 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'o modelo não abre o rascunho');
  assert.match(A.ler('definitivo.teste.com.br', 'robots.txt'), /# modelo/);
  require('../core/robots.js').gravarModelo(null);
});

test('promover para o domínio definitivo: volta ao Google, gerado do zero, sem o histórico do rascunho', async () => {
  const R = 'loja-x.rascunho.plataforma.com.br', F = 'lojax.com.br';
  fs.writeFileSync(path.join(A.raiz(), 'config', 'infra.json'), JSON.stringify({ promover: 'echo {rascunho} {site} {pasta} >> infra.log' }));
  A.criarSite(R, { carros: [A.carro({ id: 'P1' }), A.carro({ id: 'P2' })], site: { rascunho: true, url: `https://${R}` } });
  A.silencioso(() => construir({ sites: [R] }));
  A.gravarEstoque(R, [A.carro({ id: 'P1' })]); // P2 "vendido" durante os testes do rascunho
  A.silencioso(() => construir({ sites: [R] }));
  const est = () => JSON.parse(fs.readFileSync(path.join(A.raiz(), '.estado', 'dist', `${F}.json`), 'utf8'));

  const r = await Ops.promoverSite(R, { final: F, url: `https://www.${F}`, log: () => {} });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.infra.status, 'ok');
  assert.ok(!Sites.existe(R) && !A.existe(R, ''), 'o rascunho sumiu');
  const cad = A.lerSite(F);
  assert.equal(cad.rascunho, undefined);
  assert.equal(cad.url, `https://www.${F}`);
  assert.deepEqual(todasPaginas(F).filter(([, h]) => /content="noindex, nofollow"/.test(h)).map(([f]) => f), [], 'nenhum noindex de rascunho');
  assert.equal(A.ler(F, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://www.${F}/sitemap.xml\n`);
  assert.ok(!A.ler(F, 'sitemap.xml').includes('rascunho'));
  assert.deepEqual(est().vendidos, {}, 'vendido do rascunho não vai para o definitivo');
  assert.equal(A.pendente(F).completo, true);
  assert.equal(A.pendente(R), undefined);
  assert.match(fs.readFileSync(path.join(A.raiz(), 'infra.log'), 'utf8'), new RegExp(`${R} ${F} dist/${F}`));
});

test('promover no próprio domínio; recusas: já definitivo, foto em localhost (nada muda)', async () => {
  A.criarSite('aqui.com.br', { carros: [A.carro()], site: { rascunho: true } });
  A.silencioso(() => construir({ sites: ['aqui.com.br'] }));
  const r = await Ops.promoverSite('aqui.com.br', { log: () => {} });
  assert.equal(r.status, 'ok');
  assert.equal(A.lerSite('aqui.com.br').rascunho, undefined);
  assert.ok(!/noindex, nofollow/.test(A.ler('aqui.com.br', 'index.html')));
  assert.equal((await Ops.promoverSite('aqui.com.br', { log: () => {} })).status, 'recusado');

  A.criarSite('local.rascunho.com.br', { carros: [A.carro()], site: { rascunho: true, fotosBase: 'http://localhost:8081/' } });
  A.silencioso(() => construir({ sites: ['local.rascunho.com.br'] }));
  const ruim = await Ops.promoverSite('local.rascunho.com.br', { final: 'local-final.com.br', log: () => {} });
  assert.equal(ruim.status, 'invalido');
  assert.match(ruim.erros[0], /localhost/);
  assert.ok(Sites.existe('local.rascunho.com.br') && !Sites.existe('local-final.com.br'), 'voltou tudo');
  assert.equal(A.lerSite('local.rascunho.com.br').rascunho, true);
  assert.ok(A.existe('local.rascunho.com.br', 'index.html'));
});

// ---------- rascunhos em sequência: site1.carro57.com.br, site2... ----------
const configRascunho = () => fs.writeFileSync(path.join(A.raiz(), 'config', 'rascunhos.json'), JSON.stringify({ padrao: 'site{n}.carro57.com.br' }));
test('proximoRascunho: segue a sequência, pula o que existe e nunca reutiliza número', () => {
  assert.throws(() => Sites.proximoRascunho(), /não tem padrão de rascunho/, 'sem padrão configurado, não inventa endereço');
  configRascunho();
  assert.equal(Sites.proximoRascunho(), 'site1.carro57.com.br');
  assert.equal(Sites.proximoRascunho(), 'site1.carro57.com.br', 'sem reservar, não gasta o número');
  assert.equal(Sites.proximoRascunho({ reservar: true }), 'site1.carro57.com.br');
  assert.equal(Sites.proximoRascunho({ reservar: true }), 'site2.carro57.com.br');
  Sites.criarArquivos('site7.carro57.com.br', Sites.cadastroNovo('site7.carro57.com.br', { template: 'teste' })); // criado com domínio explícito
  assert.equal(Sites.proximoRascunho(), 'site8.carro57.com.br');
  fs.rmSync(path.join(A.raiz(), 'sites', 'site7.carro57.com.br'), { recursive: true }); // promovido/removido
  Sites.proximoRascunho({ reservar: true }); // site8
  assert.equal(Sites.proximoRascunho(), 'site9.carro57.com.br', 'o 7 não volta');
  for (const [d, e] of [['site12.carro57.com.br', true], ['site0.carro57.com.br', false], ['xsite1.carro57.com.br', false], ['site1.carro57.com.br.br', false], ['lojax.com.br', false]]) assert.equal(Sites.ehDominioRascunho(d), e, d);
});

test('padrão de rascunho configurável; endereço de rascunho é sempre rascunho; promover para rascunho é recusado', async () => {
  fs.writeFileSync(path.join(A.raiz(), 'config', 'rascunhos.json'), JSON.stringify({ padrao: 'loja{n}.previa.com.br' }));
  try {
    assert.equal(Sites.proximoRascunho(), 'loja1.previa.com.br');
    assert.equal(Sites.cadastroNovo('loja1.previa.com.br', { rascunho: false }).rascunho, true);
    assert.equal(Sites.cadastroNovo('lojafinal.com.br', {}).rascunho, undefined);
    A.criarSite('loja1.previa.com.br', { carros: [A.carro()], site: { rascunho: true } });
    A.silencioso(() => construir({ sites: ['loja1.previa.com.br'] }));
    assert.equal((await Ops.promoverSite('loja1.previa.com.br', { log: () => {} })).status, 'invalido', 'no próprio endereço de rascunho não');
    assert.equal((await Ops.promoverSite('loja1.previa.com.br', { final: 'loja2.previa.com.br', log: () => {} })).status, 'invalido');
    fs.writeFileSync(path.join(A.raiz(), 'config', 'rascunhos.json'), JSON.stringify({ padrao: 'sem-numero.com.br' }));
    assert.throws(() => Sites.proximoRascunho(), /\{n\}/);
  } finally { fs.rmSync(path.join(A.raiz(), 'config', 'rascunhos.json'), { force: true }); }
});
