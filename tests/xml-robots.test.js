// robots.txt por modelo (core/robots.js); e o estoque.xml antigo (feed XML, retirado da plataforma) sai da saída.
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

test('sem estoque.xml: o feed XML saiu da plataforma; o arquivo velho (e o carros.json antigo) é apagado e despublicado', () => {
  A.criarSite(ID, { carros: [A.carro()] });
  build();
  assert.ok(!A.existe(ID, 'estoque.xml'), 'build não gera mais o XML');
  assert.ok(A.existe(ID, 'estoque.json') && !A.existe(ID, 'carros.json'), 'os carros do motor saem em estoque.json');
  // saída de uma versão anterior do build
  for (const velho of ['estoque.xml', 'carros.json']) fs.writeFileSync(A.saida(ID, velho), 'antigo');
  A.limparPendentes();
  build();
  assert.ok(!A.existe(ID, 'estoque.xml') && !A.existe(ID, 'carros.json'));
  assert.ok(A.pendente(ID).removidos.includes(`${ID}/estoque.xml`) && A.pendente(ID).removidos.includes(`${ID}/carros.json`), 'despublica');
  A.limparPendentes();
  build();
  assert.equal(A.pendente(ID), undefined, 'segundo build sem mudanças');
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
