// Mini-renderer dos templates: {{x}} escapa, {{{x}}} cru, {{#x}} lista/condicional, {{^x}} inverso.
const { prepararRaiz } = require('./ajuda');
prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, resolverLinks } = require('../core/build.js');

test('{{x}} escapa HTML (dados do estoque nunca viram código)', () => {
  assert.equal(render('<p>{{t}}</p>', { t: '<script>alert(1)</script>"\'&' }), '<p>&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;</p>');
});

test('dado com {{ }} não vira marcador (injeção de template)', () => {
  const out = render('<p>{{t}}</p>', { t: '{{segredo}}', segredo: 'VAZOU' });
  assert.ok(!out.includes('VAZOU'), out);
});

test('{{{x}}} insere sem escapar (só para HTML gerado pelo build)', () => {
  assert.equal(render('{{{h}}}', { h: '<b>ok</b>' }), '<b>ok</b>');
});

test('seções: lista, objeto, booleano, vazio e inverso', () => {
  const ctx = { itens: [{ n: 1 }, { n: 2 }], obj: { a: 'A' }, sim: true, nada: [], zero: '' };
  assert.equal(render('{{#itens}}[{{n}}]{{/itens}}', ctx), '[1][2]');
  assert.equal(render('{{#obj}}{{a}}{{/obj}}', ctx), 'A');
  assert.equal(render('{{#sim}}S{{/sim}}{{^sim}}N{{/sim}}', ctx), 'S');
  assert.equal(render('{{#nada}}X{{/nada}}{{^nada}}vazio{{/nada}}', ctx), 'vazio');
  assert.equal(render('{{#zero}}X{{/zero}}{{^zero}}Z{{/zero}}', ctx), 'Z');
});

test('lista de textos usa {{.}}; caminho com pontos', () => {
  assert.equal(render('{{#l}}<li>{{.}}</li>{{/l}}', { l: ['a', 'b'] }), '<li>a</li><li>b</li>');
  assert.equal(render('{{a.b.c}}', { a: { b: { c: 'fundo' } } }), 'fundo');
  assert.equal(render('[{{nao.existe}}]', {}), '[]');
});

test('seções aninhadas diferentes funcionam', () => {
  const out = render('{{#itens}}{{#link}}<a href="{{link}}">{{t}}</a>{{/link}}{{^link}}{{t}}{{/link}};{{/itens}}', { itens: [{ t: 'A', link: 'x/' }, { t: 'B' }] });
  assert.equal(out, '<a href="x/">A</a>;B;');
});

test('resolverLinks: relativos ganham prefixo; externos, âncoras e absolutos não', () => {
  const r = resolverLinks({ link: 'multipla/', imagem: 'assets/a.webp', outro: 'assets/b.webp', lista: [{ link: 'https://x.com' }, { link: '#topo' }, { link: '/raiz' }, { link: 'mailto:a@b' }] }, '../');
  assert.equal(r.link, '../multipla/');
  assert.equal(r.imagem, '../assets/a.webp');
  assert.equal(r.outro, 'assets/b.webp', 'só chaves conhecidas (link, imagem, foto, logo...) são ajustadas');
  assert.deepEqual(r.lista.map((x) => x.link), ['https://x.com', '#topo', '/raiz', 'mailto:a@b']);
});
