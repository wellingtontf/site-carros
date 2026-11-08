#!/usr/bin/env node
// Leva temas, sites e inquilinos para os nomes do padrão Shopify (decisão do Wellington, 2026-11-08). Roda quantas vezes
// quiser: o que já está no formato novo fica como está.
//
//   TEMAS (templates/<nome>/ → temas/<nome>/; também inquilinos/<id>/templates/ → inquilinos/<id>/temas/)
//     template.json → config/settings_schema.json     paginas/ → templates/     blocos/ → secoes/
//     parciais/ → snippets/                             css/ js/ img/ → assets/
//     no HTML: {{tema.x}} → {{configuracoes.x}}, {{{blocosAntes}}} → {{{secoesAntes}}} (e Depois)
//     paginas-padrao/*.json: "blocos" → "secoes"
//   SITES (sites-config/<d>/)
//     site.json: "template" → "tema"; o objeto "tema" (cores, logo) → "configuracoes"; "pagina404.blocos" → "secoes"
//     web/index.json e web/paginas/**/*.json: "blocos" → "secoes"; web/multipla.json: "blocosAntes/Depois" → "secoesAntes/Depois"
//   INQUILINOS: inquilino.json "templates" → "temas"; config/site-modelo.json (e o global) como o site.json
//
//   node ferramentas/migrar-temas.js            tudo
//   node ferramentas/migrar-temas.js --simular  só mostra o que faria
const fs = require('fs');
const path = require('path');
const C = require('../core/caminhos');

const SIMULAR = process.argv.includes('--simular');
const rel = (p) => path.relative(C.ROOT, p) || '.';
const log = (m) => console.log(`${SIMULAR ? '[simulação] ' : ''}${m}`);
const lerJSON = (p) => { const t = fs.readFileSync(p, 'utf8'); return t.trim() ? JSON.parse(t) : null; };
const gravarJSON = (p, o) => { if (!SIMULAR) fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const mover = (de, para) => { log(`${rel(de)} → ${rel(para)}`); if (!SIMULAR) { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.renameSync(de, para); } };
const arquivos = (dir, ext) => {
  const r = [];
  const andar = (d) => { if (fs.existsSync(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) andar(p); else if (p.endsWith(ext)) r.push(p); } };
  andar(dir);
  return r;
};

// ---- um tema ----
const ESTRUTURA = [['template.json', C.TEMA.schema], ['paginas', C.TEMA.templates], ['blocos', C.TEMA.secoes], ['parciais', C.TEMA.snippets],
  ['css', path.join(C.TEMA.assets, 'css')], ['js', path.join(C.TEMA.assets, 'js')], ['img', path.join(C.TEMA.assets, 'img')]];
function migrarTema(dir) {
  let mexeu = false;
  for (const [velho, novo] of ESTRUTURA) {
    const de = path.join(dir, velho);
    if (!fs.existsSync(de)) continue;
    if (fs.existsSync(path.join(dir, novo))) { console.error(`${rel(dir)}: ${velho} e ${novo} existem os dois; ${velho} não mexido`); process.exitCode = 1; continue; }
    mover(de, path.join(dir, novo)); mexeu = true;
  }
  for (const f of arquivos(dir, '.html')) {
    const t = fs.readFileSync(f, 'utf8');
    const n = t.replace(/\{\{([#^/]?)tema\./g, '{{$1configuracoes.').replace(/\bblocos(Antes|Depois)\b/g, 'secoes$1');
    if (n !== t) { log(`${rel(f)}: {{tema.*}} → {{configuracoes.*}} / blocosAntes → secoesAntes`); if (!SIMULAR) fs.writeFileSync(f, n); mexeu = true; }
  }
  for (const f of arquivos(path.join(dir, C.TEMA.paginasPadrao), '.json')) mexeu = trocarSecoes(f) || mexeu;
  return mexeu;
}
// "blocos" → "secoes" num JSON de página (e blocosAntes/Depois da multipla)
function trocarSecoes(arq) {
  const j = lerJSON(arq);
  if (!j || typeof j !== 'object') return false;
  const NOVO = { blocos: 'secoes', blocosAntes: 'secoesAntes', blocosDepois: 'secoesDepois' };
  const velhos = Object.keys(j).filter((k) => NOVO[k]);
  if (!velhos.length) return false;
  const dup = velhos.find((k) => j[NOVO[k]] !== undefined);
  if (dup) { console.error(`${rel(arq)}: "${dup}" e "${NOVO[dup]}" existem os dois; não mexido`); process.exitCode = 1; return false; }
  log(`${rel(arq)}: ${velhos.join(', ')} → ${velhos.map((k) => NOVO[k]).join(', ')}`);
  gravarJSON(arq, Object.fromEntries(Object.entries(j).map(([k, v]) => [NOVO[k] || k, v]))); // mesma ordem das chaves
  return true;
}

// site.json (ou site-modelo.json): "template" → "tema", objeto "tema" → "configuracoes", pagina404.blocos → secoes
function cadastroNovo(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  let mexeu = false;
  const novo = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'template') { novo.tema = v; mexeu = true; } else if (k === 'tema' && v && typeof v === 'object') { novo.configuracoes = v; mexeu = true; } else novo[k] = v;
  }
  if (novo.pagina404 && novo.pagina404.blocos !== undefined && novo.pagina404.secoes === undefined) {
    const { blocos, ...resto } = novo.pagina404; novo.pagina404 = { ...resto, secoes: blocos }; mexeu = true;
  }
  return mexeu ? novo : null;
}
function migrarCadastro(arq) {
  if (!fs.existsSync(arq)) return false;
  const n = cadastroNovo(lerJSON(arq));
  if (!n) return false;
  log(`${rel(arq)}: "template" → "tema", "tema" {…} → "configuracoes"`);
  gravarJSON(arq, n);
  return true;
}
function migrarSite(d) {
  let mexeu = migrarCadastro(C.siteJson(d));
  for (const f of arquivos(C.web(d), '.json')) mexeu = trocarSecoes(f) || mexeu;
  return mexeu;
}

function migrarTudo() {
  let mexeu = false;
  // pastas de temas: templates/ (antigo) → temas/; o mesmo nos inquilinos
  const pares = [[path.join(C.ROOT, 'templates'), C.TEMAS]];
  if (fs.existsSync(C.INQUILINOS)) for (const id of fs.readdirSync(C.INQUILINOS)) pares.push([path.join(C.inquilino(id), 'templates'), C.inquilinoTemas(id)]);
  for (const [velha, nova] of pares) {
    if (!fs.existsSync(velha)) continue;
    for (const nome of fs.readdirSync(velha)) {
      if (fs.existsSync(path.join(nova, nome))) { console.error(`${rel(velha)}/${nome}: já existe ${rel(nova)}/${nome}; não mexido`); process.exitCode = 1; continue; }
      mover(path.join(velha, nome), path.join(nova, nome)); mexeu = true;
    }
    if (!SIMULAR && !fs.readdirSync(velha).length) fs.rmdirSync(velha);
  }
  const temas = [];
  for (const raiz of [C.TEMAS, ...(fs.existsSync(C.INQUILINOS) ? fs.readdirSync(C.INQUILINOS).map((id) => C.inquilinoTemas(id)) : [])]) {
    if (fs.existsSync(raiz)) for (const e of fs.readdirSync(raiz, { withFileTypes: true })) if (e.isDirectory()) temas.push(path.join(raiz, e.name));
  }
  for (const t of temas) mexeu = migrarTema(t) || mexeu;
  // inquilinos
  if (fs.existsSync(C.INQUILINOS)) for (const id of fs.readdirSync(C.INQUILINOS)) {
    const arq = C.inquilinoJson(id);
    if (fs.existsSync(arq)) {
      const j = lerJSON(arq);
      if (j && j.templates !== undefined) { const { templates, ...resto } = j; log(`${rel(arq)}: "templates" → "temas"`); gravarJSON(arq, { ...resto, temas: templates }); mexeu = true; }
    }
    mexeu = migrarCadastro(C.inquilinoConfig(id, 'site-modelo.json')) || mexeu;
  }
  mexeu = migrarCadastro(C.config('site-modelo.json')) || mexeu;
  // sites
  if (fs.existsSync(C.SITES)) for (const d of fs.readdirSync(C.SITES)) if (fs.existsSync(C.siteJson(d))) mexeu = migrarSite(d) || mexeu;
  return mexeu;
}

if (require.main === module) {
  if (!migrarTudo()) console.log('nada a migrar: tudo já está nos nomes novos (tema, configuracoes, secoes, temas/)');
}
module.exports = { migrarTudo, migrarTema, migrarSite, cadastroNovo, trocarSecoes };
