// Ponta a ponta: um site montado SÓ pela API (como um sistema externo faria), do zero, sem ninguém mexer em arquivo.
// Confere que o que passa pela API é suficiente para gerar tudo da aplicação: site.json, estoque.json, páginas, arquivos
// (sites-config/<dominio>/) e o site gerado (config.json, estoque.json, páginas, LGPD com os dados da empresa, sitemap, robots,
// fotos), sem link quebrado e sem PROBLEMA de produção.
const A = require('./ajuda');
A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const net = require('net');
const { spawn } = require('child_process');

const D = 'api-completo.com.br';
const ADMIN = 'admin-ponta-a-ponta-123456';
let srv, base, saida = '', img, fotosBase;

// imagens de verdade (o tipo é conferido pelo conteúdo)
function png(w = 4, h = 3) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo); const l = Buffer.alloc(4); l.writeUInt32BE(dados.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([l, t, dados, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);

const pedir = async (metodo, caminho, corpo, { tipo = 'application/json', token = ADMIN } = {}) => {
  const body = corpo === undefined ? undefined : Buffer.isBuffer(corpo) || typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const r = await fetch(base + caminho, { method: metodo, body, headers: { authorization: `Bearer ${token}`, 'content-type': tipo } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, j };
};
const esperar = async (cond, ms = 20000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

// o que o "sistema externo" manda
const CADASTRO = {
  nome: 'Auto Completo Seminovos', slogan: 'Tudo pela API', tema: 'barra-topo', motor: 'v2',
  url: `https://${D}`, whatsapp: '5541999990000', fotosBase: `https://fotos.${D}/`,
  empresa: { razaoSocial: 'Auto Completo Comércio de Veículos LTDA', cnpj: '12.345.678/0001-90', email: 'privacidade@api-completo.com.br', encarregado: 'Maria Souza' },
  lojas: {
    matriz: { nome: 'Matriz Centro', cidade: 'Curitiba', uf: 'PR', endereco: 'Rua XV, 100 - Curitiba - PR', whatsapp: '5541999990001' },
    sul: { nome: 'Loja Sul', cidade: 'Porto Alegre', uf: 'RS', endereco: 'Av. Ipiranga, 200 - Porto Alegre - RS', whatsapp: '5551999990002' },
  },
  configuracoes: { cor: '#c00000', logo: 'assets/logo.png', favicon: 'assets/favicon.ico' },
  filtros: ['estado', 'cidade', 'loja', 'marca', 'modelo', 'preco'],
};
const carro = (id, extra) => ({ id, marca: 'Toyota', modelo: 'Corolla', versao: 'XEi 2.0', ano: 2022, preco: 120000, km: 30000, cor: 'Prata', cambio: 'Automático', combustivel: 'Flex', loja: 'matriz', ...extra });
let LINK_RM; // link de um carro que veio do Revenda Mais (tem que ser respeitado)

before(async () => {
  img = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png()); });
  await new Promise((ok) => img.listen(0, '127.0.0.1', ok));
  fotosBase = `http://127.0.0.1:${img.address().port}`;
  // fotos por URL: conversor de mentira (cópia) e armazenamento local, como no teste das fotos
  fs.writeFileSync(path.join(A.raiz(), 'config', 'fotos.json'), JSON.stringify({ pasta: 'fotos-api', permitirRedeLocal: ['127.0.0.1'],
    converter: `sh -c 'for w in 400 800 1600; do cp "$1" "$2-$w.webp"; done' _ {entrada} {saida}` }));
  const porta = await new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
  base = `http://127.0.0.1:${porta}`;
  srv = spawn(process.execPath, [path.join(A.PROJETO, 'api', 'servidor.js')], { env: { ...process.env, PORT: String(porta), ATRASO_MS: '50', TOKEN_ATUALIZAR: ADMIN, SITE_CARROS_RAIZ: A.raiz() } });
  srv.stdout.on('data', (d) => (saida += d)); srv.stderr.on('data', (d) => (saida += d));
  assert.ok(await esperar(() => saida.includes('API em')), saida);
});
after(() => { if (srv) srv.kill(); if (img) img.close(); });

test('1) cria o site, manda arquivos, páginas e estoque, ajusta o cadastro: tudo só pela API', async () => {
  const c = await pedir('POST', '/v1/sites?esperar=30', { dominio: D, cadastro: CADASTRO });
  assert.equal(c.status, 201, JSON.stringify(c.j));
  assert.equal(c.j.avisos, undefined, 'cadastro sem campo estranho: sem avisos');

  for (const [nome, buf] of [['logo.png', png()], ['favicon.ico', ICO], ['banners/home.webp', WEBP]]) {
    const r = await pedir('PUT', `/v1/sites/${D}/assets/${nome}`, buf, { tipo: 'application/octet-stream' });
    assert.equal(r.status, 202, `${nome}: ${JSON.stringify(r.j)}`);
  }

  const paginas = [
    ['index', { titulo: 'Auto Completo', descricao: 'Seminovos em Curitiba e Porto Alegre', secoes: [
      { tipo: 'banner', imagem: 'assets/banners/home.webp', alt: 'Ofertas', titulo: 'Ofertas' },
      { tipo: 'vitrine', titulo: 'Destaques', quantidade: 4, botao: 'Ver estoque' }] }],
    ['lojas', { titulo: 'Nossas lojas', rotulo: 'Lojas', secoes: [{ tipo: 'titulo', titulo: 'Nossas lojas' }, { tipo: 'lojas' }] }],
  ];
  for (const [nome, pg] of paginas) {
    const r = await pedir('PUT', `/v1/sites/${D}/paginas/${nome}`, pg);
    assert.equal(r.status, 202, `${nome}: ${JSON.stringify(r.j)}`);
  }
  const html = await pedir('PUT', `/v1/sites/${D}/paginas/feirao`, '<h1>Feirão</h1><p>Confira as <a href="/lojas/">lojas</a> e o <a href="/multipla/">estoque</a>.</p>', { tipo: 'text/html' });
  assert.equal(html.status, 202, JSON.stringify(html.j));
  assert.equal(html.j.endereco, '/paginas/feirao/');
  // listagem (/multipla/): secoes antes da lista → web/multipla.json
  const mul = await pedir('PUT', `/v1/sites/${D}/multipla`, { secoesAntes: [{ tipo: 'texto', html: '<p>OFERTAS-DA-SEMANA</p>' }] });
  assert.equal(mul.status, 202, JSON.stringify(mul.j));
  assert.equal(mul.j.endereco, '/multipla/');
  assert.equal((await pedir('PUT', `/v1/sites/${D}/multipla`, { secoesAntes: [{ tipo: 'nao-existe' }] })).status, 422, 'bloco que o template não tem');
  assert.equal((await pedir('PUT', `/v1/sites/${D}/multipla`, { titulo: 'x' })).status, 422, 'campo desconhecido');
  assert.equal((await pedir('PATCH', `/v1/sites/${D}`, { estoque: { secoesAntes: [] } })).status, 422, '"estoque" não vai no cadastro');
  assert.match(JSON.stringify((await pedir('GET', `/v1/sites/${D}/multipla`)).j), /OFERTAS-DA-SEMANA/);

  LINK_RM = 'carros/Toyota/Corolla/Xei-20/Toyota-Corolla-Xei-20-2022-Curitiba-Parana-C1.html';
  const est = await pedir('PUT', `/v1/sites/${D}/estoque?esperar=30`, { carros: [
    carro('C1', { link: LINK_RM, ordem: 1, destaque: true, carroceria: 'Sedan', fotos: [`${fotosBase}/c1-1.jpg`, `${fotosBase}/c1-2.jpg`], opcionais: ['Ar-condicionado'], descricao: 'Único dono.' }),
    carro('C2', { marca: 'Honda', modelo: 'Civic', versao: 'EXL', ordem: 2, loja: 'sul', carroceria: 'Sedan', fotos: [`${fotosBase}/c2-1.jpg`] }),
    carro('C3', { marca: 'Jeep', modelo: 'Compass', versao: 'Longitude', ordem: 3, carroceria: 'SUV', fotos: 0 }),
  ] });
  assert.equal(est.status, 200, JSON.stringify(est.j));

  const p = await pedir('PATCH', `/v1/sites/${D}?esperar=30`, { whatsapp: '5541988887777', lojas: { sul: { whatsapp: '5551988887777' } } });
  assert.equal(p.status, 200, JSON.stringify(p.j));

  // fotos por URL ficam prontas em segundo plano e o site é refeito sozinho
  assert.ok(await esperar(() => { try { return A.lerJSON(D, 'estoque.json').find((x) => x.i === 'C1').n === 2; } catch (e) { return false; } }), `fotos não ficaram prontas:\n${saida.slice(-2000)}`);
});

test('2) os JSONs da aplicação (sites-config/<dominio>/) são exatamente o que veio pela API', () => {
  const dir = path.join(A.raiz(), 'sites-config', D);
  const cad = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  assert.equal(cad.whatsapp, '5541988887777', 'PATCH aplicado');
  assert.equal(cad.lojas.sul.whatsapp, '5551988887777');
  assert.deepEqual(cad.empresa, CADASTRO.empresa);
  assert.deepEqual(cad.tema, CADASTRO.tema);
  assert.deepEqual(cad.lojas.matriz, CADASTRO.lojas.matriz);
  assert.equal(cad.paginas, undefined, 'páginas não vão no site.json');
  const est = JSON.parse(fs.readFileSync(path.join(dir, 'estoque.json'), 'utf8'));
  assert.deepEqual(est.carros.map((c) => c.id), ['C1', 'C2', 'C3']);
  assert.equal(est.carros[0].link, LINK_RM);
  for (const f of ['web/index.json', 'web/paginas/lojas.json', 'web/paginas/feirao.html', 'web/multipla.json', 'assets/logo.png', 'assets/favicon.ico', 'assets/banners/home.webp']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'web', 'paginas', 'lojas.json'), 'utf8')).rotulo, 'Lojas');
});

test('3) o site gerado tem tudo: home, estoque, carros (com o link do Revenda Mais), páginas, LGPD, SEO, fotos', () => {
  const cfg = A.lerJSON(D, 'config.json');
  assert.equal(cfg.whatsapp, '5541988887777');
  assert.deepEqual(Object.values(cfg.lojas).map((l) => l.nome).sort(), ['Loja Sul', 'Matriz Centro']);
  const carros = A.lerJSON(D, 'estoque.json');
  assert.deepEqual(carros.map((c) => [c.i, c.n]), [['C1', 2], ['C2', 1], ['C3', 0]], 'ordem do estoque e fotos prontas');
  assert.ok(A.existe(D, LINK_RM), 'página do carro no endereço que o Revenda Mais já usa');
  assert.match(A.ler(D, LINK_RM), /<link rel="canonical" href="https:\/\/api-completo\.com\.br\/carros\/Toyota/);
  const home = A.ler(D, 'index.html');
  assert.match(home, /assets\/logo\.png/, 'logo enviado pela API');
  assert.match(home, /assets\/banners\/home\.webp/, 'banner da home');
  assert.ok(A.existe(D, 'assets/favicon.ico'));
  assert.match(home, /<link rel="icon" href="assets\/favicon\.ico">/, 'favicon das configurações no <head>');
  assert.match(A.ler(D, 'paginas/lojas/index.html'), /Rua XV, 100/);
  assert.match(A.ler(D, 'multipla/index.html'), /OFERTAS-DA-SEMANA/, 'web/multipla.json → /multipla/');
  assert.match(A.ler(D, 'paginas/feirao/index.html'), /href="\.\.\/\.\.\/paginas\/lojas\/"/);
  const priv = A.ler(D, 'paginas/politica-de-privacidade/index.html');
  assert.match(priv, /Auto Completo Comércio de Veículos LTDA/, 'LGPD com a razão social');
  assert.match(priv, /12\.345\.678\/0001-90/, 'LGPD com o CNPJ');
  assert.match(priv, /privacidade@api-completo\.com\.br/);
  for (const p of ['multipla/index.html', 'paginas/contato/index.html', 'paginas/lgpd/index.html', '404.html']) assert.ok(A.existe(D, p), p);
  const sm = A.ler(D, 'sitemap.xml');
  for (const u of ['/paginas/lojas/', '/paginas/feirao/', `/${LINK_RM}`]) assert.ok(sm.includes(u), u);
  assert.match(A.ler(D, 'robots.txt'), /Sitemap: https:\/\/api-completo\.com\.br\/sitemap\.xml/);
  assert.equal(A.lerJSON(D, 'estoque.json').length, 3, 'estoque.json gerado com os 3 carros');
  assert.ok(!A.existe(D, 'estoque.xml'), 'sem feed XML');
  assert.deepEqual(A.verificarSiteGerado(D), [], 'nenhum link quebrado');
  const { auditar } = require('../ferramentas/auditar-sites.js');
  const problemas = auditar(path.join(A.raiz(), 'sites-public')).resultados.filter((r) => r.nivel === 'PROBLEMA');
  assert.deepEqual(problemas.map((r) => `${r.item}: ${r.detalhe}`), []);
});

test('4) consultas devolvem o que foi gravado (o sistema externo consegue conferir)', async () => {
  const s = await pedir('GET', `/v1/sites/${D}`);
  assert.equal(s.j.cadastro.empresa.cnpj, '12.345.678/0001-90');
  assert.equal(s.j.carros, 3);
  assert.deepEqual((await pedir('GET', `/v1/sites/${D}/paginas`)).j.paginas.map((p) => [p.nome, p.endereco]),
    [['feirao', '/paginas/feirao/'], ['index', '/'], ['lojas', '/paginas/lojas/']]);
  assert.equal((await pedir('GET', `/v1/sites/${D}/paginas/lojas`)).j.rotulo, 'Lojas');
  assert.match((await pedir('GET', `/v1/sites/${D}/paginas/feirao`)).j, /<h1>Feirão<\/h1>/);
  assert.deepEqual((await pedir('GET', `/v1/sites/${D}/assets`)).j.arquivos.map((a) => a.nome), ['banners/home.webp', 'favicon.ico', 'logo.png']);
  assert.equal((await pedir('GET', `/v1/sites/${D}/estoque`)).j.carros.length, 3);
});

test('5) apagar página e arquivo pela API tira do site', async () => {
  assert.equal((await pedir('DELETE', `/v1/sites/${D}/paginas/feirao?esperar=30`)).status, 200);
  assert.ok(!A.existe(D, 'paginas/feirao/index.html'));
  assert.equal((await pedir('DELETE', `/v1/sites/${D}/assets/banners/home.webp?esperar=30`)).status, 200);
  assert.ok(!A.existe(D, 'assets/banners/home.webp'));
  assert.equal((await pedir('DELETE', `/v1/sites/${D}/paginas/feirao`)).status, 404);
});

test('6) recusas claras: arquivo que não é o que diz, SVG com script, página inválida, campo desconhecido', async () => {
  const falsoPng = await pedir('PUT', `/v1/sites/${D}/assets/logo2.png`, Buffer.from('<html>não sou png</html>'), { tipo: 'image/png' });
  assert.equal(falsoPng.status, 422);
  assert.match(falsoPng.j.erro, /não é PNG/);
  const svg = await pedir('PUT', `/v1/sites/${D}/assets/x.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { tipo: 'image/svg+xml' });
  assert.equal(svg.status, 422);
  assert.match(svg.j.erro, /SVG com código/);
  assert.equal((await pedir('PUT', `/v1/sites/${D}/assets/ok.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', { tipo: 'image/svg+xml' })).status, 202);
  for (const nome of ['../site.json', 'Logo Grande.png', 'x.exe']) assert.equal((await pedir('PUT', `/v1/sites/${D}/assets/${encodeURIComponent(nome)}`, png(), { tipo: 'image/png' })).status, 422, nome);
  const bloco = await pedir('PUT', `/v1/sites/${D}/paginas/x`, { titulo: 'x', secoes: [{ tipo: 'nao-existe' }] });
  assert.equal(bloco.status, 422);
  assert.match(bloco.j.erros[0], /não existe no tema "barra-topo"/);
  assert.equal((await pedir('PUT', `/v1/sites/${D}/paginas/multipla`, { secoes: [] })).status, 422, 'nome reservado');
  assert.equal((await pedir('PUT', `/v1/sites/${D}/paginas/Maiuscula`, { secoes: [] })).status, 422);
  assert.equal((await pedir('PUT', `/v1/sites/${D}/paginas/index`, '<p>home</p>', { tipo: 'text/html' })).status, 422, 'home é página de secoes');
  const aviso = await pedir('PATCH', `/v1/sites/${D}`, { whatsap: '5541900000000' });
  assert.equal(aviso.status, 202);
  assert.match(aviso.j.avisos[0], /campo "whatsap" não é usado/);
  // o tema declara o que aceita (config/settings_schema.json): chave que ele não usa = aviso; tipo errado = 422
  const semMenu = await pedir('PATCH', `/v1/sites/${D}`, { whatsap: null, cabecalho: { menu: [{ rotulo: 'Lojas', link: 'lojas/' }] } });
  assert.equal(semMenu.status, 202);
  assert.match(semMenu.j.avisos.join(' '), /"cabecalho\.menu" não é usado pelo tema "barra-topo"/);
  const corRuim = await pedir('PATCH', `/v1/sites/${D}`, { cabecalho: null, configuracoes: { cor: 'azul' } });
  assert.equal(corRuim.status, 422);
  assert.match(corRuim.j.erros.join(' '), /"configuracoes\.cor": cor inválida "azul"/);
  assert.equal(A.lerSite(D).configuracoes.cor, '#c00000', '422: nada gravado');
  const temas = await pedir('GET', '/v1/temas');
  assert.deepEqual(temas.j.temas.map((t) => t.tema), ['barra-topo', 'lateral', 'template-basico', 'teste']);
  const bt = await pedir('GET', '/v1/temas/barra-topo');
  assert.deepEqual([bt.j.configuracoes.cor.tipo, bt.j.configuracoes.cor.padrao, bt.j.textos.voltar], ['cor', '#0b5fff', 'Voltar ao estoque']);
  assert.equal((await pedir('GET', '/v1/temas/nao-existe')).status, 404);
  // página no outro formato substitui (não fica duplicada)
  assert.equal((await pedir('PUT', `/v1/sites/${D}/paginas/promo`, { titulo: 'Promo', secoes: [] })).status, 202);
  assert.equal((await pedir('PUT', `/v1/sites/${D}/paginas/promo?esperar=30`, '<h1>Promo HTML</h1>', { tipo: 'text/html' })).status, 200);
  assert.ok(!fs.existsSync(A.pastaPaginas(D, 'promo.json')));
  assert.match(A.ler(D, 'paginas/promo/index.html'), /Promo HTML/);
});

test('7) componentes do site pela API: grava sites-config/<d>/componentes/<nome>.json e o site muda; inválido é 422', async () => {
  const lista = await pedir('GET', `/v1/sites/${D}/componentes`);
  assert.deepEqual(lista.j.componentes.map((c) => c.nome), ['estoque', 'filtro', 'filtros-ativos']);
  const r = await pedir('PUT', `/v1/sites/${D}/componentes/estoque?esperar=30`, { preco: '#c00000', porPagina: 2, whatsapp: false });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(A.raiz(), 'sites-config', D, 'componentes', 'estoque.json'), 'utf8')), { preco: '#c00000', porPagina: 2, whatsapp: false });
  const lista2 = A.ler(D, 'multipla/index.html');
  assert.match(lista2, /--c-preco:#c00000/);
  assert.match(lista2, /data-pagina="2"/);
  assert.equal((await pedir('GET', `/v1/sites/${D}/componentes/estoque`)).j.opcoes.porPagina, 2);
  const ruim = await pedir('PUT', `/v1/sites/${D}/componentes/estoque`, { cor: 'azul-piscina', colunass: 3 });
  assert.equal(ruim.status, 422);
  assert.ok(ruim.j.erros.some((e) => /cor inválida/.test(e)) && ruim.j.erros.some((e) => /não tem a opção "colunass"/.test(e)), JSON.stringify(ruim.j));
  assert.equal((await pedir('PUT', `/v1/sites/${D}/componentes/nao-existe`, {})).status, 404);
  assert.equal((await pedir('PATCH', `/v1/sites/${D}`, { componentes: { estoque: {} } })).status, 422, 'no cadastro não');
  assert.equal((await pedir('DELETE', `/v1/sites/${D}/componentes/estoque?esperar=30`)).status, 200);
  assert.doesNotMatch(A.ler(D, 'multipla/index.html'), /--c-preco:#c00000/, 'sem o arquivo, volta ao padrão');
});
