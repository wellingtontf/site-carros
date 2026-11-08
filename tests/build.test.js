// Build (core/build.js): geração, incremental, vendidos, redirecionamentos, ordem, páginas, erros e segurança.
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { construir } = require('../core/build.js');
const L = require('../core/ui/link-carro.js');

const ID = 'loja-teste.com.br';
const build = (opts = {}) => A.silencioso(() => construir({ sites: [ID], ...opts })).r.feitos[0];
const linkDe = (c, loja = A.LOJAS[c.loja || 'centro']) => L.caminho({ ...c, cidade: loja.cidade, uf: loja.uf });
beforeEach(() => A.limpar());

test('gera do zero: home, /multipla, páginas dos carros, dados e SEO', () => {
  const carros = [A.carro({ loja: 'centro' }), A.carro({ loja: 'sul', marca: 'Honda', modelo: 'Civic' })];
  A.criarSite(ID, { carros });
  const f = build();
  assert.equal(f.total, 2);
  assert.ok(A.existe(ID, 'index.html'), 'home');
  assert.ok(A.existe(ID, 'multipla/index.html'), 'listagem sempre em /multipla');
  for (const c of carros) assert.ok(A.existe(ID, linkDe(c)), linkDe(c));
  const cfg = A.lerJSON(ID, 'config.json');
  assert.equal(cfg.total, 2);
  assert.deepEqual(Object.keys(cfg.lojas).sort(), ['centro', 'sul']);
  const sitemap = A.ler(ID, 'sitemap.xml');
  for (const u of ['/', '/multipla/', ...carros.map((c) => '/' + linkDe(c))]) assert.ok(sitemap.includes(`https://${ID}${u}<`), u);
  assert.match(A.ler(ID, 'robots.txt'), /Sitemap: https:\/\/loja-teste\.com\.br\/sitemap\.xml/);
  const pag = A.ler(ID, linkDe(carros[0]));
  assert.match(pag, /<link rel="canonical" href="https:\/\/loja-teste\.com\.br\/carros\//);
  assert.match(pag, /"@type":"Car"/);
  assert.match(pag, /og:image/);
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('home padrão quando o site não define a página ""', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  build();
  const home = A.ler(ID, 'index.html');
  assert.match(home, /class="banner"/);
  assert.match(home, /class="vitrine"/);
  assert.match(home, /Destaques/);
});

test('incremental: rodar de novo não escreve nada', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro()] });
  build();
  const f = build();
  assert.equal(f.resumo.escritos, 0);
  assert.equal(f.resumo.removidos, 0);
  assert.equal(f.resumo.completo, false);
});

test('preço muda: refaz só a página daquele carro + carros.json', () => {
  const carros = [A.carro(), A.carro(), A.carro()];
  A.criarSite(ID, { carros });
  build();
  A.limparPendentes(); // finge que já publicou
  carros[1].preco += 1000;
  A.gravarEstoque(ID, carros);
  const f = build();
  assert.equal(f.resumo.alterados, 1);
  const escritos = A.pendente(ID).escritos;
  assert.ok(escritos.includes(`${ID}/${linkDe(carros[1])}`) && escritos.includes(`${ID}/carros.json`));
  // nenhuma OUTRA página de carro; o resto é o que mostra o preço (home, 404 e /multipla têm cards no HTML; estoque.xml) e o sitemap (lastmod)
  assert.deepEqual(escritos.filter((e) => e.includes('/carros/')), [`${ID}/${linkDe(carros[1])}`]);
  // (o sitemap só muda se mudar o dia: o <lastmod> é por dia)
  assert.deepEqual(escritos.filter((e) => !e.includes('/carros/')).sort(), [`${ID}/404.html`, `${ID}/carros.json`, `${ID}/estoque.xml`, `${ID}/index.html`, `${ID}/multipla/index.html`].sort());
});

test('carro que sai: página "indisponível" (noindex) no mesmo link; some do sitemap; apagada após a retenção', () => {
  const carros = [A.carro(), A.carro({ marca: 'Fiat', modelo: 'Uno' })]; // pastas diferentes: dá para ver a pasta vazia sumir
  A.criarSite(ID, { carros });
  build({ hoje: '2026-01-01' });
  const link = linkDe(carros[1]);
  A.gravarEstoque(ID, [carros[0]]);
  build({ hoje: '2026-01-01' });
  const html = A.ler(ID, link);
  assert.match(html, /não está mais disponível/);
  assert.match(html, /noindex/);
  assert.ok(!A.ler(ID, 'sitemap.xml').includes(link));
  build({ hoje: '2026-01-31' }); // 30 dias: ainda fica
  assert.ok(A.existe(ID, link));
  build({ hoje: '2026-02-01' }); // 31 dias: apaga, e as pastas vazias somem junto
  assert.ok(!A.existe(ID, link));
  assert.ok(!fs.existsSync(path.dirname(A.saida(ID, link))), 'pasta vazia removida');
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('retencaoVendidosDias por site', () => {
  const carros = [A.carro(), A.carro()];
  A.criarSite(ID, { carros, site: { retencaoVendidosDias: 2 } });
  build({ hoje: '2026-01-01' });
  A.gravarEstoque(ID, [carros[0]]);
  build({ hoje: '2026-01-01' });
  build({ hoje: '2026-01-04' });
  assert.ok(!A.existe(ID, linkDe(carros[1])));
});

test('carro vendido que volta: página normal de novo', () => {
  const carros = [A.carro(), A.carro()];
  A.criarSite(ID, { carros });
  build();
  A.gravarEstoque(ID, [carros[0]]);
  build();
  A.gravarEstoque(ID, carros);
  build();
  assert.doesNotMatch(A.ler(ID, linkDe(carros[1])), /não está mais disponível/);
});

test('link muda (versão editada): o antigo redireciona para o novo; some após 180 dias', () => {
  const c = A.carro();
  A.criarSite(ID, { carros: [c] });
  build({ hoje: '2026-01-01' });
  const velho = linkDe(c);
  c.versao = 'XEi 2.0 Flex Aut.';
  A.gravarEstoque(ID, [c]);
  build({ hoje: '2026-01-01' });
  const novo = linkDe(c);
  assert.notEqual(velho, novo);
  const redir = A.ler(ID, velho);
  assert.match(redir, /http-equiv="refresh"/);
  assert.ok(redir.includes(path.basename(novo)), 'aponta para o link novo');
  assert.match(redir, /noindex/);
  assert.ok(redir.includes(`https://${ID}/${novo}`), 'canonical absoluto no link novo');
  assert.deepEqual(A.verificarSiteGerado(ID), [], 'redirecionamento aponta para arquivo que existe');
  build({ hoje: '2026-06-30' });
  assert.ok(A.existe(ID, velho));
  build({ hoje: '2026-06-30', sites: [ID] });
  build({ hoje: '2026-07-01' });
  assert.ok(!A.existe(ID, velho), 'apagado depois de 180 dias');
});

test('link antigo de carro vendido aponta para a página "indisponível"', () => {
  const c = A.carro();
  const outro = A.carro();
  A.criarSite(ID, { carros: [c, outro] });
  build();
  const velho = linkDe(c);
  c.versao = 'Nova Versão';
  A.gravarEstoque(ID, [c, outro]);
  build();
  A.gravarEstoque(ID, [outro]);
  build();
  assert.ok(A.ler(ID, velho).includes(path.basename(linkDe(c))));
  assert.match(A.ler(ID, linkDe(c)), /não está mais disponível/);
});

test('migração do formato antigo /carro/<id>/: estado antigo vira redirecionamento', () => {
  const c = A.carro();
  A.criarSite(ID, { carros: [c] });
  build();
  // simula um estado gerado pela versão antiga (sem "links")
  const arqEstado = path.join(A.raiz(), '.estado', 'sites-public', `${ID}.json`);
  const est = JSON.parse(fs.readFileSync(arqEstado, 'utf8'));
  delete est.links;
  fs.writeFileSync(arqEstado, JSON.stringify(est));
  build();
  assert.ok(A.ler(ID, `carro/${c.id}/index.html`).includes(path.basename(linkDe(c))));
});

test('ordem: campo "ordem" manda; sem ele, a posição no arquivo; empates pela posição', () => {
  const cs = [A.carro({ ordem: 3 }), A.carro(), A.carro({ ordem: 1 }), A.carro(), A.carro({ ordem: 1 })];
  A.criarSite(ID, { carros: cs });
  build();
  const ids = A.lerJSON(ID, 'carros.json').map((c) => c.i);
  assert.deepEqual(ids, [cs[2].id, cs[4].id, cs[0].id, cs[1].id, cs[3].id]);
  assert.deepEqual(A.lerJSON(ID, 'carros.json').map((c) => c.r), [0, 1, 2, 3, 4]);
});

test('vitrine segue a ordem do estoque; somenteDestaques filtra', () => {
  const cs = [A.carro({ ordem: 2, modelo: 'Segundo' }), A.carro({ ordem: 1, modelo: 'Primeiro', destaque: true }), A.carro({ ordem: 3, modelo: 'Terceiro', destaque: true })];
  A.criarSite(ID, { carros: cs, site: { paginas: [{ caminho: '', blocos: [
    { tipo: 'vitrine', titulo: 'Todos', quantidade: 2 },
    { tipo: 'vitrine', titulo: 'Destaques', somenteDestaques: true, quantidade: 5 },
  ] }] } });
  build();
  const home = A.ler(ID, 'index.html');
  const [todos, dest] = home.split('Destaques');
  assert.ok(todos.indexOf('Primeiro') < todos.indexOf('Segundo') && !todos.includes('Terceiro'));
  assert.ok(dest.includes('Primeiro') && dest.includes('Terceiro') && !dest.includes('Segundo'));
});

test('restrições do site tiram carros', () => {
  A.criarSite(ID, { carros: [A.carro({ preco: 30000 }), A.carro({ preco: 90000 }), A.carro({ preco: 90000, loja: 'sul' })],
    site: { restricoes: { precoMin: 50000, estados: ['PR'] } } });
  assert.equal(build().total, 1);
});

test('páginas de conteúdo (arquivos em sites-config/<id>/paginas/): criadas, no sitemap, e apagadas quando o arquivo sai', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { paginas: [
    { caminho: '', titulo: 'Home', blocos: [{ tipo: 'texto', html: '<p>oi</p>' }] },
    { caminho: 'sobre/nos', titulo: 'Sobre', blocos: [{ tipo: 'texto', html: '<p>quem somos</p>' }] },
  ] } });
  build();
  assert.match(A.ler(ID, 'paginas/sobre/nos/index.html'), /quem somos/);
  assert.ok(A.ler(ID, 'sitemap.xml').includes(`https://${ID}/paginas/sobre/nos/<`));
  fs.rmSync(A.arqPagina(ID, 'sobre/nos')); // o designer apagou o arquivo da página
  build();
  assert.ok(!A.existe(ID, 'paginas/sobre/nos/index.html'));
  assert.ok(!A.existe(ID, 'sobre/nos'), 'pasta vazia removida');
});

test('bloco listagem: estoque dentro da página, com os primeiros cards no HTML', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro(), A.carro()], site: { paginas: [{ caminho: '', blocos: [{ tipo: 'listagem', quantidade: 2 }] }] } });
  build();
  const home = A.ler(ID, 'index.html');
  assert.match(home, /id="grade" data-pagina="2"/);
  assert.equal((home.match(/class="card"/g) || []).length, 2 + 1, '2 cards no HTML + o modelo do card');
  assert.match(home, /motor\/ui-lista\.js/);
});

test('bloco lojas e dados globais do estoque (total, cidades, marcas)', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro({ loja: 'sul' })], site: { paginas: [{ caminho: '', blocos: [{ tipo: 'lojas' }] }] } });
  build();
  const home = A.ler(ID, 'index.html');
  assert.match(home, /Loja Centro/);
  assert.match(home, /href="multipla\/\?loja=Loja%20Sul"/);
  assert.match(home, /Estoque \(2\)/);
});

test('regressão: links do bloco lojas numa subpágina não dobram o "../" (bug achado pelos testes)', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { paginas: [{ caminho: '', blocos: [] }, { caminho: 'lojas', blocos: [{ tipo: 'lojas' }] }] } });
  build();
  const html = A.ler(ID, 'paginas/lojas/index.html');
  assert.match(html, /href="\.\.\/\.\.\/multipla\/\?loja=Loja%20Centro"/); // /paginas/lojas/ → 2 níveis
  assert.doesNotMatch(html, /\.\.\/\.\.\/\.\.\/multipla/);
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('links e imagens relativos funcionam em qualquer profundidade (home, subpágina, página do carro)', () => {
  const c = A.carro();
  fs.mkdirSync(path.join(A.raiz(), 'sites-config', ID, 'assets'), { recursive: true });
  A.criarSite(ID, { carros: [c], site: { tema: { logo: 'assets/logo.png' }, cabecalho: { menu: [{ rotulo: 'Estoque', link: 'multipla/' }, { rotulo: 'Fora', link: 'https://x.com' }] },
    paginas: [{ caminho: '', blocos: [] }, { caminho: 'a/b', blocos: [{ tipo: 'banner', imagem: 'assets/logo.png', titulo: 'x' }] }] } });
  fs.writeFileSync(path.join(A.raiz(), 'sites-config', ID, 'assets', 'logo.png'), 'png');
  build();
  assert.match(A.ler(ID, 'paginas/a/b/index.html'), /href="\.\.\/\.\.\/\.\.\/multipla\/"/);
  assert.match(A.ler(ID, linkDe(c)), /src="\.\.\/\.\.\/\.\.\/\.\.\/assets\/logo\.png"/);
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('segurança: dado malicioso no estoque e no site.json é escapado', () => {
  const c = A.carro({ marca: '<script>alert("m")</script>', descricao: '</script><img src=x onerror=alert(1)>', opcionais: ['<b>x</b>'] });
  A.criarSite(ID, { carros: [c], site: { nome: '"><script>alert(2)</script>' } });
  build();
  for (const arq of A.listar(A.saida(ID)).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(arq, 'utf8');
    assert.ok(!/<script>alert/.test(html), `${arq} tem <script> do dado`);
    assert.ok(!/<img src=x onerror/.test(html), `${arq} tem <img onerror> do dado`);
  }
  // JSON-LD não pode fechar o <script> antes da hora
  const ld = A.ler(ID, linkDe(c)).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => JSON.parse(ld));
});

test('erros de configuração dão mensagem clara (e não geram site pela metade)', () => {
  const casos = [
    [{ template: 'nao-existe' }, /template "nao-existe" não existe/],
    [{ motor: 'v99' }, /motor "v99" não existe/],
    [{ motor: undefined }, /sem "motor"/],
    [{ lojas: {} }, /tem carros mas nenhuma loja/], // site sem lojas só pode existir sem estoque (site recém-criado)
    [{ paginas: [{ caminho: 'multipla', blocos: [] }] }, /reservado/],
    [{ paginas: [{ caminho: 'carros', blocos: [] }] }, /reservado/],
    [{ paginas: [{ caminho: 'Maiuscula', blocos: [] }] }, /caminho inválido/],
    [{ paginas: [{ caminho: 'x', blocos: [] }, { caminho: 'x/index', blocos: [] }] }, /repetido/], // x.json e x/index.json
    [{ paginas: [{ caminho: 'x' }] }, /falta "blocos"/],
    [{ paginas: [{ caminho: '', blocos: [{ tipo: 'nao-existe' }] }] }, /bloco "nao-existe" não existe/],
    [{ paginas: [{ caminho: '', blocos: [{ tipo: '../../x' }] }] }, /bloco/],
    [{ paginas: [{ caminho: '', blocos: [{ tipo: 'listagem' }, { tipo: 'listagem' }] }] }, /só pode ter um bloco "listagem"/],
  ];
  for (const [site, msg] of casos) {
    A.limpar();
    A.criarSite(ID, { carros: [A.carro()], site });
    assert.throws(() => build(), msg, JSON.stringify(site));
  }
  A.limpar();
  A.criarSite(ID, { carros: [A.carro({ loja: 'norte' })] });
  assert.throws(() => build(), /loja inexistente "norte"/);
});

test('"paginas" no site.json é recusado com o caminho para mover; o script de migração move para arquivos', () => {
  A.limpar();
  A.criarSite(ID, { carros: [A.carro()] });
  const cfg = A.lerSite(ID);
  cfg.paginas = [{ caminho: '', titulo: 'Home', blocos: [{ tipo: 'texto', html: '<p>home</p>' }] }, { caminho: 'sobre/nos', titulo: 'Sobre', blocos: [] }];
  fs.writeFileSync(path.join(A.raiz(), 'sites-config', ID, 'site.json'), JSON.stringify(cfg)); // direto, sem o ajudante
  assert.throws(() => build(), /não fica mais no site\.json.*sites-config\/loja-teste\.com\.br\/paginas\//);
  const r = require('child_process').spawnSync(process.execPath, [path.join(A.PROJETO, 'ferramentas', 'mover-paginas.js'), ID], { env: { ...process.env, SITE_CARROS_RAIZ: A.raiz() }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(A.lerSite(ID).paginas, undefined);
  assert.equal(JSON.parse(fs.readFileSync(A.arqPagina(ID, ''), 'utf8')).titulo, 'Home');
  assert.ok(fs.existsSync(A.arqPagina(ID, 'sobre/nos')));
  build();
  assert.match(A.ler(ID, 'index.html'), /home/);
});

test('pasta de site precisa ser um domínio', () => {
  A.criarSite('nao_e_dominio', { carros: [A.carro()] });
  assert.throws(() => A.silencioso(() => construir({ sites: ['nao_e_dominio'] })), /Pasta de site inválida/);
  assert.throws(() => A.silencioso(() => construir({ sites: ['nao-existe.com.br'] })), /Site inexistente/);
});

test('estoque.caminho é ignorado com aviso (a listagem é sempre /multipla)', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { estoque: { caminho: 'estoque' } } });
  const { saidas } = A.silencioso(() => construir({ sites: [ID] }));
  assert.ok(saidas.some((s) => /estoque\.caminho.*ignorado/.test(s)));
  assert.ok(!A.existe(ID, 'paginas/estoque/index.html'));
});

test('motor e filtros: trocar não refaz páginas de carro', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro()] });
  build();
  const s = A.lerSite(ID);
  s.motor = 'v1';
  s.filtros = ['marca'];
  A.gravarSite(ID, s);
  const f = build();
  assert.equal(f.resumo.base, false);
  assert.equal(f.resumo.alterados, 0);
  assert.equal(A.lerJSON(ID, 'config.json').motor, 'v1');
});

test('tema/textos mudam: refaz as páginas do site', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro()] });
  build();
  const s = A.lerSite(ID);
  s.textos = { voltar: 'Outro texto' };
  A.gravarSite(ID, s);
  assert.equal(build().resumo.base, true);
});

test('build efêmero (usado pelos testes do cli) não grava estado nem pendências', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  A.silencioso(() => construir({ sites: [ID], saida: 'dist-teste', completo: true, efemero: true }));
  assert.ok(A.existe(ID, 'index.html', 'dist-teste'));
  assert.ok(!fs.existsSync(path.join(A.raiz(), '.estado', 'dist-teste')));
});

test('site sem estoque.json: gera com 0 carros e avisa', () => {
  A.criarSite(ID, { carros: [] });
  fs.rmSync(path.join(A.raiz(), 'sites-config', ID, 'estoque.json'));
  const { r, saidas } = A.silencioso(() => construir({ sites: [ID] }));
  assert.equal(r.feitos[0].total, 0);
  assert.ok(saidas.some((s) => /sem sites-config\/.*estoque\.json/.test(s)));
});

// ---------- SEO: lastmod, páginas de filtro, cards no HTML ----------
const lastmods = () => Object.fromEntries([...A.ler(ID, 'sitemap.xml').matchAll(/<loc>https:\/\/[^/]+\/([^<]*)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]));

test('sitemap: <lastmod> é o dia em que a página mudou de verdade (não o dia do build)', () => {
  const cs = [A.carro(), A.carro({ marca: 'Fiat', modelo: 'Uno' })];
  A.criarSite(ID, { carros: cs });
  build({ hoje: '2026-03-01' });
  build({ hoje: '2026-03-05' }); // nada mudou
  let lm = lastmods();
  assert.equal(lm[linkDe(cs[0])], '2026-03-01');
  assert.equal(lm[''], '2026-03-01', 'home');
  cs[1].preco += 500;
  A.gravarEstoque(ID, cs);
  build({ hoje: '2026-03-09' });
  lm = lastmods();
  assert.equal(lm[linkDe(cs[1])], '2026-03-09', 'carro que mudou');
  assert.equal(lm[linkDe(cs[0])], '2026-03-01', 'carro que não mudou mantém a data');
  assert.equal(lm['multipla/'], '2026-03-09', 'listagem mostra o preço: mudou');
});

test('páginas de filtro: /multipla/marca/<x>/ com título, canonical, filtro e só os carros dela no HTML', () => {
  const cs = [A.carro({ marca: 'Honda', modelo: 'Civic' }), A.carro({ marca: 'Honda', modelo: 'City' }), A.carro({ marca: 'Volkswagen', modelo: 'Gol', loja: 'sul' }), A.carro({ carroceria: 'SUV' })];
  A.criarSite(ID, { carros: cs });
  build();
  const honda = A.ler(ID, 'multipla/marca/honda/index.html');
  assert.match(honda, /<title>Honda seminovos \| /);
  assert.match(honda, /<link rel="canonical" href="https:\/\/loja-teste\.com\.br\/multipla\/marca\/honda\/">/);
  assert.match(honda, /data-filtro="marca=Honda"/);
  assert.equal((honda.match(/class="card"/g) || []).length - 1, 2, 'só os 2 Honda no HTML (fora o modelo do card)');
  assert.ok(A.existe(ID, 'multipla/marca/volkswagen/index.html'));
  assert.ok(A.existe(ID, 'multipla/cidade/curitiba/index.html'));
  assert.ok(A.existe(ID, 'multipla/cidade/porto-alegre/index.html'));
  assert.ok(!A.existe(ID, 'multipla/carroceria'), 'carroceria com 1 valor só: sem página (seria duplicada)');
  assert.ok(A.ler(ID, 'sitemap.xml').includes('/multipla/marca/honda/<'));
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('páginas de filtro: marca que some do estoque tem a página apagada', () => {
  const cs = [A.carro({ marca: 'Honda' }), A.carro({ marca: 'Fiat' }), A.carro({ marca: 'Kia' })];
  A.criarSite(ID, { carros: cs });
  build();
  assert.ok(A.existe(ID, 'multipla/marca/kia/index.html'));
  A.gravarEstoque(ID, cs.slice(0, 2));
  build();
  assert.ok(!A.existe(ID, 'multipla/marca/kia/index.html'));
  assert.ok(!A.existe(ID, 'multipla/marca/kia'));
});

test('páginas de filtro: só para filtros que o motor do site tem; paginasFiltro configura', () => {
  const cs = [A.carro({ marca: 'Honda', carroceria: 'SUV' }), A.carro({ marca: 'Fiat', carroceria: 'Hatch' })];
  A.criarSite(ID, { carros: cs, site: { filtros: ['cidade'] } });
  build();
  assert.ok(!A.existe(ID, 'multipla/marca'), 'site sem filtro de marca: a página não saberia filtrar');
  A.limpar();
  A.criarSite(ID, { carros: cs, site: { motor: 'v1' } });
  build();
  assert.ok(A.existe(ID, 'multipla/marca/honda/index.html'));
  assert.ok(!A.existe(ID, 'multipla/carroceria'), 'motor v1 não tem filtro de carroceria');
  A.limpar();
  A.criarSite(ID, { carros: cs, site: { paginasFiltro: ['carroceria'] } });
  build();
  assert.ok(A.existe(ID, 'multipla/carroceria/suv/index.html'));
  assert.ok(!A.existe(ID, 'multipla/marca'));
});

test('links do estoque (rodapé, menus) apontam para a página de filtro quando ela existe', () => {
  const cs = [A.carro({ marca: 'Honda' }), A.carro({ marca: 'Fiat' })];
  A.criarSite(ID, { carros: cs, site: { paginas: [{ caminho: '', blocos: [{ tipo: 'lojas' }] }, { caminho: 'a/b', blocos: [{ tipo: 'lojas' }] }] } });
  build();
  // lojas: só "centro" tem carros, mas o filtro de loja não tem página → continua ?loja=
  assert.match(A.ler(ID, 'paginas/a/b/index.html'), /href="\.\.\/\.\.\/\.\.\/multipla\/\?loja=/);
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('/multipla já vem com os primeiros cards no HTML (o Google vê os carros sem rodar JS)', () => {
  const cs = Array.from({ length: 30 }, () => A.carro());
  A.criarSite(ID, { carros: cs });
  build();
  const html = A.ler(ID, 'multipla/index.html');
  assert.equal((html.match(/class="card"/g) || []).length - 1, 24, '24 cards (padrão) fora o modelo');
  assert.ok(html.includes(`../${linkDe(cs[0])}`), 'link do card é relativo e certo');
  assert.match(html, /https:\/\/wa\.me\/5541999990001\?text=/, 'WhatsApp da loja');
  assert.ok(!/\[\[(nome|preco|href)\]\]/.test(html.replace(/<script type="text\/html"[\s\S]*?<\/script>/g, '')), 'nenhum [[campo]] fora do modelo');
});

// ---------- páginas padrão (paginas-padrao/) ----------
test('páginas padrão: todo site ganha contato, privacidade, cookies e LGPD, preenchidas com os dados dele', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { nome: 'Loja do Zé', empresa: { razaoSocial: 'Zé Veículos LTDA', cnpj: '00.000.000/0001-00', email: 'dpo@loja.com' } } });
  build();
  for (const p of ['contato', 'politica-de-privacidade', 'politica-de-cookies', 'lgpd']) assert.ok(A.existe(ID, `paginas/${p}/index.html`), p);
  const priv = A.ler(ID, 'paginas/politica-de-privacidade/index.html');
  assert.match(priv, /Zé Veículos LTDA/);
  assert.match(priv, /CNPJ 00\.000\.000\/0001-00/);
  assert.match(priv, /mailto:dpo@loja\.com/);
  assert.match(priv, /href="\.\.\/\.\.\/paginas\/lgpd\/"/, 'link interno com o prefixo certo');
  assert.ok(!/\{\{/.test(priv), 'nenhum marcador sobrando');
  const contato = A.ler(ID, 'paginas/contato/index.html');
  assert.match(contato, /<option>Loja Centro<\/option>/, 'select de loja vem das lojas do site (opcoesDe)');
  assert.match(contato, /class="lojas"/);
  const sm = A.ler(ID, 'sitemap.xml');
  for (const p of ['contato', 'lgpd']) assert.ok(sm.includes(`/paginas/${p}/<`), p);
  assert.match(A.ler(ID, 'index.html'), /class="legal" href="paginas\/lgpd\/">LGPD</, 'links legais no rodapé ({{#site.links}})');
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('páginas padrão: sem dados da empresa, cai no nome do site e na página de contato', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { nome: 'Loja do Zé' } });
  build();
  const lgpd = A.ler(ID, 'paginas/lgpd/index.html');
  assert.match(lgpd, /<strong>Loja do Zé<\/strong>/);
  assert.match(lgpd, /href="\.\.\/\.\.\/paginas\/contato\/"/);
  assert.ok(!/mailto:/.test(lgpd));
});

test('páginas padrão: o site substitui (mesmo caminho) ou desliga ("paginasPadrao")', () => {
  A.criarSite(ID, { carros: [A.carro()], site: {
    paginas: [{ caminho: 'contato', titulo: 'Fale', blocos: [{ tipo: 'texto', html: '<p>CONTATO PRÓPRIO</p>' }] }],
    paginasPadrao: { 'politica-de-cookies': false },
  } });
  build();
  assert.match(A.ler(ID, 'paginas/contato/index.html'), /CONTATO PRÓPRIO/);
  assert.ok(!A.existe(ID, 'paginas/politica-de-cookies/index.html'));
  assert.ok(A.existe(ID, 'paginas/lgpd/index.html'));
  assert.equal(A.lerJSON(ID, 'config.json').avisoCookies.link, 'paginas/politica-de-privacidade/', 'sem página de cookies, o aviso aponta para a privacidade');
});

test('páginas padrão: texto provisório gera UM aviso por build (não um por site)', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  A.criarSite('outro.com.br', { carros: [A.carro()] });
  const { saidas } = A.silencioso(() => construir({}));
  assert.equal(saidas.filter((x) => /TEXTO PROVISÓRIO/.test(x)).length, 1);
});

test('aviso de cookies: vai no config.json; "avisoCookies": false desliga; texto configurável', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { textos: { avisoCookies: 'Cookies aqui.' } } });
  build();
  assert.deepEqual(A.lerJSON(ID, 'config.json').avisoCookies, { texto: 'Cookies aqui.', link: 'paginas/politica-de-cookies/' });
  const s = A.lerSite(ID); s.avisoCookies = false; A.gravarSite(ID, s);
  build();
  assert.equal(A.lerJSON(ID, 'config.json').avisoCookies, null);
});

test('template sem os blocos obrigatórios é recusado com mensagem clara', () => {
  const tpl = path.join(A.raiz(), 'templates', 'incompleto');
  fs.mkdirSync(path.join(tpl, 'paginas'), { recursive: true });
  for (const p of ['index', 'carro', 'vendido', 'pagina']) fs.writeFileSync(path.join(tpl, 'paginas', `${p}.html`), '<html></html>');
  A.criarSite(ID, { carros: [A.carro()], site: { template: 'incompleto' } });
  assert.throws(() => build(), /falta blocos\/banner\.html.*blocos\/lojas\.html/);
  fs.rmSync(tpl, { recursive: true });
});

// ---------- páginas livres dos web designers (core/paginas-livres.js) ----------
const pastaLivre = (...p) => path.join(A.raiz(), 'sites-config', ID, 'paginas', ...p);
const escrever = (arq, txt) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, txt); };

test('designer: arquivo só com conteúdo entra no cabeçalho/rodapé; título do <h1>; links "/" viram relativos; variáveis funcionam', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro()] });
  escrever(pastaLivre('promocoes', 'feirao.html'), '<h1>Feirão &amp; Cia</h1><p>{{estoque.total}} carros</p><a href="/multipla/">ver</a> <a href="/contato/">contato</a> <a href="//cdn.x/a.js">cdn</a>');
  build();
  const html = A.ler(ID, 'paginas/promocoes/feirao/index.html');
  assert.match(html, /<title>Feirão &amp; Cia<\/title>/, 'título do <h1>, com o & escapado');
  assert.match(html, /<p>2 carros<\/p>/);
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/multipla\/"/);
  assert.match(html, /href="\/\/cdn\.x\/a\.js"/, 'link de protocolo relativo não é mexido');
  assert.match(html, /motor\/ui-site\.js/, 'veio com a moldura do site (aviso de cookies)');
  assert.ok(A.ler(ID, 'sitemap.xml').includes('/paginas/promocoes/feirao/<'));
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('designer: pasta com index.html + imagens/css vai inteira; imagem removida some do site', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  escrever(pastaLivre('feirao', 'index.html'), '<link rel="stylesheet" href="estilo.css"><img src="img/faixa.png" alt=""><h1>Feirão</h1>');
  escrever(pastaLivre('feirao', 'estilo.css'), 'h1{color:red}');
  escrever(pastaLivre('feirao', 'img', 'faixa.png'), 'png');
  build();
  assert.ok(A.existe(ID, 'paginas/feirao/estilo.css') && A.existe(ID, 'paginas/feirao/img/faixa.png'));
  assert.deepEqual(A.verificarSiteGerado(ID), [], 'caminhos relativos do designer funcionam no site');
  fs.rmSync(pastaLivre('feirao', 'img'), { recursive: true });
  escrever(pastaLivre('feirao', 'index.html'), '<link rel="stylesheet" href="estilo.css"><h1>Feirão</h1>');
  build();
  assert.ok(!A.existe(ID, 'feirao/img/faixa.png') && !A.existe(ID, 'feirao/img'), 'arquivo que saiu da pasta do designer foi apagado');
});

test('designer: documento completo vira página livre; o build só acrescenta o essencial', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  escrever(pastaLivre('landing.html'), '<!doctype html><html><head><title>Landing</title></head><body><h1>Oi</h1><a href="/multipla/">ir</a></body></html>');
  build();
  const html = A.ler(ID, 'paginas/landing/index.html');
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<body data-rel="\.\.\/\.\.\/">/);
  assert.match(html, /<script src="\.\.\/\.\.\/motor\/ui-site\.js\?v=[0-9a-f]{8}"><\/script>\n<\/body>/);
  assert.doesNotMatch(html, /class="marca"/, 'sem o cabeçalho do site');
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('designer: comentários opcionais (titulo, descricao, rotulo no rodapé, moldura)', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  escrever(pastaLivre('a.html'), '<!-- titulo: Título A --><!-- descricao: Desc A --><!-- rotulo: Página A --><p>a</p>');
  escrever(pastaLivre('b.html'), '<!-- moldura: nenhuma --><p>b sem moldura</p>');
  build();
  const a = A.ler(ID, 'paginas/a/index.html');
  assert.match(a, /<title>Título A<\/title>/);
  assert.match(a, /content="Desc A"/);
  assert.match(A.ler(ID, 'index.html'), /href="paginas\/a\/">Página A</, 'rotulo vira link no rodapé');
  const b = A.ler(ID, 'paginas/b/index.html');
  assert.match(b, /motor\/ui-site\.js/, 'pedaço de HTML sem moldura ainda ganha o aviso de cookies');
  assert.match(b, /<meta charset="utf-8">/);
  assert.match(b, /<title>B<\/title>/, 'título do nome do arquivo');
  assert.doesNotMatch(A.ler(ID, 'paginas/b/index.html'), /class="marca"/);
});

test('designer: página do template vale para todos os sites; o site troca ou desliga', () => {
  const extras = path.join(A.raiz(), 'templates-extra');
  // template de teste com paginas-extras (cópia do "teste" para não sujar o fixture)
  fs.cpSync(path.join(__dirname, 'fixtures', 'templates', 'teste'), path.join(extras, 'com-extras'), { recursive: true });
  escrever(path.join(extras, 'com-extras', 'paginas-extras', 'financiamento.html'), '<h1>Financiamento padrão</h1>');
  fs.symlinkSync(path.join(extras, 'com-extras'), path.join(A.raiz(), 'templates', 'com-extras'));
  try {
    A.criarSite(ID, { carros: [A.carro()], site: { template: 'com-extras' } });
    A.criarSite('outro.com.br', { carros: [A.carro()], site: { template: 'com-extras', paginasPadrao: { financiamento: false } } });
    A.criarSite('terceiro.com.br', { carros: [A.carro()], site: { template: 'com-extras' } });
    escrever(path.join(A.raiz(), 'sites-config', 'terceiro.com.br', 'paginas', 'financiamento.html'), '<h1>Financiamento do terceiro</h1>');
    A.silencioso(() => construir({}));
    assert.match(A.ler(ID, 'paginas/financiamento/index.html'), /Financiamento padrão/);
    assert.ok(!A.existe('outro.com.br', 'paginas/financiamento/index.html'), 'desligado pelo site');
    assert.match(A.ler('terceiro.com.br', 'paginas/financiamento/index.html'), /Financiamento do terceiro/, 'o site troca a do template');
  } finally { fs.rmSync(path.join(A.raiz(), 'templates', 'com-extras')); fs.rmSync(extras, { recursive: true }); }
});

test('designer: editar página do template NÃO refaz as páginas de carro (2500 sites)', () => {
  const extras = path.join(A.raiz(), 'templates-extra2');
  fs.cpSync(path.join(__dirname, 'fixtures', 'templates', 'teste'), path.join(extras, 'com-extras'), { recursive: true });
  const arq = path.join(extras, 'com-extras', 'paginas-extras', 'financiamento.html');
  escrever(arq, '<h1>v1</h1>');
  fs.symlinkSync(path.join(extras, 'com-extras'), path.join(A.raiz(), 'templates', 'com-extras'));
  try {
    A.criarSite(ID, { carros: [A.carro(), A.carro()], site: { template: 'com-extras' } });
    build();
    escrever(arq, '<h1>v2</h1>');
    const f = build();
    assert.equal(f.resumo.base, false, 'páginas de carro intactas');
    assert.match(A.ler(ID, 'paginas/financiamento/index.html'), /v2/);
  } finally { fs.rmSync(path.join(A.raiz(), 'templates', 'com-extras')); fs.rmSync(extras, { recursive: true }); }
});

test('designer: x.json e x.html na mesma pasta é erro claro; nome inválido e duplicado dão erro; página apagada some', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { paginas: [{ caminho: 'x', titulo: 'do json', blocos: [{ tipo: 'texto', html: '<p>JSON</p>' }] }] } });
  escrever(pastaLivre('x.html'), '<p>ARQUIVO</p>');
  assert.throws(() => build(), /"x" duplicada.*x\.json.*x\.html/);
  fs.rmSync(pastaLivre('x.html'));
  escrever(pastaLivre('y.html'), '<p>y</p>');
  build();
  assert.match(A.ler(ID, 'paginas/x/index.html'), /JSON/);
  fs.rmSync(pastaLivre('y.html'));
  build();
  assert.ok(!A.existe(ID, 'paginas/y/index.html'));
  escrever(pastaLivre('Feirao Novo.html'), '<p>x</p>');
  assert.throws(() => build(), /nome inválido "Feirao Novo"/);
  fs.rmSync(pastaLivre('Feirao Novo.html'));
  escrever(pastaLivre('z.html'), '<p>1</p>');
  escrever(pastaLivre('z', 'index.html'), '<p>2</p>');
  assert.throws(() => build(), /duplicada/);
  fs.rmSync(pastaLivre('z'), { recursive: true });
  escrever(pastaLivre('multipla.html'), '<p>x</p>');
  assert.throws(() => build(), /reservado/);
});

// ---------- compatibilidade com o Revenda Mais ----------
test('link do estoque: a página do carro fica EXATAMENTE no link informado (incl. "//" normalizado e "R/t")', () => {
  const a = A.carro({ link: '/carros/Volkswagen/Nivus//Volkswagen-Nivus-2026-So-Jos-Dos-Pinhais-Parana-8442546.html' });
  const b = A.carro({ link: 'carros/Ram/Rampage/R/t-Hurric/Ram-Rampage-R/t-Hurric-2025-Ponta-Grossa-Parana-8635550.html' });
  const c = A.carro(); // sem link: regra do core
  A.criarSite(ID, { carros: [a, b, c] });
  build();
  assert.ok(A.existe(ID, 'carros/Volkswagen/Nivus/Volkswagen-Nivus-2026-So-Jos-Dos-Pinhais-Parana-8442546.html'));
  assert.ok(A.existe(ID, 'carros/Ram/Rampage/R/t-Hurric/Ram-Rampage-R/t-Hurric-2025-Ponta-Grossa-Parana-8635550.html'));
  assert.ok(A.existe(ID, linkDe(c)));
  const sm = A.ler(ID, 'sitemap.xml');
  assert.ok(sm.includes('/carros/Ram/Rampage/R/t-Hurric/Ram-Rampage-R/t-Hurric-2025-Ponta-Grossa-Parana-8635550.html<'));
  assert.equal(A.lerJSON(ID, 'carros.json').find((x) => x.i === b.id).l, 'carros/Ram/Rampage/R/t-Hurric/Ram-Rampage-R/t-Hurric-2025-Ponta-Grossa-Parana-8635550.html');
  assert.ok(!('l' in A.lerJSON(ID, 'carros.json').find((x) => x.i === c.id)), 'sem link no estoque: sem "l"');
  assert.deepEqual(A.verificarSiteGerado(ID), [], 'cards e links apontam para as páginas certas');
});

test('link do estoque mudou: o antigo redireciona para o novo', () => {
  const a = A.carro({ link: 'carros/A/B/C/velho-1.html' });
  A.criarSite(ID, { carros: [a] });
  build();
  a.link = 'carros/A/B/C/novo-1.html';
  A.gravarEstoque(ID, [a]);
  build();
  assert.match(A.ler(ID, 'carros/A/B/C/velho-1.html'), /novo-1\.html/);
});

test('formatoUrls "revendamais": páginas de filtro nos endereços do Revenda Mais, com espaço/acento codificados', () => {
  const cs = [A.carro({ marca: 'Caoa Chery', modelo: 'Tiggo' }), A.carro({ marca: 'Land Rover', modelo: 'Evoque', loja: 'sul' }), A.carro({ carroceria: 'SUV' }), A.carro({ carroceria: 'Hatch' })];
  A.criarSite(ID, { carros: cs, site: { formatoUrls: 'revendamais', lojas: { ...A.LOJAS, sul: { ...A.LOJAS.sul, cidade: 'São José dos Pinhais' } } } });
  build();
  assert.ok(A.existe(ID, 'multipla/marca/caoa chery/index.html'));
  assert.ok(A.existe(ID, 'multipla/marca/land rover/index.html'));
  assert.ok(A.existe(ID, 'multipla/revenda_cidade_nome/São José dos Pinhais/index.html'));
  assert.ok(A.existe(ID, 'multipla/carroceria/suv/index.html'));
  const sm = A.ler(ID, 'sitemap.xml');
  assert.ok(sm.includes('/multipla/marca/caoa%20chery/<'), 'sitemap com espaço codificado');
  assert.ok(sm.includes('/multipla/revenda_cidade_nome/S%C3%A3o%20Jos%C3%A9%20dos%20Pinhais/<'));
  assert.match(A.ler(ID, 'multipla/marca/caoa chery/index.html'), /canonical" href="https:\/\/loja-teste\.com\.br\/multipla\/marca\/caoa%20chery\/"/);
  assert.match(A.ler(ID, 'multipla/marca/caoa chery/index.html'), /data-filtro="marca=Caoa%20Chery"/);
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('páginas padrão novas: financiamento e avaliação (com as lojas do site no formulário)', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  build();
  assert.match(A.ler(ID, 'paginas/financiamento/index.html'), /js-form-zap/);
  const av = A.ler(ID, 'paginas/avaliacao/index.html');
  assert.match(av, /<option>Loja Centro<\/option>/);
  assert.match(A.ler(ID, 'index.html'), /href="paginas\/avaliacao\/">Avalie seu carro</);
});

test('troca de formato: as páginas no endereço antigo somem, com as pastas vazias', () => {
  A.criarSite(ID, { carros: [A.carro(), A.carro({ loja: 'sul' })] });
  build();
  assert.ok(A.existe(ID, 'multipla/cidade/curitiba/index.html'));
  const s = A.lerSite(ID); s.formatoUrls = 'revendamais'; A.gravarSite(ID, s);
  build();
  assert.ok(!A.existe(ID, 'multipla/cidade'), 'multipla/cidade/ inteira removida');
  assert.ok(A.existe(ID, 'multipla/revenda_cidade_nome/Curitiba/index.html'));
});

test('páginas padrão vêm do TEMPLATE: editar o texto atualiza a página sem refazer as páginas de carro', () => {
  // cópia do template "teste" (o original é compartilhado entre os testes)
  const dir = path.join(A.raiz(), 'templates', 'teste-padrao');
  fs.cpSync(path.join(A.PROJETO, 'tests', 'fixtures', 'templates', 'teste'), dir, { recursive: true });
  A.criarSite(ID, { carros: [A.carro(), A.carro()], site: { template: 'teste-padrao' } });
  build();
  assert.ok(A.existe(ID, 'paginas/lgpd/index.html'));
  assert.ok(!A.existe(ID, 'paginas-padrao/lgpd.json'), 'o JSON da página não vai para o site');
  const arq = path.join(dir, 'paginas-padrao', 'lgpd.json');
  const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
  j.blocos.push({ tipo: 'texto', html: '<p>Texto oficial do jurídico</p>' });
  fs.writeFileSync(arq, JSON.stringify(j));
  A.limparPendentes();
  const f = build();
  assert.match(A.ler(ID, 'paginas/lgpd/index.html'), /Texto oficial do jurídico/);
  assert.equal(f.resumo.alterados + f.resumo.novos, 0);
  assert.equal(f.resumo.base, false, 'páginas de carro não foram refeitas');
  // template sem paginas-padrao: o site simplesmente não ganha essas páginas
  fs.rmSync(path.join(dir, 'paginas-padrao'), { recursive: true });
  build();
  assert.ok(!A.existe(ID, 'paginas/lgpd/index.html'));
});

test('páginas ficam em /paginas/<nome>/; o endereço antigo redireciona; links simples ("contato/", "/lojas/") são ajustados', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { cabecalho: { menu: [{ rotulo: 'Lojas', link: 'lojas/' }, { rotulo: 'Estoque', link: 'multipla/' }] },
    paginas: [{ caminho: 'lojas', titulo: 'Lojas', blocos: [{ tipo: 'lojas' }] }] } });
  const pasta = path.join(A.raiz(), 'sites-config', ID, 'paginas');
  fs.writeFileSync(path.join(pasta, 'feirao.html'), '<h1>Feirão</h1><a href="/lojas/">lojas</a> <a href="/multipla/">estoque</a>');
  build();
  assert.ok(A.existe(ID, 'paginas/lojas/index.html') && A.existe(ID, 'paginas/lgpd/index.html') && A.existe(ID, 'paginas/feirao/index.html'));
  assert.ok(!A.existe(ID, 'lojas/index.html'), 'site novo: nada na raiz');
  assert.match(A.ler(ID, 'index.html'), /href="paginas\/lojas\/"/, 'menu "lojas/" do site.json vai para /paginas/lojas/');
  assert.match(A.ler(ID, 'index.html'), /href="multipla\/"/, 'o que não é página fica como está');
  const f = A.ler(ID, 'paginas/feirao/index.html');
  assert.match(f, /href="\.\.\/\.\.\/paginas\/lojas\/"/, 'HTML do designer: "/lojas/" vira a página certa');
  assert.match(f, /href="\.\.\/\.\.\/multipla\/"/);
  assert.deepEqual(A.verificarSiteGerado(ID), []);
});

test('mudança de endereço: página que estava na raiz redireciona (e o formato Revenda Mais mantém sempre a raiz)', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { paginas: [{ caminho: 'lojas', blocos: [{ tipo: 'lojas' }] }] } });
  build({ hoje: '2026-01-01' });
  // simula o estado de antes da mudança: a página estava na raiz
  const arqEst = path.join(A.raiz(), '.estado', 'sites-public', `${ID}.json`);
  const est = JSON.parse(fs.readFileSync(arqEst, 'utf8'));
  est.paginas = est.paginas.map((p) => p.replace(/^paginas\//, ''));
  fs.writeFileSync(arqEst, JSON.stringify(est));
  A.limparPendentes();
  build({ hoje: '2026-01-02' });
  const r = A.ler(ID, 'lojas/index.html');
  assert.match(r, /http-equiv="refresh" content="0; url=\.\.\/paginas\/lojas\/"/);
  assert.match(r, /noindex/);
  assert.ok(!A.pendente(ID).removidos.includes(`${ID}/lojas/index.html`), 'o endereço antigo não sai do ar');
  assert.ok(!A.ler(ID, 'sitemap.xml').includes(`${ID}/lojas/<`), 'redirecionamento fora do sitemap');
  build({ hoje: '2026-08-01' }); // 180 dias depois: some
  assert.ok(!A.existe(ID, 'lojas/index.html'));
  // formato Revenda Mais: /lojas, /contato... sempre redirecionam (o Google conhece esses endereços do site antigo)
  const cfg = A.lerSite(ID); cfg.formatoUrls = 'revendamais'; A.gravarSite(ID, cfg);
  build({ hoje: '2026-08-02' });
  assert.match(A.ler(ID, 'contato/index.html'), /url=\.\.\/paginas\/contato\//);
  assert.match(A.ler(ID, 'lojas/index.html'), /url=\.\.\/paginas\/lojas\//);
});
