// Versões congeladas do motor (core/motor/v1, v2...) e dos temas (temas/<nome>/v1, v2...). O rascunho fica de fora: site
// nenhum roda com ele em produção (só a prévia: build --motor rascunho / --versao-tema rascunho).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./caminhos');

const VERSAO_OK = /^v\d+(\.\d+)*$/;
const ordenar = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true });

const versoesMotor = () => fs.readdirSync(C.MOTOR).filter((v) => v !== 'rascunho' && fs.existsSync(path.join(C.motor(v), 'engine.js'))).sort(ordenar);
const ultimaVersao = () => versoesMotor().pop() || null;

// ---------- temas: temas/<nome>/{rascunho, v1, v2...}, cada pasta é o tema inteiro ----------
const ehVersaoDeTema = (dirRaiz, v) => fs.existsSync(path.join(dirRaiz, v, C.TEMA.schema));
const versoesTema = (dirRaiz) => (fs.existsSync(dirRaiz) ? fs.readdirSync(dirRaiz).filter((v) => VERSAO_OK.test(v) && ehVersaoDeTema(dirRaiz, v)).sort(ordenar) : []);
const ultimaVersaoTema = (dirRaiz) => versoesTema(dirRaiz).pop() || null;
// é um tema (tem rascunho ou alguma versão)?
const ehTema = (dirRaiz) => ehVersaoDeTema(dirRaiz, 'rascunho') || versoesTema(dirRaiz).length > 0;
// tema na estrutura de antes das versões (config/settings_schema.json direto na pasta do tema)
const temaSemVersoes = (dirRaiz) => fs.existsSync(path.join(dirRaiz, C.TEMA.schema));

// impressão digital de uma pasta (todos os arquivos, menos o versao.json): o teste acusa versão congelada editada
function hashPasta(dir) {
  const h = crypto.createHash('sha256');
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (rel === 'versao.json') continue;
      if (e.isDirectory()) andar(p); else { h.update(rel); h.update('\0'); h.update(fs.readFileSync(p)); h.update('\0'); }
    }
  };
  andar(dir);
  return h.digest('hex');
}

module.exports = { VERSAO_OK, versoesMotor, ultimaVersao, versoesTema, ultimaVersaoTema, ehTema, ehVersaoDeTema, temaSemVersoes, hashPasta };
