// Rotas da listagem: filtros no caminho depois de /multipla/ (core/ui/rotas.js), motor v3 com vários valores por filtro,
// hospedagem que entrega multipla/index.html para qualquer rota (infra/cloudfront/roteador.js) e o servidor local igual.
const A = require('./ajuda');
A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const R = require('../core/ui/rotas.js');
const { construir } = require('../core/build.js');

test('lê pares campo/valor em qualquer ordem, nomes do Revenda Mais, | e %7C; monta na forma canônica', () => {
  const url = new URL('https://gruposervopaseminovos.com.br/multipla/revenda_estado_cod/PR/revenda_cidade_nome/Canoas%7CCascavel%7CGravata%C3%AD%7CLondrina%7CMaring%C3%A1%7CNovo%20Hamburgo');
  const s = R.separar(url.pathname);
  assert.equal(s.base, '/multipla/');
  assert.deepEqual(R.ler(s.resto), [['estado', 'PR'], ['cidade', 'Canoas|Cascavel|Gravataí|Londrina|Maringá|Novo Hamburgo']]);
  assert.deepEqual(R.ler('marca/Fiat/cidade/Curitiba/marca/Kia'), [['marca', 'Fiat|Kia'], ['cidade', 'Curitiba']], 'campo repetido junta');
  assert.deepEqual(R.ler('nao_existe/x/marca/Fiat/sobra'), [['marca', 'Fiat']], 'campo desconhecido e par incompleto ficam de fora');
  assert.equal(R.montar([['cidade', 'São José|Curitiba'], ['marca', 'Land Rover']]), 'revenda-cidade-nome/s%C3%A3o%20jos%C3%A9|curitiba/marca/land%20rover', 'valor sempre minúsculo');
  // nomes do Revenda Mais com "-" no lugar de "_" (como o site escreve); lê com "_", com "-" e com o nome do motor
  assert.equal(R.montar([['estado', 'PR|RS'], ['ano', '2027'], ['combustivel', 'ALCOOL']]), 'revenda-estado-cod/pr|rs/veic-anomodelo/2027/combustivel/alcool');
  for (const r of ['marca/AUDI%7CBMW/veic_anomodelo/2027/combustivel/ALCOOL', 'marca/AUDI|BMW/veic-anomodelo/2027/combustivel/ALCOOL', 'MARCA/AUDI|BMW/ano/2027/combustivel/ALCOOL'])
    assert.deepEqual(R.ler(r), [['marca', 'AUDI|BMW'], ['ano', '2027'], ['combustivel', 'ALCOOL']], r);
  assert.deepEqual(R.ler('revenda_estado_cod/PR%7CRS/revenda-cidade-nome/Cascavel'), [['estado', 'PR|RS'], ['cidade', 'Cascavel']]);
  assert.deepEqual(R.ler(R.montar([['modelo', 'Onix 1.0/Plus']])), [['modelo', 'onix 1.0/plus']], 'barra no valor vai codificada');
  assert.deepEqual(R.separar('/loja.com.br/multipla/marca/Fiat'), { base: '/loja.com.br/multipla/', resto: 'marca/Fiat' }, 'servidor local (pasta do domínio)');
  assert.equal(R.separar('/multipla/index.html').resto, '');
  assert.equal(R.separar('/paginas/contato/'), null);
  assert.deepEqual(R.daQuery('?marca=Fiat&q=uno&ord=menor&v=ana'), { pares: [['marca', 'Fiat']], resto: 'q=uno&ord=menor&v=ana' });
});

test('motor v3: vários valores no mesmo filtro (OU), cascata respeitada, valor do link sem carro = nenhum carro', async () => {
  const id = 'rotas.teste.com.br';
  const carros = [A.carro({ marca: 'Fiat' }), A.carro({ marca: 'Kia' }), A.carro({ marca: 'Kia', loja: 'sul' }), A.carro({ marca: 'Jeep', loja: 'sul' })];
  A.criarSite(id, { carros, site: { motor: 'v3' } });
  A.silencioso(() => construir({ sites: [id] }));
  const m = await A.carregarMotor(A.saida(id)).criar();
  m.aplicarQuery('marca=Fiat|Kia|Nao%20Existe');
  assert.equal(m.resultado().length, 3);
  assert.equal(m.estado().valores.marca, 'Fiat|Kia|Nao Existe', 'o valor do link fica');
  m.aplicarQuery('marca=Nao%20Existe');
  assert.equal(m.resultado().length, 0, 'nenhum carro');
  m.aplicarQuery('estado=RS&cidade=Curitiba|Porto Alegre');
  assert.equal(m.resultado().length, 2, 'cidade de outro estado não dá resultado (cascata)');
  m.definir('marca', ['Kia', 'Jeep']);
  assert.deepEqual(m.filtros.find((f) => f.campo === 'marca').valores(), ['Kia', 'Jeep']);
  assert.equal(m.resultado().length, 2);
});

test('build: links de filtro saem como rota; nenhuma página depois de /multipla/; rotas não contam como link quebrado', () => {
  const id = 'rotas2.teste.com.br';
  A.criarSite(id, { carros: [A.carro({ marca: 'Fiat' }), A.carro({ marca: 'Kia', loja: 'sul' })], site: { motor: 'v3', paginas: [{ caminho: '', secoes: [{ tipo: 'lojas' }] }] } });
  A.silencioso(() => construir({ sites: [id] }));
  assert.match(A.ler(id, 'index.html'), /href="multipla\/loja\/loja%20sul"/);
  assert.ok(!/href="[^"]*multipla\/[^"]*_/.test(A.ler(id, 'index.html')), 'nenhum "_" nos links da listagem');
  assert.deepEqual(require('fs').readdirSync(A.saida(id, 'multipla')), ['index.html']);
  assert.deepEqual(A.verificarSiteGerado(id), []);
});

test('servidor local = regras da hospedagem: rota entrega a listagem (200), página antiga 301, inexistente 404.html', async () => {
  const id = 'rotas2.teste.com.br';
  const srv = require('../ferramentas/servidor-local.js').criar(path.join(A.raiz(), 'sites-public')).listen(0);
  await new Promise((ok) => srv.on('listening', ok));
  const pegar = (u) => new Promise((ok) => http.get(`http://127.0.0.1:${srv.address().port}${u}`, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => ok({ status: r.statusCode, loc: r.headers.location, b })); }));
  try {
    const lista = await pegar(`/${id}/multipla/`);
    for (const u of ['multipla/marca/Fiat', 'multipla/revenda_cidade_nome/Curitiba%7CPorto%20Alegre/marca/kia', 'multipla/modelo/Onix%201.0']) {
      const r = await pegar(`/${id}/${u}`);
      assert.equal(r.status, 200, u);
      assert.equal(r.b, lista.b, `${u}: o mesmo multipla/index.html`);
    }
    assert.deepEqual([(await pegar(`/${id}/contato`)).status, (await pegar(`/${id}/contato`)).loc], [301, `/${id}/paginas/contato/`]);
    assert.equal((await pegar(`/${id}/multipla`)).loc, `/${id}/multipla/`);
    const nada = await pegar(`/${id}/carros/nao-existe.html`);
    assert.equal(nada.status, 404);
    assert.match(nada.b, /<html/, '404.html do site');
    assert.equal((await pegar(`/${id}/css/../../site.json`)).status !== 200, true, 'não sai da pasta');
  } finally { srv.close(); }
});
