#!/usr/bin/env node
// Tira do site.json o que agora é arquivo: "paginas" → sites-config/<dominio>/paginas/<nome>.json e "componentes" →
// sites-config/<dominio>/componentes/<nome>.json. Tira a lista "paginas" do site.json e grava cada página como arquivo em sites-config/<dominio>/paginas/
// (index.json = home, lojas.json, sobre/nos.json). Roda uma vez por site; não sobrescreve arquivo que já existe.
//   node ferramentas/mover-paginas.js [dominio1,dominio2]   (sem argumento: todos os sites)
const fs = require('fs');
const path = require('path');
const C = require('../core/caminhos');
const Sites = require('../core/sites');

const alvo = process.argv[2] ? process.argv[2].split(',') : Sites.listar();
let erro = false;
for (const d of alvo) {
  const arq = C.siteJson(d);
  const cfg = JSON.parse(fs.readFileSync(arq, 'utf8'));
  // "componentes" no site.json → sites-config/<d>/componentes/<nome>.json
  if (cfg.componentes && typeof cfg.componentes === 'object') {
    const dirC = C.componentesSite(d);
    const ja = Object.keys(cfg.componentes).find((n) => fs.existsSync(path.join(dirC, `${n}.json`)));
    if (ja) { console.error(`${d}: componentes/${ja}.json já existe; componentes não mexidos`); erro = true; }
    else {
      fs.mkdirSync(dirC, { recursive: true });
      for (const [n, op] of Object.entries(cfg.componentes)) fs.writeFileSync(path.join(dirC, `${n}.json`), JSON.stringify(op, null, 2) + '\n');
      console.log(`${d}: componentes → ${Object.keys(cfg.componentes).map((n) => `componentes/${n}.json`).join(', ')}`);
      delete cfg.componentes;
      if (!Array.isArray(cfg.paginas)) fs.writeFileSync(arq, JSON.stringify(cfg, null, 2) + '\n');
    }
  }
  if (!Array.isArray(cfg.paginas)) { console.log(`${d}: nenhuma página a mover`); continue; }
  const destinos = cfg.paginas.map((p) => {
    const caminho = String(p.caminho ?? '').replace(/^\/+|\/+$/g, '');
    const { caminho: _, ...resto } = p;
    return [path.join(C.paginasLivresSite(d), `${caminho || 'index'}.json`), resto];
  });
  const existe = destinos.find(([f]) => fs.existsSync(f));
  if (existe) { console.error(`${d}: ${path.relative(C.ROOT, existe[0])} já existe; nada foi mexido neste site`); erro = true; continue; }
  for (const [f, conteudo] of destinos) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(conteudo, null, 2) + '\n'); }
  delete cfg.paginas;
  fs.writeFileSync(arq, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${d}: ${destinos.length} página(s) → ${destinos.map(([f]) => path.relative(C.ROOT, f)).join(', ')}`);
}
process.exitCode = erro ? 1 : 0;
