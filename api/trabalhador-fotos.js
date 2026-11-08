// Trabalhador em segundo plano do servidor: processa as fotos por URL (core/fotos.js) um site por vez, sem segurar a
// fila de pedidos. Quando um site fica com fotos novas prontas, aoTerminar(site) pede o build dele.
const Fotos = require('../core/fotos');

function criarTrabalhador({ log = console.log, aoTerminar = () => {} } = {}) {
  const fila = new Set();
  let rodando = false, avisou = false;
  async function girar() {
    if (rodando) return;
    rodando = true;
    try {
      while (fila.size) {
        const site = fila.values().next().value;
        fila.delete(site);
        const cfg = Fotos.lerConfig();
        if (!cfg) { if (!avisou) log('aviso: há fotos por URL, mas falta config/fotos.json'); avisou = true; continue; }
        try { const r = await Fotos.processarSite(site, { log, cfg }); if (r.processados.length) aoTerminar(site); }
        catch (e) { log(`${site}: erro nas fotos: ${e.message}`); }
      }
    } finally { rodando = false; }
  }
  return {
    agendar: (site) => { if (Fotos.temTrabalho(site)) { fila.add(site); setImmediate(girar); } },
    ocupado: () => rodando || fila.size > 0,
  };
}

module.exports = { criarTrabalhador };
