// Link da página de um carro (a regra fica SÓ aqui: o build, a listagem no navegador e os testes usam este arquivo).
//   carros/<Marca>/<Modelo>/<Versao>/<Marca>-<Modelo>-<Versao>-<ano>-<Cidade>-<Estado>-<id>.html
//   ex.: carros/Toyota/Corolla/Cross-Xre-20-Flex-Aut/Toyota-Corolla-Cross-Xre-20-Flex-Aut-2024-Curitiba-Parana-8643966.html
// Cada parte: sem acento, sem pontuação ("2.0" → "20"), palavras com inicial maiúscula e separadas por hífen.
// Roda no navegador (window.LinkCarro) e no Node (require).
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.LinkCarro = m;
})(typeof self !== 'undefined' ? self : this, () => {
  const ESTADOS = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapa', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceara', DF: 'Distrito Federal',
    ES: 'Espirito Santo', GO: 'Goias', MA: 'Maranhao', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
    PA: 'Para', PB: 'Paraiba', PR: 'Parana', PE: 'Pernambuco', PI: 'Piaui', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul', RO: 'Rondonia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'Sao Paulo', SE: 'Sergipe', TO: 'Tocantins',
  };
  const PASTA = 'carros';

  // "Cross XRE 2.0 Flex Aut." → "Cross-Xre-20-Flex-Aut"
  function parte(texto) {
    const s = String(texto == null ? '' : texto)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9\s-]/g, '')
      .split(/[\s-]+/).filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join('-');
    return s || 'Nd';
  }
  const estado = (uf) => ESTADOS[String(uf || '').toUpperCase()] || uf || '';
  const idSeguro = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

  // caminho a partir da raiz do site (sem "/" no começo)
  function caminho(c) {
    const marca = parte(c.marca), modelo = parte(c.modelo), versao = parte(c.versao);
    const arquivo = [marca, modelo, versao, parte(c.ano), parte(c.cidade), parte(estado(c.uf)), idSeguro(c.id)].join('-');
    return `${PASTA}/${marca}/${modelo}/${versao}/${arquivo}.html`;
  }

  return { caminho, parte, estado, PASTA };
});
