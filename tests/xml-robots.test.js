// Saídas de compatibilidade: estoque.xml (feed do estoque) e robots.txt por modelo (core/robots.js).
const A = require('./ajuda');
A.prepararRaiz();
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { construir } = require('../core/build.js');
const { reescreverRobots } = require('../core/atualizar.js');
const Robots = require('../core/robots.js');

const ID = 'xml.teste.com.br';
beforeEach(() => A.limpar());
const build = () => A.silencioso(() => construir({ sites: [ID] }));

test('estoque.xml: todos os carros, na ordem do site, com link e fotos completos e texto escapado', () => {
  A.criarSite(ID, { carros: [
    A.carro({ id: 'X2', ordem: 2, descricao: 'Peças <originais> & "revisado"\u0001', opcionais: ['Ar & direção'] }),
    A.carro({ id: 'X1', ordem: 1, fotos: 2, carroceria: 'SUV', destaque: true }),
  ] });
  build();
  const x = A.ler(ID, 'estoque.xml');
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<estoque site="xml.teste.com.br" total="2">/);
  assert.ok(x.indexOf('<id>X1</id>') < x.indexOf('<id>X2</id>'), 'ordem do site');
  assert.match(x, /<descricao>Peças &lt;originais&gt; &amp; &quot;revisado&quot;<\/descricao>/, 'escapado e sem caractere de controle');
  assert.match(x, /<opcional>Ar &amp; direção<\/opcional>/);
  assert.match(x, /<link>https:\/\/xml\.teste\.com\.br\/carros\/[^<]+-X1\.html<\/link>/);
  assert.match(x, /<fotos><foto>https:\/\/fotos\.teste\/carros\/X1\/1-1600\.webp<\/foto><foto>[^<]+2-1600\.webp<\/foto><\/fotos>/);
  assert.match(x, /<carroceria>SUV<\/carroceria><destaque>sim<\/destaque>/);
  assert.ok(!A.ler(ID, 'sitemap.xml').includes('estoque.xml'), 'feed fora do sitemap');
});

test('estoque.xml: caminho configurável; desligar apaga o arquivo e despublica', () => {
  A.criarSite(ID, { carros: [A.carro()], site: { feedXml: { caminho: 'xml/estoque.xml' } } });
  build();
  assert.ok(A.existe(ID, 'xml/estoque.xml') && !A.existe(ID, 'estoque.xml'));
  A.limparPendentes();
  const cfg = A.lerSite(ID); cfg.feedXml = false; A.gravarSite(ID, cfg);
  build();
  assert.ok(!A.existe(ID, 'xml/estoque.xml'));
  assert.ok(A.pendente(ID).removidos.includes(`${ID}/xml/estoque.xml`));
  // build de novo sem mudar nada: o feed não pode ser apagado e recriado (o build passa "sem mudanças")
  const cfg2 = A.lerSite(ID); delete cfg2.feedXml; A.gravarSite(ID, cfg2);
  build();
  A.limparPendentes();
  build();
  assert.equal(A.pendente(ID), undefined, 'segundo build sem mudanças');
  assert.ok(A.existe(ID, 'estoque.xml'));
});

test('robots.txt: padrão, modelo de todos, robots próprio do site', async () => {
  A.criarSite(ID, { carros: [A.carro()] });
  build();
  assert.equal(A.ler(ID, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${ID}/sitemap.xml\n`);
  A.limparPendentes(); // finge que publicou (o 1º build pede publicação completa)
  Robots.gravarModelo('User-agent: *\nDisallow: /busca-interna/\nSitemap: {{sitemap}}\n# {{dominio}} {{url}}');
  const r = await reescreverRobots();
  assert.deepEqual(r.alterados, [ID]);
  assert.equal(A.ler(ID, 'robots.txt'), `User-agent: *\nDisallow: /busca-interna/\nSitemap: https://${ID}/sitemap.xml\n# ${ID} https://${ID}\n`);
  assert.ok(A.pendente(ID).escritos.includes(`${ID}/robots.txt`), 'entra na publicação');
  assert.equal((await reescreverRobots()).alterados.length, 0, 'de novo: nada muda');
  // o build usa o mesmo modelo (não volta o antigo)
  build();
  assert.match(A.ler(ID, 'robots.txt'), /busca-interna/);
  // site com robots próprio: o modelo não vale para ele
  const cfg = A.lerSite(ID); cfg.robots = 'User-agent: *\nAllow: /\n'; A.gravarSite(ID, cfg);
  build();
  assert.equal(A.ler(ID, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  assert.deepEqual((await reescreverRobots()).comRobotsProprio, [ID]);
  Robots.gravarModelo(null);
});

test('validarRobots: marcador desconhecido é erro; tirar do Google e sem Sitemap são perigos', () => {
  assert.deepEqual(Robots.validarRobots(Robots.PADRAO), { erros: [], perigos: [] });
  assert.equal(Robots.validarRobots('User-agent: *\nAllow: /\nSitemap: {{mapa}}').erros.length, 1);
  assert.equal(Robots.validarRobots('').erros.length, 1);
  const p = Robots.validarRobots('User-agent: *\nDisallow: /\nSitemap: {{sitemap}}').perigos;
  assert.equal(p.length, 1);
  assert.match(p[0], /tira os sites do Google/);
  assert.equal(Robots.validarRobots('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: {{sitemap}}').perigos.length, 0, 'bloquear só um robô é normal');
  assert.equal(Robots.validarRobots('User-agent: *\nAllow: /').perigos.length, 1, 'sem Sitemap');
});
