// Função de borda do CloudFront (infra/cloudfront/roteador.js): índice de pasta, barra final, "//" dos links antigos
// do Revenda Mais e, no modo de distribuição única, a pasta do site pelo domínio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../infra/cloudfront/roteador.js');

const ev = (uri, { host = 'www.loja.com.br', qs = {} } = {}) => ({ request: { uri, querystring: qs, headers: { host: { value: host } } } });

test('pasta → index.html; arquivo segue igual', () => {
  assert.equal(R.handler(ev('/')).uri, '/index.html');
  assert.equal(R.handler(ev('/multipla/')).uri, '/multipla/index.html');
  assert.equal(R.handler(ev('/carros/Toyota/Corolla/X/Toyota-Corolla-X-2024-Curitiba-Parana-1.html')).uri, '/carros/Toyota/Corolla/X/Toyota-Corolla-X-2024-Curitiba-Parana-1.html');
  assert.equal(R.handler(ev('/css/style.css')).uri, '/css/style.css');
});

test('sem barra final → 301 com a barra, mantendo a busca', () => {
  const r = R.handler(ev('/multipla', { qs: { marca: { value: 'Toyota' }, v: { value: 'carlos' } } }));
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location.value, '/multipla/?marca=Toyota&v=carlos');
});

test('"//" dos links antigos do Revenda Mais → 301 para o caminho limpo', () => {
  const r = R.handler(ev('/carros/Jeep/Compass//Jeep-Compass--2021-Curitiba-Parana-9.html'));
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location.value, '/carros/Jeep/Compass/Jeep-Compass--2021-Curitiba-Parana-9.html');
});

test('".." é recusado', () => {
  assert.equal(R.handler(ev('/a/../sites/b/index.html')).statusCode, 400);
});

test('distribuição única: pasta do site pelo domínio (com ou sem www)', () => {
  R._definirPrefixo(true);
  try {
    assert.equal(R.handler(ev('/multipla/', { host: 'www.trokey.com.br' })).uri, '/trokey.com.br/multipla/index.html');
    assert.equal(R.handler(ev('/', { host: 'site7.carro57.com.br' })).uri, '/site7.carro57.com.br/index.html');
    assert.equal(R.handler(ev('/', { host: 'evil/../x' })).statusCode, 400);
  } finally { R._definirPrefixo(false); }
});

test('página fora de /paginas/ (endereço antigo) → 301 para /paginas/, mantendo a busca; pastas do site não', () => {
  for (const [de, para] of [['/contato', '/paginas/contato/'], ['/contato/', '/paginas/contato/'], ['/financiamento', '/paginas/financiamento/'], ['/sobre/nos/', '/paginas/sobre/nos/']]) {
    const r = R.handler(ev(de));
    assert.equal(r.statusCode, 301, de);
    assert.equal(r.headers.location.value, para, de);
  }
  assert.equal(R.handler(ev('/contato/', { qs: { v: { value: 'carlos' } } })).headers.location.value, '/paginas/contato/?v=carlos');
  assert.equal(R.handler(ev('/paginas/contato/')).uri, '/paginas/contato/index.html');
  assert.equal(R.handler(ev('/assets/logo.png')).uri, '/assets/logo.png');
  assert.equal(R.handler(ev('/sitemap.xml')).uri, '/sitemap.xml');
  assert.equal(R.handler(ev('/')).uri, '/index.html');
});

test('nada depois de /multipla/: endereço antigo de filtro (Revenda Mais e páginas fixas) → 301 /multipla/?campo=valor', () => {
  const para = (u, o) => { const r = R.handler(ev(u, o)); assert.equal(r.statusCode, 301, u); return r.headers.location.value; };
  assert.equal(para('/multipla/marca/caoa%20chery/'), '/multipla/?marca=caoa%20chery');
  assert.equal(para('/multipla/marca/TOYOTA'), '/multipla/?marca=TOYOTA');
  assert.equal(para('/multipla/revenda_cidade_nome/S%C3%A3o%20Jos%C3%A9'), '/multipla/?cidade=S%C3%A3o%20Jos%C3%A9');
  assert.equal(para('/multipla/cidade/porto-alegre/'), '/multipla/?cidade=porto-alegre');
  assert.equal(para('/multipla/carroceria/moto/', { qs: { v: { value: 'carlos' } } }), '/multipla/?carroceria=moto&v=carlos');
  assert.equal(para('/multipla/modelo-marca/COROLLA'), '/multipla/?modelo=COROLLA');
  assert.equal(para('/multipla/qualquer/coisa/'), '/multipla/', 'pasta desconhecida: a listagem inteira');
  assert.equal(para('/multipla/marca'), '/multipla/');
  assert.equal(R.handler(ev('/multipla/')).uri, '/multipla/index.html');
  assert.equal(R.handler(ev('/multipla/index.html')).uri, '/multipla/index.html');
});
