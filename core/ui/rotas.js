// Rotas da listagem: os filtros moram no CAMINHO, depois de /multipla/, em pares campo/valor, em qualquer ordem:
//   /multipla/revenda-estado-cod/PR|RS/revenda-cidade-nome/Cascavel|Curitiba/marca/AUDI|BMW/veic-anomodelo/2027
// Os nomes são os do Revenda Mais com "-" no lugar de "_" (decisão do Wellington); | = mais de um valor no mesmo filtro.
// Para ler, valem também com "_" (links antigos: /multipla/revenda_estado_cod/PR) e os nomes do motor (estado, cidade, ano).
// O site continua ESTÁTICO: nenhum arquivo é gerado depois de /multipla/. A hospedagem entrega o mesmo
// multipla/index.html para qualquer /multipla/... (infra/cloudfront/roteador.js; local: ferramentas/servidor-local.js) e
// a ui-lista lê o caminho. Busca (q), ordem (ord) e vendedor (v) continuam na query: /multipla/marca/Fiat?ord=menor.
// O MESMO arquivo roda no navegador (ui-lista), no build (links do estoque) e nos testes.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Rotas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  var PASTA = 'multipla';
  // campos de filtro do motor (o nome que sai nos links que o site gera)
  var CAMPOS = ['estado', 'cidade', 'loja', 'marca', 'modelo', 'carroceria', 'ano', 'preco', 'km', 'cambio', 'combustivel', 'cor'];
  // nome de cada campo NA ROTA (o que o site escreve): o do Revenda Mais, com "-"; o que não está aqui sai com o nome do campo
  var NOMES = { estado: 'revenda-estado-cod', cidade: 'revenda-cidade-nome', ano: 'veic-anomodelo' };
  // outros nomes que chegam em links (sempre comparados com "-": revenda_cidade_nome = revenda-cidade-nome)
  var APELIDOS = {
    'revenda-estado': 'estado', uf: 'estado', 'revenda-cidade': 'cidade', 'revenda-nome': 'loja', revenda: 'loja',
    'modelo-marca': 'modelo', 'marca-nome': 'marca', 'modelo-nome': 'modelo', 'veic-ano': 'ano', 'ano-modelo': 'ano', anomodelo: 'ano',
    'cambio-nome': 'cambio', 'combustivel-nome': 'combustivel', 'cor-nome': 'cor', 'carroceria-nome': 'carroceria',
  };
  var LER = {};
  CAMPOS.forEach(function (c) { LER[c] = c; });
  Object.keys(APELIDOS).forEach(function (k) { LER[k] = APELIDOS[k]; });
  Object.keys(NOMES).forEach(function (c) { LER[NOMES[c]] = c; });
  var campoDe = function (nome) {
    var n = String(nome || '').toLowerCase().replace(/_/g, '-');
    return Object.prototype.hasOwnProperty.call(LER, n) ? LER[n] : null;
  };
  var nomeNaRota = function (campo) { return NOMES[campo] || campo; };
  var dec = function (s) { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } };
  // valor no caminho: SEMPRE minúsculo (decisão do Wellington: marca/audi|bmw/combustivel/flex), codificado como em
  // qualquer URL, com "|" (vários valores) legível. A listagem acerta para o valor do estoque ("audi" → "Audi").
  var enc = function (v) { return encodeURIComponent(String(v).toLocaleLowerCase('pt-BR')).replace(/%7C/gi, '|'); };

  // "/loja.com.br/multipla/marca/Toyota/" → { base: "/loja.com.br/multipla/", resto: "marca/Toyota/" }; fora da listagem: null
  function separar(caminho) {
    var p = String(caminho || '');
    var i = p.indexOf('/' + PASTA + '/');
    if (i < 0) return null;
    var base = p.slice(0, i + PASTA.length + 2);
    var resto = p.slice(base.length);
    if (resto === 'index.html') resto = '';
    return { base: base, resto: resto };
  }

  // "marca/Toyota/revenda_cidade_nome/Canoas%7CCascavel" → [["marca","Toyota"],["cidade","Canoas|Cascavel"]]
  // campo desconhecido é ignorado (com o valor dele); campo repetido junta os valores.
  function ler(resto) {
    var partes = String(resto || '').split('/').filter(function (x) { return x !== ''; });
    var pares = [], pos = {};
    for (var i = 0; i + 1 < partes.length; i += 2) {
      var campo = campoDe(dec(partes[i]));
      var valor = dec(partes[i + 1]);
      if (!campo || valor === '') continue;
      if (campo in pos) pares[pos[campo]][1] += '|' + valor;
      else { pos[campo] = pares.length; pares.push([campo, valor]); }
    }
    return pares;
  }

  // [["marca","Toyota"],["cidade","Canoas|Cascavel"]] → "marca/Toyota/cidade/Canoas|Cascavel" (sem barra no fim)
  function montar(pares) {
    return pares.filter(function (p) { return p[1] !== '' && p[1] != null; })
      .map(function (p) { return nomeNaRota(p[0]) + '/' + enc(p[1]); }).join('/');
  }

  // query de filtros ("marca=Toyota&q=civic&ord=menor") → { pares (campos de filtro), resto (q, ord, v, o que não é filtro) }
  function daQuery(query) {
    var pares = [], resto = [];
    String(query || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var j = kv.indexOf('='), k = dec(j < 0 ? kv : kv.slice(0, j)), v = j < 0 ? '' : dec(kv.slice(j + 1));
      var campo = campoDe(k);
      if (campo && v !== '') pares.push([campo, v]); else resto.push(kv);
    });
    return { pares: pares, resto: resto.join('&') };
  }

  return { PASTA: PASTA, CAMPOS: CAMPOS, NOMES: NOMES, APELIDOS: APELIDOS, campoDe: campoDe, nomeNaRota: nomeNaRota, separar: separar, ler: ler, montar: montar, daQuery: daQuery };
});
