// Problemas clássicos de site estático no ar (ferramentas/auditar-sites.js): página 404, cache de css/js (?v=),
// canonical nas páginas livres e a trava que impede publicar site com fotos em localhost/http.
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { construir, problemasProducao } = require('../core/build.js');
const { publicarPendentes } = require('../core/atualizar.js');
const { auditar } = require('../ferramentas/auditar-sites.js');

const ID = 'prod.teste.com.br';
beforeEach(() => A.limpar());
const gerar = (extra = {}) => { A.criarSite(ID, { carros: [A.carro(), A.carro({ loja: 'sul' })], ...extra }); return A.silencioso(() => construir({ sites: [ID] })); };

test('404.html: existe, não indexa, links a partir da raiz do domínio e todos válidos', () => {
  gerar();
  const h = A.ler(ID, '404.html');
  assert.match(h, /noindex/);
  assert.match(h, /Página não encontrada/);
  assert.match(h, /href="\/css\/[^"]+\.css\?v=[0-9a-f]{8}"/, 'css com caminho absoluto (a 404 aparece em qualquer pasta)');
  assert.doesNotMatch(h, /(href|src)="\.\.\//);
  assert.deepEqual(A.verificarSiteGerado(ID).filter((x) => x.startsWith('404')), []);
  assert.ok(!A.ler(ID, 'sitemap.xml').includes('404'), '404 fora do sitemap');
});

test('404 personalizada pelo site ("pagina404")', () => {
  gerar({ site: { pagina404: { titulo: 'Ops', blocos: [{ tipo: 'texto', html: '<p>Sumiu!</p>' }] } } });
  assert.match(A.ler(ID, '404.html'), /Sumiu!/);
});

test('css/js com ?v=<hash> em tudo, estável entre builds (não refaz página à toa)', () => {
  gerar();
  const pagina = () => A.ler(ID, 'multipla/index.html');
  const v = (h, arq) => (h.match(new RegExp(`${arq.replace('.', '\\.')}\\?v=([0-9a-f]{8})`)) || [])[1];
  const antes = pagina();
  assert.ok(v(antes, 'motor/engine.js') && v(antes, 'motor/ui-lista.js'), 'motor versionado');
  assert.doesNotMatch(antes, /(src|href)="[^"?]*\.(css|js)"/, 'nenhum css/js local sem versão');
  // mesmo build de novo: mesmo ?v (não pode refazer página à toa)
  A.silencioso(() => construir({ sites: [ID] }));
  assert.equal(pagina(), antes);
});

test('página livre do designer (HTML completo) ganha canonical sozinha', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  const dir = A.pastaPaginas(ID, 'promo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Promo</title><link rel="stylesheet" href="promo.css"></head><body><h1>Promo</h1></body></html>');
  fs.writeFileSync(path.join(dir, 'promo.css'), 'h1{color:red}');
  A.silencioso(() => construir({ sites: [ID] }));
  const h = A.ler(ID, 'paginas/promo/index.html');
  assert.match(h, new RegExp(`<link rel="canonical" href="https://${ID.replace(/\./g, '\\.')}/paginas/promo/">`));
  assert.match(h, /href="promo\.css\?v=[0-9a-f]{8}"/, 'css da própria página também versionado');
});

test('problemasProducao: localhost, http e url sem https', () => {
  assert.deepEqual(problemasProducao({ url: 'https://a.com.br', fotosBase: 'https://fotos.a.com.br/' }), []);
  assert.equal(problemasProducao({ url: 'https://a.com.br', fotosBase: 'http://localhost:8081/' }).length, 1);
  assert.equal(problemasProducao({ url: 'https://a.com.br', fotosBase: 'http://fotos.a.com.br/' }).length, 1);
  assert.equal(problemasProducao({ url: 'http://a.com.br' }).length, 1);
  assert.equal(problemasProducao({ url: 'https://127.0.0.1:8080' }).length, 1);
});

test('publicação recusa site com fotos em localhost e deixa ele pendente', async () => {
  const { saidas } = gerar({ site: { fotosBase: 'http://localhost:8081/' } });
  assert.ok(saidas.some((s) => /localhost/.test(s) && /publicação vai recusar/.test(s)), 'o build avisa');
  fs.writeFileSync(path.join(A.raiz(), 'config', 'publicacao.json'), JSON.stringify({ comandoSite: 'true' }));
  const r = await A.silenciosoAsync(() => publicarPendentes({ log: () => {} }));
  assert.deepEqual(r.r.falhas, [ID]);
  assert.ok(A.pendente(ID), 'continua pendente até corrigir');
  // corrigiu o site.json: publica
  const cfg = A.lerSite(ID); cfg.fotosBase = 'https://fotos.teste/'; A.gravarSite(ID, cfg);
  A.silencioso(() => construir({ sites: [ID] }));
  const ok = await publicarPendentes({ log: () => {} });
  assert.deepEqual(ok.publicados, [ID]);
});

test('auditoria do site gerado: nenhum PROBLEMA', () => {
  gerar();
  const { resultados } = auditar(path.join(A.raiz(), 'sites-public'));
  assert.deepEqual(resultados.filter((r) => r.nivel === 'PROBLEMA').map((r) => `${r.item}: ${r.detalhe}`), []);
});
