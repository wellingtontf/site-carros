// Formato compacto do estoque.json gerado em sites-public (site.json → "formatoEstoque": "compacto"). O MESMO arquivo roda no build (Node, para
// compactar) e no navegador (para desempacotar): os dois lados nunca divergem.
//
// Lista de hoje:  [ { "i": "A1", "m": "Toyota", "o": "Corolla", ..., "r": 0 }, ... ]   (as chaves se repetem em cada carro)
// Compacto:       { "formato": "colunas-1", "total": N, "campos": [...ordem das chaves...],
//                   "dic": { "m": ["Toyota", "Honda"], ... },     textos que se repetem: uma vez só
//                   "col": { "i": ["A1", ...], "m": [0, 1, 0, ...], ... } }   uma lista por campo (sem repetir chaves)
// "r" (posição na ordem de exibição) não vai: é a própria posição na lista.
// descompactar(compactar(x)) devolve EXATAMENTE x (mesmas chaves, mesma ordem): o motor recebe os mesmos dados de antes,
// então busca, filtros e ordenação funcionam igual, com qualquer versão do motor.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.FormatoEstoque = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  var FORMATO = 'colunas-1';
  // campos de texto que se repetem muito entre os carros (marca, modelo, versão, cor, câmbio, combustível, loja, cidade, UF,
  // carroceria, data de publicação)
  var DICIONARIO = ['m', 'o', 'v', 'c', 'b', 'f', 'u', 'cd', 'uf', 'cr', 'dp'];

  function compactar(lista) {
    var campos = [], vistos = {};
    lista.forEach(function (c) { Object.keys(c).forEach(function (k) { if (!vistos[k]) { vistos[k] = 1; campos.push(k); } }); });
    var dic = {}, col = {}, indice = {};
    campos.forEach(function (k) {
      if (k === 'r') return;
      var usaDic = DICIONARIO.indexOf(k) >= 0;
      if (usaDic) { dic[k] = []; indice[k] = {}; }
      col[k] = lista.map(function (c) {
        if (!(k in c)) return null;
        if (!usaDic) return c[k];
        var v = c[k];
        if (!(v in indice[k])) { indice[k][v] = dic[k].length; dic[k].push(v); }
        return indice[k][v];
      });
    });
    return { formato: FORMATO, total: lista.length, campos: campos, dic: dic, col: col };
  }

  function descompactar(j) {
    if (Array.isArray(j)) return j; // formato de sempre: nada a fazer
    if (!j || j.formato !== FORMATO) throw new Error('estoque.json em formato desconhecido');
    var lista = new Array(j.total);
    for (var i = 0; i < j.total; i++) {
      var c = {};
      for (var n = 0; n < j.campos.length; n++) {
        var k = j.campos[n];
        if (k === 'r') { c.r = i; continue; }
        var v = j.col[k][i];
        if (v === null || v === undefined) continue;
        c[k] = j.dic[k] ? j.dic[k][v] : v;
      }
      lista[i] = c;
    }
    return lista;
  }

  return { FORMATO: FORMATO, compactar: compactar, descompactar: descompactar };
});
