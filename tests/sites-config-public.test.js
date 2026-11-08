// Contrato: TUDO de um site é configurado em sites-config/<dominio>/ e o build gera em sites-public/<dominio>/.
// Cada parte (site.json, estoque.json, paginas/, componentes/, assets/) mudada na fonte aparece na saída, e o que sai da
// fonte sai da saída. Nada de um site vem de outro lugar além da fonte dele (+ template, componentes e motor, que são código).
const A = require('./ajuda');
A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { construir } = require('../core/build.js');

const ID = 'contrato.teste.com.br';
const fonte = (...p) => path.join(A.raiz(), 'sites-config', ID, ...p);
const build = () => A.silencioso(() => construir({ sites: [ID] })).r.feitos[0];
const escreve = (arq, txt) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, txt); };

test('cada parte de sites-config/<dominio>/ aparece em sites-public/<dominio>/ (e o que sai da fonte sai da saída)', () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'K1', preco: 100000 }), A.carro({ id: 'K2' })], site: { nome: 'Loja Contrato', tema: { logo: 'assets/logo.png' } } });
  escreve(fonte('assets', 'logo.png'), 'logo-v1');
  build();
  const pub = (p) => A.ler(ID, p);
  assert.match(pub('index.html'), /Loja Contrato/);
  assert.equal(pub('assets/logo.png'), 'logo-v1');

  // site.json
  const cad = A.lerSite(ID); cad.nome = 'Loja Contrato Renomeada'; A.gravarSite(ID, cad);
  build();
  assert.match(pub('index.html'), /Loja Contrato Renomeada/, 'site.json → páginas');

  // estoque.json
  const est = JSON.parse(fs.readFileSync(fonte('estoque.json'), 'utf8')); est.carros[0].preco = 123456; est.carros.pop();
  fs.writeFileSync(fonte('estoque.json'), JSON.stringify(est));
  build();
  assert.ok(A.lerJSON(ID, 'carros.json').some((c) => c.i === 'K1' && c.p === 123456), 'estoque.json → carros.json');
  assert.ok(!A.lerJSON(ID, 'carros.json').some((c) => c.i === 'K2'), 'carro que saiu da fonte sai da lista');

  // paginas/ (blocos e HTML)
  escreve(fonte('paginas', 'promocoes.json'), JSON.stringify({ titulo: 'Promoções', blocos: [{ tipo: 'texto', html: '<p>PROMO</p>' }] }));
  escreve(fonte('paginas', 'feirao.html'), '<h1>Feirão</h1>');
  build();
  assert.match(pub('paginas/promocoes/index.html'), /PROMO/, 'paginas/<nome>.json → /paginas/<nome>/');
  assert.match(pub('paginas/feirao/index.html'), /Feirão/);
  fs.rmSync(fonte('paginas', 'promocoes.json'));
  build();
  assert.ok(!A.existe(ID, 'paginas/promocoes/index.html'), 'página apagada da fonte some da saída');

  // componentes/
  escreve(fonte('componentes', 'estoque.json'), JSON.stringify({ preco: '#123456' }));
  escreve(fonte('paginas', 'index.json'), JSON.stringify({ titulo: 'Home', blocos: [{ tipo: 'componente', nome: 'estoque', opcoes: { porPagina: 1 } }] }));
  build();
  assert.match(pub('index.html'), /--c-preco:#123456/, 'componentes/<nome>.json → componente no site');
  assert.match(pub('index.html'), /data-pagina="1"/, 'opção da página vale mais');
  fs.rmSync(fonte('componentes', 'estoque.json'));
  build();
  assert.doesNotMatch(pub('index.html'), /--c-preco:#123456/, 'opção tirada da fonte sai da saída');

  // assets/
  fs.writeFileSync(fonte('assets', 'logo.png'), 'logo-v2');
  escreve(fonte('assets', 'banner.webp'), 'banner');
  build();
  assert.equal(pub('assets/logo.png'), 'logo-v2', 'arquivo trocado na fonte é trocado na saída');
  assert.ok(A.existe(ID, 'assets/banner.webp'));
  fs.rmSync(fonte('assets', 'banner.webp'));
  build();
  assert.ok(!A.existe(ID, 'assets/banner.webp'), 'arquivo apagado da fonte sai da saída');

  // nada sobrando nem quebrado; e build sem mudança na fonte = sem mudança na saída
  assert.deepEqual(A.verificarSiteGerado(ID), []);
  A.limparPendentes();
  build();
  assert.equal(A.pendente(ID), undefined, 'fonte igual → nada para publicar');
});
