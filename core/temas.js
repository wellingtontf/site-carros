// Temas (temas/<nome>/, padrão Shopify): o que cada tema DECLARA que o site pode configurar, e os textos padrão dele.
//
//   config/settings_schema.json   { "nome", "descricao",
//                                   "configuracoes": { "<chave>": { "tipo", "padrao", "rotulo", "descricao", "valores", "campos" } },
//                                   "cabecalho": {...}, "rodape": {...} }      (mesmo formato nos três grupos)
//   locales/pt-BR.json            textos padrão do tema: { "botaoWhatsapp": "Tenho interesse (WhatsApp)", ... }
//
// O site preenche no site.json: "configuracoes" (cores, fonte, logo...), "cabecalho", "rodape" e "textos" (vale mais que o
// locale). Regra (decisão do Wellington): chave que o tema não declara = AVISO (não trava site antigo); valor de tipo errado
// = ERRO (o build para e a API responde 422).
//
// Tipos: os dos componentes ("texto", "numero", "booleano", "cor", "lista" = texto separado por vírgula; "valores"
// restringe) + "imagem" (caminho como "assets/logo.png" ou URL) + "item" (um objeto, ex.: { "rotulo", "link" }) e "itens"
// (lista de objetos, ex.: o menu [{ "rotulo", "link" }]); nos dois, "campos" diz o tipo de cada campo.
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');
const Inq = require('./inquilinos');
const Comp = require('./componentes');

const GRUPOS = ['configuracoes', 'cabecalho', 'rodape'];
const TIPOS = ['texto', 'numero', 'booleano', 'cor', 'lista', 'imagem', 'item', 'itens'];
const LOCALE = path.join('locales', 'pt-BR.json');
const cache = new Map();
const lerJSON = (arq, padrao) => {
  if (!fs.existsSync(arq)) return padrao;
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { throw new Error(`${path.relative(C.ROOT, arq)}: JSON inválido (${e.message})`); }
};

// tema de uma pasta → { id (nome da pasta), nome, descricao, configuracoes, cabecalho, rodape, textos }
// (o cache confere a data dos arquivos: a API fica no ar e o tema do inquilino é editado sem deploy)
const marca = (dir) => [C.TEMA.schema, LOCALE].map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } }).join('|');
function carregar(dir) {
  const m = marca(dir);
  if (cache.has(dir) && cache.get(dir).marca === m) return cache.get(dir).tema;
  const onde = path.relative(C.ROOT, path.join(dir, C.TEMA.schema));
  const s = lerJSON(path.join(dir, C.TEMA.schema), null);
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`${onde}: precisa ser um objeto { "nome", "configuracoes", ... }`);
  const t = { id: path.basename(dir), nome: s.nome || path.basename(dir), descricao: s.descricao || '', textos: lerJSON(path.join(dir, LOCALE), {}) };
  const erros = [];
  for (const g of GRUPOS) {
    t[g] = s[g] || {};
    for (const [k, d] of Object.entries(t[g])) {
      if (!d || typeof d !== 'object') { erros.push(`${g}.${k}: precisa ser { "tipo", "padrao" }`); continue; }
      if (d.tipo && !TIPOS.includes(d.tipo)) erros.push(`${g}.${k}: tipo "${d.tipo}" não existe (use: ${TIPOS.join(', ')})`);
      else if (d.padrao !== undefined) { const e = conferir(`${g}.${k}`, d, d.padrao); if (e) erros.push(`${g}.${k} (padrão): ${e}`); }
    }
  }
  const locOnde = path.relative(C.ROOT, path.join(dir, LOCALE));
  if (!t.textos || typeof t.textos !== 'object' || Array.isArray(t.textos)) erros.push(`${locOnde}: precisa ser um objeto { "chave": "texto" }`);
  else for (const [k, v] of Object.entries(t.textos)) if (typeof v !== 'string') erros.push(`${locOnde}: "${k}" precisa ser texto`);
  if (erros.length) throw new Error(`${onde}: ${erros.join('; ')}`);
  cache.set(dir, { marca: m, tema: t });
  return t;
}
const limparCache = () => cache.clear();

// confere UM valor contra a declaração → mensagem de erro ou null
function conferir(chave, def, v) {
  const tipo = def.tipo || 'texto';
  if (tipo === 'imagem') return typeof v === 'string' ? null : 'precisa ser o caminho ou a URL da imagem (ex.: "assets/logo.png")';
  const objeto = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'precisa ser um objeto (ex.: { "rotulo": "Contato", "link": "contato/" })';
    for (const [c, dc] of Object.entries(def.campos || {})) {
      if (item[c] === undefined) continue;
      const e = conferir(`${chave}.${c}`, dc, item[c]);
      if (e) return `"${c}": ${e}`;
    }
    return null;
  };
  if (tipo === 'item') return objeto(v);
  if (tipo === 'itens') {
    if (!Array.isArray(v)) return 'precisa ser uma lista de itens (ex.: [{ "rotulo": "Estoque", "link": "multipla/" }])';
    for (const [i, item] of v.entries()) { const e = objeto(item); if (e) return `item ${i + 1}: ${e}`; }
    return null;
  }
  if (v !== null && typeof v === 'object') return 'não pode ser objeto ou lista';
  const [, erro] = Comp.conferir('', '', { ...def, tipo }, v);
  return erro ? erro.replace(/^\.: /, '') : null;
}

// valores padrão de um grupo (só o que o tema declara com "padrao")
const padroes = (t, grupo) => Object.fromEntries(Object.entries(t[grupo] || {}).filter(([, d]) => d.padrao !== undefined).map(([k, d]) => [k, d.padrao]));

// o site contra o tema → { erros, avisos }
function validarSite(site, t) {
  const erros = [];
  const avisos = [];
  for (const g of GRUPOS) {
    const o = site[g];
    if (o == null || typeof o !== 'object' || Array.isArray(o)) continue; // formato do grupo é conferido em sites.js
    for (const [k, v] of Object.entries(o)) {
      const def = t[g][k];
      if (!def) { avisos.push(`"${g}.${k}" não é usado pelo tema "${t.id}" (${Object.keys(t[g]).length ? `erro de digitação? em "${g}" o tema aceita: ${Object.keys(t[g]).join(', ')}` : `o tema não tem nada configurável em "${g}"`})`); continue; }
      if (v === null || v === '') continue; // vazio = usa o padrão
      const e = conferir(`${g}.${k}`, def, v);
      if (e) erros.push(`"${g}.${k}": ${e}`);
    }
  }
  if (site.textos && typeof site.textos === 'object' && !Array.isArray(site.textos)) {
    for (const [k, v] of Object.entries(site.textos)) {
      if (typeof v !== 'string') erros.push(`"textos.${k}": precisa ser texto`);
      else if (!(k in t.textos)) avisos.push(`"textos.${k}" não é usado pelo tema "${t.id}" (erro de digitação? textos do tema: ${Object.keys(t.textos).join(', ') || 'nenhum'})`);
    }
  }
  return { erros, avisos };
}

// temas que um inquilino pode usar: os da imagem liberados para ele + os próprios dele
function listar(inquilino = Inq.PADRAO) {
  const nomes = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, C.TEMA.schema))) : []); // (aceita link simbólico)
  const proprios = inquilino !== Inq.PADRAO ? nomes(C.inquilinoTemas(inquilino)) : [];
  return [...new Set([...nomes(C.TEMAS).filter((n) => Inq.temaPermitido(inquilino, n)), ...proprios])].sort();
}
// descrição pública de um tema (API: GET /v1/temas/<nome>)
function descrever(inquilino, nome) {
  if (!listar(inquilino).includes(nome)) return null;
  const t = carregar(Inq.dirTema(inquilino, nome));
  return { tema: nome, proprio: Inq.temTemaProprio(inquilino, nome), nome: t.nome, descricao: t.descricao,
    configuracoes: t.configuracoes, cabecalho: t.cabecalho, rodape: t.rodape, textos: t.textos };
}

module.exports = { GRUPOS, TIPOS, LOCALE, carregar, limparCache, conferir, padroes, validarSite, listar, descrever };
