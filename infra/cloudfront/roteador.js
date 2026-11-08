// CloudFront Function (runtime cloudfront-js-2.0), evento "viewer request", na frente de TODOS os sites.
// O S3 guarda os sites gerados (sites-public/<dominio>/...); esta função adapta o pedido do navegador ao que o S3 entende:
//   /multipla/            → /multipla/index.html          (S3 não tem "índice de pasta")
//   /multipla             → 301 /multipla/                (um endereço só por página: bom para o SEO)
//   /carros//x.html       → 301 /carros/x.html            (links antigos do Revenda Mais com "//")
//   /a/../b               → 400                           (nada de sair da pasta do site)
//   /multipla/marca/toyota/ → 301 /multipla/?marca=toyota  (nada existe depois de /multipla/: filtro é parâmetro; vale
//   /multipla/revenda_cidade_nome/Curitiba → ?cidade=Curitiba   para os endereços antigos do Revenda Mais e das páginas
//                                                           fixas de filtro; a listagem acerta maiúscula/acento sozinha)
//   /contato, /lojas/     → 301 /paginas/contato/          (página de conteúdo só existe em /paginas/; endereço antigo
//                                                           — do site do Revenda Mais ou de antes da mudança — vira 301)
// PREFIXO_POR_DOMINIO: com uma distribuição só para todos os sites e origem no bucket inteiro, prefixa o caminho com a
// pasta do site pelo domínio (www.loja.com.br e loja.com.br → /loja.com.br/...). Com o CloudFront SaaS Manager
// (recomendado: cada site é um "distribution tenant" com origin path próprio), deixe false: a origem já é a pasta do site,
// e a página de erro 404 de cada site (custom error response "/404.html") funciona sozinha.
var PREFIXO_POR_DOMINIO = false;
// pastas do site que NÃO são páginas de conteúdo (iguais ao RESERVADOS de core/build.js): o resto vai para /paginas/
// pasta depois de /multipla/ (endereço antigo) → parâmetro do filtro
var FILTRO_DA_PASTA = { marca: 'marca', modelo: 'modelo', 'modelo-marca': 'modelo', cidade: 'cidade', revenda_cidade_nome: 'cidade',
  estado: 'estado', carroceria: 'carroceria', combustivel: 'combustivel', cambio: 'cambio', cor: 'cor', loja: 'loja' };
var PASTAS_DO_SITE = { multipla: 1, carros: 1, carro: 1, paginas: 1, assets: 1, css: 1, js: 1, img: 1, motor: 1 };

function handler(event) {
  var req = event.request;
  var uri = req.uri || '/';
  if (/(^|\/)\.\.?(\/|$)/.test(uri)) return { statusCode: 400, statusDescription: 'Bad Request' };
  var limpo = uri.replace(/\/{2,}/g, '/');
  var ultimo = limpo.split('/').pop();
  var primeiro = limpo.split('/')[1] || '';
  // qualquer coisa depois de /multipla/ (menos arquivos, ex.: /multipla/index.html) → 301 para /multipla/?campo=valor
  var partes = limpo.split('/');
  if (primeiro === 'multipla' && partes.length > 3 && partes.slice(2).join('') !== '' && ultimo.indexOf('.') === -1) {
    var campo = FILTRO_DA_PASTA[partes[2]], valor = partes.slice(3).filter(function (x) { return x !== ''; }).join(' ');
    try { valor = decodeURIComponent(valor); } catch (e) { /* fica como veio */ }
    var resto = query(req.querystring);
    var qf = campo && valor ? campo + '=' + encodeURIComponent(valor) : '';
    var juntos = [qf, resto].filter(function (x) { return x; }).join('&');
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: '/multipla/' + (juntos ? '?' + juntos : '') }, 'cache-control': { value: 'max-age=86400' } } };
  }
  if (primeiro === 'multipla' && partes.length === 3 && partes[2] !== '' && ultimo.indexOf('.') === -1) {
    var r2 = query(req.querystring);
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: '/multipla/' + (r2 ? '?' + r2 : '') }, 'cache-control': { value: 'max-age=86400' } } };
  }
  // endereço de página fora de /paginas/ (sem extensão, fora das pastas do site) → 301 para /paginas/
  if (primeiro && ultimo.indexOf('.') === -1 && !PASTAS_DO_SITE[primeiro]) {
    var q = query(req.querystring);
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: '/paginas' + limpo.replace(/\/?$/, '/') + (q ? '?' + q : '') }, 'cache-control': { value: 'max-age=86400' } } };
  }
  // sem barra no fim e sem extensão = pasta: redireciona para a forma com barra
  if (limpo !== uri || (ultimo !== '' && ultimo.indexOf('.') === -1)) {
    var destino = ultimo !== '' && ultimo.indexOf('.') === -1 ? limpo + '/' : limpo;
    var qs = query(req.querystring);
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: destino + (qs ? '?' + qs : '') }, 'cache-control': { value: 'max-age=3600' } } };
  }
  if (limpo.charAt(limpo.length - 1) === '/') limpo += 'index.html';
  if (PREFIXO_POR_DOMINIO) {
    var host = ((req.headers.host && req.headers.host.value) || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
    if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return { statusCode: 400, statusDescription: 'Bad Request' };
    limpo = '/' + host + limpo;
  }
  req.uri = limpo;
  return req;
}

// querystring do evento → texto (para não perder ?marca=Toyota&v=carlos no redirecionamento)
function query(q) {
  var partes = [];
  for (var k in q) {
    var v = q[k];
    if (v.multiValue) for (var i = 0; i < v.multiValue.length; i++) partes.push(k + '=' + v.multiValue[i].value);
    else partes.push(v.value === '' ? k : k + '=' + v.value);
  }
  return partes.join('&');
}

if (typeof module !== 'undefined') module.exports = { handler: handler, _definirPrefixo: function (v) { PREFIXO_POR_DOMINIO = v; } };
