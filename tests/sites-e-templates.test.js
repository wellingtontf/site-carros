// Os sites REAIS do projeto (sites-config/*) e todos os templates: gera tudo numa pasta temporária e varre cada página
// atrás de link local quebrado, marcador {{ }} esquecido e motor funcionando com os dados de verdade.
const A = require('./ajuda');
const fs = require('fs');
const path = require('path');
const raiz = A.prepararRaiz();
// usa os sites reais (somente leitura: o build não escreve em sites-config/)
fs.rmSync(path.join(raiz, 'sites-config'), { recursive: true });
fs.symlinkSync(path.join(A.PROJETO, 'sites-config'), path.join(raiz, 'sites-config'));
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construir } = require('../core/build.js');
const Sites = require('../core/sites');

const reais = Sites.listar();
const { r: gerado } = A.silencioso(() => construir({ saida: 'dist-teste', completo: true, efemero: true }));

test('há sites reais para testar', () => assert.ok(reais.length >= 1));

for (const id of reais) {
  test(`[${id}] nenhuma página com link local quebrado ou marcador sobrando`, () => {
    const problemas = A.verificarSiteGerado(id, 'dist-teste');
    assert.deepEqual(problemas.slice(0, 15), [], `${problemas.length} problema(s)`);
  });

  test(`[${id}] todo carro do estoque tem página; motor carrega e busca`, async () => {
    const feito = gerado.feitos.find((f) => f.site.id === id);
    const dir = A.saida(id, '', 'dist-teste');
    const { criar } = A.carregarMotor(dir);
    const mo = await criar();
    assert.equal(mo.total, feito.total);
    const L = require('../core/ui/link-carro.js');
    const linkDe = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'carros.json'), 'utf8')).filter((d) => d.l).map((d) => [d.i, d.l]));
    const sem = mo.resultado().filter((c) => !fs.existsSync(path.join(dir, linkDe.get(c.id) || L.caminho(c))));
    assert.deepEqual(sem.map((c) => c.id), [], 'carros sem página');
    if (mo.total) {
      const c = mo.resultado()[0];
      mo.buscar(`${c.marca} ${c.modelo}`);
      assert.ok(mo.resultado().some((x) => x.id === c.id));
    }
  });

  test(`[${id}] páginas obrigatórias, SEO e ids que a listagem precisa`, () => {
    const dir = A.saida(id, '', 'dist-teste');
    for (const p of ['index.html', 'multipla/index.html', 'carros.json', 'config.json', 'motor/engine.js', 'motor/ui-lista.js', 'motor/link-carro.js', 'motor/ui-site.js',
      'paginas/contato/index.html', 'paginas/politica-de-privacidade/index.html', 'paginas/politica-de-cookies/index.html', 'paginas/lgpd/index.html']) {
      assert.ok(fs.existsSync(path.join(dir, p)), p);
    }
    const lista = fs.readFileSync(path.join(dir, 'multipla', 'index.html'), 'utf8');
    for (const idHtml of ['q', 'filtros-dinamicos', 'ord', 'contagem', 'grade', 'mais', 'limpar', 'copiar', 'tpl-card']) {
      assert.match(lista, new RegExp(`id="${idHtml}"`), `/multipla sem id="${idHtml}"`);
    }
    assert.match(lista, /data-rel="\.\.\/"/, '/multipla precisa de data-rel para achar carros.json');
    for (const arq of A.listar(dir).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(arq, 'utf8');
      const rel = path.relative(dir, arq);
      if (/http-equiv="refresh"/.test(html)) continue; // redirecionamento
      assert.match(html, /<title>[^<]+<\/title>/, `${rel} sem <title>`);
      assert.match(html, /<meta name="viewport"/, `${rel} sem viewport (celular)`);
      assert.match(html, /<html lang="pt-BR">/, `${rel} sem lang`);
      assert.match(html, /motor\/ui-site\.js/, `${rel} sem motor/ui-site.js (aviso de cookies e formulários)`);
    }
  });
}

// problemas clássicos de site estático no ar (404, cache, charset, JSON-LD...). "localhost" fica de fora: a Trokey usa
// o s3-local no teste local de propósito, e quem barra isso é a publicação (tests/producao.test.js)
test('auditoria dos sites reais: nenhum PROBLEMA de produção', () => {
  const { auditar } = require('../ferramentas/auditar-sites.js');
  const { resultados } = auditar(path.join(raiz, 'dist-teste'));
  assert.deepEqual(resultados.filter((r) => r.nivel === 'PROBLEMA' && r.chave !== 'localhost').map((r) => `${r.item}: ${r.detalhe}`), []);
});

test('todo template tem o mínimo exigido pelo core (páginas e blocos da home padrão)', () => {
  for (const t of fs.readdirSync(path.join(A.PROJETO, 'templates'))) {
    const dir = path.join(A.PROJETO, 'templates', t);
    for (const p of ['home.html', 'multipla.html', 'carro.html', 'vendido.html', 'pagina.html']) assert.ok(fs.existsSync(path.join(dir, 'paginas', p)), `${t}: falta paginas/${p}`);
    for (const b of ['banner', 'vitrine', 'titulo', 'texto', 'formulario', 'lojas']) assert.ok(fs.existsSync(path.join(dir, 'blocos', `${b}.html`)), `${t}: falta blocos/${b}.html (home e páginas padrão)`);
    assert.ok(fs.existsSync(path.join(dir, 'template.json')), `${t}: falta template.json`);
    // as páginas padrão moram no template: sem as legais, os sites dele ficariam fora da LGPD sem ninguém perceber
    for (const p of ['contato', 'politica-de-privacidade', 'politica-de-cookies', 'lgpd']) assert.ok(fs.existsSync(path.join(dir, 'paginas-padrao', `${p}.json`)), `${t}: falta paginas-padrao/${p}.json`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')), `${t}: template.json inválido`);
  }
});

test('todo template funciona com a home padrão e com um site de 1 loja (gerado e varrido)', () => {
  const sitesTmp = path.join(raiz, 'sites-tmp');
  for (const t of fs.readdirSync(path.join(A.PROJETO, 'templates'))) {
    const id = `tpl-${t}.teste.com.br`;
    const dir = path.join(sitesTmp, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ nome: 'X', motor: 'v2', template: t, url: `https://${id}`, whatsapp: '5511', lojas: { u: { nome: 'Única', cidade: 'Curitiba', uf: 'PR' } } }));
    fs.writeFileSync(path.join(dir, 'estoque.json'), JSON.stringify({ carros: [A.carro({ loja: undefined }), A.carro({ loja: undefined, fotos: 0 })] }));
  }
  // aponta sites-config/ para a pasta temporária só neste teste
  fs.rmSync(path.join(raiz, 'sites-config'));
  fs.symlinkSync(sitesTmp, path.join(raiz, 'sites-config'));
  try {
    A.silencioso(() => construir({ saida: 'dist-tpl', completo: true, efemero: true }));
    for (const t of fs.readdirSync(path.join(A.PROJETO, 'templates'))) {
      const id = `tpl-${t}.teste.com.br`;
      assert.deepEqual(A.verificarSiteGerado(id, 'dist-tpl').slice(0, 10), [], `template ${t}`);
    }
  } finally {
    fs.rmSync(path.join(raiz, 'sites-config'));
    fs.symlinkSync(path.join(A.PROJETO, 'sites-config'), path.join(raiz, 'sites-config'));
  }
});

test('cada tipo de página tem o seu arquivo no template: a home usa home.html (não a moldura das páginas internas)', () => {
  const sitesTmp = path.join(raiz, 'sites-home');
  const tpl = path.join(raiz, 'templates', 'home-propria');
  fs.cpSync(path.join(A.PROJETO, 'tests', 'fixtures', 'templates', 'teste'), tpl, { recursive: true });
  fs.writeFileSync(path.join(tpl, 'paginas', 'home.html'), fs.readFileSync(path.join(tpl, 'paginas', 'home.html'), 'utf8').replace('<body', '<body data-moldura="home"'));
  const id = 'home-propria.teste.com.br';
  fs.mkdirSync(path.join(sitesTmp, id), { recursive: true });
  fs.writeFileSync(path.join(sitesTmp, id, 'site.json'), JSON.stringify({ nome: 'X', motor: 'v2', template: 'home-propria', url: `https://${id}`, lojas: { u: { nome: 'U', cidade: 'Curitiba', uf: 'PR' } } }));
  fs.writeFileSync(path.join(sitesTmp, id, 'estoque.json'), JSON.stringify({ carros: [A.carro({ loja: undefined })] }));
  fs.rmSync(path.join(raiz, 'sites-config'));
  fs.symlinkSync(sitesTmp, path.join(raiz, 'sites-config'));
  try {
    A.silencioso(() => construir({ saida: 'sites-home-out', completo: true, efemero: true }));
    assert.match(A.ler(id, 'index.html', 'sites-home-out'), /data-moldura="home"/, 'a home sai do home.html');
    assert.doesNotMatch(A.ler(id, 'paginas/contato/index.html', 'sites-home-out'), /data-moldura="home"/, 'as páginas internas não');
    fs.rmSync(path.join(tpl, 'paginas', 'home.html'));
    assert.throws(() => A.silencioso(() => construir({ saida: 'sites-home-out', completo: true, efemero: true })), /falta paginas\/home\.html/);
  } finally {
    fs.rmSync(path.join(raiz, 'sites-config'));
    fs.symlinkSync(path.join(A.PROJETO, 'sites-config'), path.join(raiz, 'sites-config'));
  }
});
