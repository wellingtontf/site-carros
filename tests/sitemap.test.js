// core/sitemap.js: gerarSitemap(dominio) reconstrói o sitemap.xml a partir das páginas e carros no ar; o build usa a
// mesma função ao reconstruir o site.
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { construir } = require('../core/build.js');
const { gerarSitemap, montarSitemap } = require('../core/sitemap.js');

const ID = 'sitemap.teste.com.br';
beforeEach(() => A.limpar());
const build = (hoje = '2026-03-01') => A.silencioso(() => construir({ sites: [ID], hoje }));

test('build gera o sitemap com páginas e carros (e lastmod); gerarSitemap(dominio) reconstrói igual', () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'S1' }), A.carro({ id: 'S2' })], site: { paginas: [{ caminho: 'lojas', secoes: [{ tipo: 'lojas' }] }] } });
  build();
  const sm = A.ler(ID, 'sitemap.xml');
  assert.match(sm, new RegExp(`<loc>https://${ID.replace(/\./g, '\\.')}/</loc><lastmod>2026-03-01</lastmod>`));
  assert.ok(sm.includes('/paginas/lojas/<') && sm.includes('-S1.html<') && sm.includes('-S2.html<'));
  // apagado ou estragado por fora: gerarSitemap reconstrói idêntico ao do build
  fs.writeFileSync(A.saida(ID, 'sitemap.xml'), 'estragado');
  A.limparPendentes();
  const r = gerarSitemap(ID);
  assert.deepEqual([r.alterado, r.urls], [true, (sm.match(/<url>/g) || []).length]);
  assert.equal(A.ler(ID, 'sitemap.xml'), sm);
  assert.ok(A.pendente(ID).escritos.includes(`${ID}/sitemap.xml`), 'entra na publicação');
  assert.equal(gerarSitemap(ID).alterado, false, 'de novo: nada muda');
});

test('carro que sai do estoque sai do sitemap (a página de "vendido" não entra); site sem url não tem sitemap', () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'S1' }), A.carro({ id: 'S2' })] });
  build('2026-03-01');
  A.gravarEstoque(ID, [A.carro({ id: 'S1' })]);
  build('2026-03-02');
  const sm = A.ler(ID, 'sitemap.xml');
  assert.ok(sm.includes('-S1.html<') && !sm.includes('-S2.html<'));
  assert.equal(montarSitemap({ id: ID }, { paginas: ['index.html'] }), null);
  assert.throws(() => gerarSitemap('nao-existe.com.br'), /não existe/);
});
