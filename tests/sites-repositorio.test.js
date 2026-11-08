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
