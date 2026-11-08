// Multi-tenant: cada inquilino (Revenda Mais, Webmotors, terceiros) só enxerga e mexe nos sites dele, com configuração
// própria (rascunho, templates, robots, modelo de site, publicação, infra). O domínio é único na plataforma.
const A = require('./ajuda');
A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const Inq = require('../core/inquilinos.js');
const Sites = require('../core/sites.js');
const CL = require('../api/clientes.js');

let srv, url, saida = '', tokRM, tokWM, tokWMum;
const ADMIN = 'admin-da-plataforma-1234567';
const req = async (metodo, caminho, { corpo, token } = {}) => {
  const r = await fetch(url + caminho, { method: metodo, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo), headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, j: await r.json() };
};
const esperar = async (cond, ms = 10000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

before(async () => {
  Inq.criar('revenda-mais', { nome: 'Revenda Mais', rascunhos: { padrao: 'site{n}.carro57.com.br' } });
  Inq.criar('webmotors', { nome: 'Webmotors', temas: ['teste', 'barra-topo'], rascunhos: { padrao: 'loja{n}.wm-previa.com.br' } });
  fs.writeFileSync(path.join(A.raiz(), 'inquilinos', 'webmotors', 'config', 'site-modelo.json'), JSON.stringify({ tema: 'teste', configuracoes: { cor: '#e30613' } }));
  fs.writeFileSync(path.join(A.raiz(), 'inquilinos', 'revenda-mais', 'config', 'site-modelo.json'), JSON.stringify({ tema: 'teste', configuracoes: { cor: '#0533ce' } }));
  A.criarSite('loja-rm.com.br', { carros: [A.carro()], site: { inquilino: 'revenda-mais' } });
  A.criarSite('loja-wm.com.br', { carros: [A.carro()], site: { inquilino: 'webmotors' } });
  A.silencioso(() => require('../core/build.js').construir({}));
  tokRM = CL.criarCliente('rm-integracao', ['*'], 'revenda-mais');
  tokWM = CL.criarCliente('wm-integracao', ['*'], 'webmotors');
  tokWMum = CL.criarCliente('wm-uma-loja', ['loja-wm.com.br'], 'webmotors');
  const porta = await new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
  url = `http://127.0.0.1:${porta}`;
  srv = spawn(process.execPath, [path.join(A.PROJETO, 'api', 'servidor.js')], { env: { ...process.env, PORT: String(porta), ATRASO_MS: '50', TOKEN_ATUALIZAR: ADMIN, SITE_CARROS_RAIZ: A.raiz() } });
  srv.stdout.on('data', (d) => (saida += d)); srv.stderr.on('data', (d) => (saida += d));
  assert.ok(await esperar(() => saida.includes('API em')), saida);
});
after(() => srv && srv.kill());

test('inquilino: id válido, "padrao" reservado, padrão de rascunho não pode ser de dois inquilinos', () => {
  assert.throws(() => Inq.criar('padrao'), /reservado/);
  assert.throws(() => Inq.criar('Com Espaço'), /minúsculas/);
  assert.throws(() => Inq.criar('outro', { rascunhos: { padrao: 'site{n}.carro57.com.br' } }), /já é do inquilino "revenda-mais"/);
  assert.deepEqual(Inq.listar(), ['revenda-mais', 'webmotors']);
  assert.equal(Sites.inquilinoDoRascunho('loja7.wm-previa.com.br'), 'webmotors');
  assert.equal(Sites.inquilinoDoRascunho('site7.carro57.com.br'), 'revenda-mais');
});

test('cada inquilino só vê os sites dele; o admin vê todos', async () => {
  assert.deepEqual((await req('GET', '/v1/sites', { token: tokRM })).j.sites.map((s) => s.site), ['loja-rm.com.br']);
  assert.deepEqual((await req('GET', '/v1/sites', { token: tokWM })).j.sites.map((s) => s.site), ['loja-wm.com.br']);
  assert.equal((await req('GET', '/v1/sites/loja-rm.com.br', { token: tokWM })).status, 403);
  assert.equal((await req('PUT', '/v1/sites/loja-rm.com.br/estoque', { corpo: { carros: [] }, token: tokWM })).status, 403);
  const todos = (await req('GET', '/v1/sites', { token: ADMIN })).j.sites.map((s) => s.site);
  assert.ok(todos.includes('loja-rm.com.br') && todos.includes('loja-wm.com.br'));
});

test('rascunho na sequência DO inquilino, com o modelo de site DELE', async () => {
  const rm = await req('POST', '/v1/sites?esperar=20', { token: tokRM });
  const wm = await req('POST', '/v1/sites?esperar=20', { token: tokWM });
  assert.equal(rm.status, 201, JSON.stringify(rm.j));
  assert.equal(rm.j.site, 'site1.carro57.com.br');
  assert.equal(wm.j.site, 'loja1.wm-previa.com.br');
  const cad = Sites.carregar('loja1.wm-previa.com.br');
  assert.deepEqual([cad.inquilino, cad.configuracoes.cor, cad.rascunho], ['webmotors', '#e30613', true]);
  assert.equal(Sites.carregar('site1.carro57.com.br').configuracoes.cor, '#0533ce');
  // endereço de rascunho de outro inquilino: não
  const x = await req('POST', '/v1/sites', { corpo: { dominio: 'site9.carro57.com.br' }, token: tokWM });
  assert.equal(x.status, 422);
  assert.match(x.j.erros.join(' '), /outro inquilino/);
});

test('domínio é único na plataforma; templates liberados por inquilino; o inquilino do site não muda pelo cadastro', async () => {
  const usado = await req('POST', '/v1/sites', { corpo: { dominio: 'loja-rm.com.br' }, token: tokWM });
  assert.equal(usado.status, 409);
  assert.match(usado.j.erro, /em uso/);
  assert.doesNotMatch(usado.j.erro, /revenda/i, 'não conta de quem é');
  const tpl = await req('POST', '/v1/sites', { corpo: { dominio: 'nova-wm.com.br', cadastro: { tema: 'template-basico' } }, token: tokWM });
  assert.equal(tpl.status, 422);
  assert.match(tpl.j.erros.join(' '), /não está liberado para o inquilino "webmotors"/);
  // PUT sem "inquilino": continua da Webmotors
  const cad = Sites.carregar('loja-wm.com.br'); delete cad.id; delete cad.inquilino;
  assert.equal((await req('PUT', '/v1/sites/loja-wm.com.br?esperar=20', { corpo: { ...cad, nome: 'Renomeada' }, token: tokWM })).status, 200);
  assert.equal(Sites.carregar('loja-wm.com.br').inquilino, 'webmotors');
  assert.equal((await req('PUT', '/v1/sites/loja-wm.com.br', { corpo: { ...cad, inquilino: 'revenda-mais' }, token: tokWM })).status, 422);
  // token de uma loja só não cria site (nem no inquilino dele)
  assert.equal((await req('POST', '/v1/sites', { token: tokWMum })).status, 403);
});

test('robots.txt e "refazer todos" valem só para o inquilino do token', async () => {
  const r = await req('PUT', '/v1/robots?esperar=20', { corpo: 'User-agent: *\nAllow: /\nSitemap: {{sitemap}}\n# so-revenda-mais', token: tokRM });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.match(A.ler('loja-rm.com.br', 'robots.txt'), /so-revenda-mais/);
  assert.doesNotMatch(A.ler('loja-wm.com.br', 'robots.txt'), /so-revenda-mais/);
  assert.equal((await req('GET', '/v1/robots', { token: tokWM })).j.padrao, true);
  const b = await req('POST', '/v1/build?esperar=30', { corpo: {}, token: tokWM });
  assert.equal(b.status, 200, JSON.stringify(b.j));
  assert.equal(b.j.total, Sites.listar({ inquilino: 'webmotors' }).length);
  // o admin escolhe o inquilino
  assert.equal((await req('GET', '/v1/robots?inquilino=revenda-mais', { token: ADMIN })).j.inquilino, 'revenda-mais');
  assert.equal((await req('GET', '/v1/robots?inquilino=nao-existe', { token: ADMIN })).status, 422);
});

test('publicação e infra com a configuração DO inquilino ({inquilino} disponível)', async () => {
  const log = path.join(A.raiz(), 'pub.log');
  fs.writeFileSync(path.join(A.raiz(), 'inquilinos', 'webmotors', 'config', 'publicacao.json'), JSON.stringify({ comandoSite: `echo wm {inquilino} {site} >> '${log}'` }));
  fs.writeFileSync(path.join(A.raiz(), 'inquilinos', 'revenda-mais', 'config', 'publicacao.json'), JSON.stringify({ comandoSite: `echo rm {inquilino} {site} >> '${log}'` }));
  const r = await require('../core/atualizar.js').publicarPendentes({ sites: ['loja-rm.com.br', 'loja-wm.com.br'], log: () => {} });
  assert.deepEqual(r.publicados.sort(), ['loja-rm.com.br', 'loja-wm.com.br']);
  const linhas = fs.readFileSync(log, 'utf8');
  assert.match(linhas, /^rm revenda-mais loja-rm\.com\.br$/m);
  assert.match(linhas, /^wm webmotors loja-wm\.com\.br$/m);
  fs.writeFileSync(path.join(A.raiz(), 'inquilinos', 'webmotors', 'config', 'infra.json'), JSON.stringify({ criar: `echo infra-wm {inquilino} {site} >> '${log}'` }));
  const c = await req('POST', '/v1/sites?esperar=20', { corpo: { dominio: 'infra-wm.com.br' }, token: tokWM });
  assert.equal(c.status, 201, JSON.stringify(c.j));
  assert.match(fs.readFileSync(log, 'utf8'), /^infra-wm webmotors infra-wm\.com\.br$/m);
});

test('templates PRÓPRIOS do inquilino (no volume, sem deploy): só ele usa; mesmo nome substitui o da imagem só para ele', () => {
  const { construir } = require('../core/build.js');
  const copiar = (dest, marca) => {
    fs.cpSync(path.join(A.PROJETO, 'tests', 'fixtures', 'temas', 'teste'), dest, { recursive: true });
    const p = path.join(dest, 'templates', 'multipla.html');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('</body>', `<!-- ${marca} --></body>`));
  };
  copiar(path.join(A.raiz(), 'inquilinos', 'webmotors', 'temas', 'visual-wm'), 'visual-proprio-wm');
  copiar(path.join(A.raiz(), 'inquilinos', 'webmotors', 'temas', 'teste'), 'teste-substituido-wm');
  A.criarSite('tpl-wm.com.br', { carros: [A.carro()], site: { inquilino: 'webmotors', tema: 'visual-wm' } });
  A.criarSite('tpl-wm2.com.br', { carros: [A.carro()], site: { inquilino: 'webmotors', tema: 'teste' } });
  A.criarSite('tpl-rm.com.br', { carros: [A.carro()], site: { inquilino: 'revenda-mais', tema: 'teste' } });
  A.silencioso(() => construir({ sites: ['tpl-wm.com.br', 'tpl-wm2.com.br', 'tpl-rm.com.br'] }));
  assert.match(A.ler('tpl-wm.com.br', 'multipla/index.html'), /visual-proprio-wm/);
  assert.match(A.ler('tpl-wm2.com.br', 'multipla/index.html'), /teste-substituido-wm/, 'o "teste" da Webmotors vale para ela');
  assert.doesNotMatch(A.ler('tpl-rm.com.br', 'multipla/index.html'), /substituido/, 'a Revenda Mais continua com o da imagem');
  // outro inquilino não enxerga o template próprio da Webmotors
  const erros = Sites.validarSite({ ...Sites.carregar('tpl-rm.com.br'), id: undefined, tema: 'visual-wm' }, 'tpl-rm.com.br');
  assert.ok(erros.some((e) => /tema "visual-wm" não existe/.test(e)), JSON.stringify(erros));
  // o template próprio vale mesmo fora da lista "templates" do inquilino
  assert.deepEqual(Sites.validarSite({ nome: 'x', motor: 'v2', tema: 'visual-wm', inquilino: 'webmotors' }, 'novo-wm.com.br'), []);
  // editar o template próprio refaz as páginas (o hash do template entra no do site)
  fs.appendFileSync(path.join(A.raiz(), 'inquilinos', 'webmotors', 'temas', 'visual-wm', 'assets', 'css', 'base.css'), '\n/* mudou */');
  const { r } = A.silencioso(() => construir({ sites: ['tpl-wm.com.br'] }));
  assert.equal(r.feitos[0].resumo.base, true, 'mudança no template refaz as páginas');
});
