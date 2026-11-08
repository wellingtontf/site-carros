// Componentes (componentes/<nome>/, core/componentes.js): uma pasta só, usada por qualquer template ({{componente x}}) e
// qualquer página (bloco "componente"); opções em camadas (componente < template < site.json < página), validadas.
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Comp = require('../core/componentes.js');
const { construir } = require('../core/build.js');
const Sites = require('../core/sites.js');

const ID = 'comp.teste.com.br';
beforeEach(() => A.limpar());
const build = () => A.silencioso(() => construir({ sites: [ID] })).r.feitos[0];
// template de teste que usa os componentes na listagem (cópia do "teste", com multipla.html chamando componentes)
function templateComComponentes(nome, multipla) {
  const dir = path.join(A.raiz(), 'templates', nome);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(A.PROJETO, 'tests', 'fixtures', 'templates', 'teste'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'paginas', 'multipla.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>{{listagem.titulo}}</title></head><body data-rel="{{rel}}" data-base="{{base}}" data-filtro="{{listagem.filtro}}">${multipla}<script src="{{rel}}motor/ui-site.js"></script></body></html>`);
  return nome;
}

test('a pasta componentes/ tem filtro e estoque, com opções documentadas', () => {
  assert.deepEqual(Comp.listar(), ['estoque', 'filtro']);
  for (const n of Comp.listar()) for (const [k, d] of Object.entries(Comp.carregar(n).opcoes)) assert.ok('padrao' in d, `${n}.${k} sem padrão`);
});

test('camadas de opções: componente < template < site.json < página; erros claros', () => {
  const m = Comp.mesclar('estoque', [{ origem: 'template', opcoes: { porPagina: '12', whatsapp: 'false', titulo: 'T' } }, { origem: 'site', opcoes: { porPagina: 6 } }]);
  assert.deepEqual(m.erros, []);
  assert.deepEqual([m.op.porPagina, m.op.whatsapp, m.op.titulo, m.op.versao], [6, false, 'T', true], 'o site vale mais que o template; o resto é o padrão');
  const ruins = Comp.mesclar('estoque', [{ origem: 'x', opcoes: { naoExiste: 1, cor: 'azulzinho', estiloCampos: 'bolinhas', campos: 'ano,placa', porPagina: 'muitos' } }]).erros.join(' | ');
  for (const r of [/não tem a opção "naoExiste"/, /cor inválida "azulzinho"/, /"bolinhas" não vale/, /"placa" não vale/, /porPagina: precisa ser número/]) assert.match(ruins, r);
  assert.deepEqual(Comp.validar('nao-existe', {}).length, 1);
});

test('template chama {{componente}}: HTML, cores só do que foi definido, css/scripts entram sozinhos (sem duplicar)', () => {
  const tpl = templateComComponentes('com-comp', '<h1>X</h1>{{componente filtro layout="topo" cor="#c00000"}}{{componente estoque titulo="{{site.nome}}" colunas=300 campos="ano,km" estiloCampos="chips" whatsapp=false}}');
  A.criarSite(ID, { carros: [A.carro(), A.carro({ marca: 'Honda', modelo: 'Civic' })], site: { template: tpl } });
  build();
  const h = A.ler(ID, 'multipla/index.html');
  assert.match(h, /class="c-filtro c-filtro--topo"[^>]*style="--c-cor:#c00000"/, 'cor do filtro só no filtro');
  assert.match(h, /class="c-estoque" style="--c-colunas:300px"/);
  assert.match(h, new RegExp(`<h2 class="c-estoque__titulo">Site ${ID.replace(/\./g, '\\.')}`), 'opção com {{site.nome}}');
  assert.match(h, /<li>\[\[ano\]\]<\/li><li>\[\[km\]\]<\/li>/, 'campos escolhidos, na ordem');
  assert.doesNotMatch(h.split('tpl-card')[1], /c-card__zap/, 'sem WhatsApp');
  assert.match(h, /<link rel="stylesheet" href="\.\.\/componentes\/filtro\.css\?v=[0-9a-f]{8}">/);
  assert.match(h, /<link rel="stylesheet" href="\.\.\/componentes\/estoque\.css\?v=[0-9a-f]{8}">/);
  assert.equal((h.match(/motor\/ui-lista\.js/g) || []).length, 1, 'scripts do motor uma vez só (os dois componentes pedem)');
  assert.ok(A.existe(ID, 'componentes/filtro.css') && A.existe(ID, 'componentes/estoque.css'));
  assert.match(h, /<div id="grade" class="c-estoque__grade" data-pagina="24">\n<article class="c-card">/, 'primeiros cards já no HTML (Google)');
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('site.json "componentes" muda o componente no site inteiro; página com bloco "componente" vale mais', () => {
  const tpl = templateComComponentes('com-comp2', '{{componente filtro}}{{componente estoque porPagina=12}}');
  A.criarSite(ID, { carros: [A.carro(), A.carro()], site: { template: tpl, componentes: { estoque: { preco: '#0533ce', porPagina: 6 } },
    paginas: [{ caminho: '', titulo: 'Home', blocos: [{ tipo: 'componente', nome: 'estoque', opcoes: { titulo: 'Na home', porPagina: 2, ordenacao: false, botaoEstoque: 'Ver tudo' } }] }] } });
  build();
  assert.match(A.ler(ID, 'multipla/index.html'), /data-pagina="6"/, 'site.json vale mais que o template');
  assert.match(A.ler(ID, 'multipla/index.html'), /--c-preco:#0533ce/);
  const home = A.ler(ID, 'index.html');
  assert.match(home, /data-pagina="2"/, 'a página vale mais que o site.json');
  assert.match(home, /--c-preco:#0533ce/, 'e herda o resto do site.json');
  assert.match(home, /Na home/);
  assert.doesNotMatch(home, /id="ord"/, 'ordenacao=false');
  assert.match(home, /href="multipla\/">Ver tudo/);
  assert.match(home, /motor\/ui-lista\.js/, 'o componente traz o motor mesmo num template que não carrega na home');
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('erros: opção inválida no template, no site.json e na página param o build com o lugar do erro; id repetido também', () => {
  const tpl = templateComComponentes('com-comp3', '{{componente filtro}}{{componente estoque corDoPreco="#fff"}}');
  A.criarSite(ID, { carros: [A.carro()], site: { template: tpl } });
  assert.throws(() => build(), /multipla\.html: .*não tem a opção "corDoPreco"/);
  templateComComponentes('com-comp3', '{{componente estoque}}{{componente estoque}}');
  assert.throws(() => build(), /o id "[a-z-]+" aparece 2 vezes/);
  templateComComponentes('com-comp3', '{{componente nao-existe}}');
  assert.throws(() => build(), /componente "nao-existe" não existe/);
  // cadastro e página (o que a API usa): recusa antes de gravar
  assert.match(Sites.validarSite({ nome: 'x', motor: 'v2', template: 'teste', componentes: { estoque: { cor: 'vermelho' } } }, ID).join(' '), /cor inválida "vermelho"/);
  assert.match(Sites.validarPagina(ID, 'x', { blocos: [{ tipo: 'componente', nome: 'estoque', opcoes: { colunas: 'duas' } }] }).join(' '), /colunas: precisa ser número/);
  assert.deepEqual(Sites.validarPagina(ID, 'x', { blocos: [{ tipo: 'componente', nome: 'estoque', opcoes: { colunas: 320 } }] }), []);
});

test('todos os templates do projeto usam os componentes na listagem', () => {
  for (const t of fs.readdirSync(path.join(A.PROJETO, 'templates'))) {
    const h = fs.readFileSync(path.join(A.PROJETO, 'templates', t, 'paginas', 'multipla.html'), 'utf8');
    assert.match(h, /\{\{componente filtro/, `${t}: filtro`);
    assert.match(h, /\{\{componente estoque/, `${t}: estoque`);
  }
});
