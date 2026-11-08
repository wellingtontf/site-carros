// Inquilinos (multi-tenant): a plataforma hospeda sites de mais de uma empresa (Revenda Mais, Webmotors, terceiros...).
// Cada site pertence a UM inquilino ("inquilino" no site.json) e cada inquilino tem a SUA configuração:
//
//   inquilinos/<id>/inquilino.json   { "nome": "Revenda Mais", "templates": ["template-basico", ...], "rascunhos": { "padrao": "site{n}.carro57.com.br" } }
//                                    templates ausente = todos; rascunhos ausente = sem rascunho automático
//   inquilinos/<id>/config/<arquivo> fotos.json, infra.json, publicacao.json, robots.txt, site-modelo.json
//                                    (o que não estiver aqui vem de config/<arquivo>, a configuração global)
//   inquilinos/<id>/templates/<nome> templates PRÓPRIOS do inquilino. Ficam no volume (EFS): o designer publica sem
//                                    deploy da imagem. Valem só para os sites do inquilino; com o mesmo nome de um
//                                    template da imagem (templates/), substituem o da imagem só para ele.
//
// Inquilino "padrao": o de quem não diz nada (sites sem "inquilino", tokens sem inquilino). Usa só config/ global.
// O domínio é único na plataforma inteira: dois inquilinos nunca disputam o mesmo domínio.
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');

const PADRAO = 'padrao';
const ID_OK = /^[a-z0-9][a-z0-9-]{1,40}$/;
const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT' || padrao !== undefined) return padrao; throw new Error(`${path.relative(C.ROOT, p)} inválido: ${e.message}`); } };

const listar = () => (fs.existsSync(C.INQUILINOS)
  ? fs.readdirSync(C.INQUILINOS, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(C.inquilinoJson(e.name))).map((e) => e.name).sort()
  : []);
const existe = (id) => id === PADRAO || (ID_OK.test(String(id)) && fs.existsSync(C.inquilinoJson(id)));
function carregar(id) {
  if (id === PADRAO) return { id, nome: 'Padrão', templates: null, rascunhos: lerJSON(C.config('rascunhos.json'), null) };
  if (!existe(id)) throw new Error(`inquilino "${id}" não existe (inquilinos/${id}/inquilino.json)`);
  const j = lerJSON(C.inquilinoJson(id), {});
  return { id, nome: j.nome || id, templates: Array.isArray(j.templates) ? j.templates : null, rascunhos: j.rascunhos || null };
}
// inquilino de um site (cadastro já carregado ou domínio)
function doSite(siteOuDominio) {
  const s = typeof siteOuDominio === 'string' ? lerJSON(C.siteJson(siteOuDominio), {}) : siteOuDominio || {};
  return s.inquilino || PADRAO;
}
// arquivo de configuração do inquilino; sem ele, o global (config/<arquivo>)
function arquivoConfig(id, arquivo) {
  if (id && id !== PADRAO) { const p = C.inquilinoConfig(id, arquivo); if (fs.existsSync(p)) return p; }
  return C.config(arquivo);
}
const lerConfig = (id, arquivo, padrao = null) => lerJSON(arquivoConfig(id, arquivo), padrao);
// pasta do template para um inquilino: o dele, se existir; senão o da imagem (templates/<nome>)
function dirTemplate(id, nome) {
  if (id && id !== PADRAO && /^[a-z0-9-]+$/.test(String(nome))) { const p = path.join(C.inquilinoTemplates(id), nome); if (fs.existsSync(path.join(p, 'template.json'))) return p; }
  return C.template(nome);
}
const temTemplateProprio = (id, nome) => dirTemplate(id, nome) !== C.template(nome);
// template próprio sempre vale; os da imagem seguem a lista "templates" do inquilino (ausente = todos)
const templatePermitido = (id, nome) => { if (temTemplateProprio(id, nome)) return true; const t = carregar(id).templates; return !t || t.includes(nome); };

function criar(id, { nome, templates = null, rascunhos = null } = {}) {
  if (!ID_OK.test(String(id)) || id === PADRAO) throw new Error('id do inquilino: minúsculas, números e hífen (ex.: webmotors); "padrao" é reservado');
  if (existe(id)) throw new Error(`inquilino "${id}" já existe`);
  if (rascunhos && rascunhos.padrao) for (const outro of [PADRAO, ...listar()]) {
    const r = carregar(outro).rascunhos;
    if (r && r.padrao === rascunhos.padrao) throw new Error(`o padrão de rascunho "${rascunhos.padrao}" já é do inquilino "${outro}"`);
  }
  fs.mkdirSync(path.join(C.inquilino(id), 'config'), { recursive: true });
  fs.writeFileSync(C.inquilinoJson(id), JSON.stringify({ nome: nome || id, ...(templates ? { templates } : {}), ...(rascunhos ? { rascunhos } : {}) }, null, 2) + '\n');
  return carregar(id);
}

module.exports = { PADRAO, listar, existe, carregar, doSite, arquivoConfig, lerConfig, templatePermitido, dirTemplate, temTemplateProprio, criar };
