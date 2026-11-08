#!/usr/bin/env node
// Leva para o lugar de hoje o que mudou de lugar (roda uma vez por site; não sobrescreve arquivo que já existe):
//   sites-config/<d>/paginas/index.json      → sites-config/<d>/web/index.json   (home)
//   sites-config/<d>/paginas/<resto>         → sites-config/<d>/web/paginas/<resto>
//   site.json "estoque" {blocosAntes...}     → sites-config/<d>/web/multipla.json
//   site.json "paginas" [...]                → web/index.json e web/paginas/<nome>.json
//   site.json "componentes" {...}            → sites-config/<d>/componentes/<nome>.json
//   node ferramentas/mover-paginas.js [dominio1,dominio2]   (sem argumento: todos os sites)
// No fim, cada site passa pelos nomes do padrão Shopify (ferramentas/migrar-temas.js: "tema", "configuracoes", "secoes").
const fs = require('fs');
const path = require('path');
const C = require('../core/caminhos');
const Sites = require('../core/sites');
const Migrar = require('./migrar-temas');

const alvo = process.argv[2] ? process.argv[2].split(',') : Sites.listar();
let erro = false;
for (const d of alvo) {
  const arq = C.siteJson(d);
  const cfg = JSON.parse(fs.readFileSync(arq, 'utf8'));
  // pasta antiga sites-config/<d>/paginas/ → web/ (index.json = home na raiz de web/, o resto em web/paginas/)
  const antiga = C.paginasAntigasSite(d);
  if (fs.existsSync(antiga)) {
    const itens = fs.readdirSync(antiga);
    const destino = (n) => (n === 'index.json' ? C.home(d) : path.join(C.paginasLivresSite(d), n));
    const ja = itens.find((n) => fs.existsSync(destino(n)));
    if (ja) { console.error(`${d}: ${path.relative(C.ROOT, destino(ja))} já existe; paginas/ não mexida`); erro = true; }
    else {
      fs.mkdirSync(C.paginasLivresSite(d), { recursive: true });
      for (const n of itens) fs.renameSync(path.join(antiga, n), destino(n));
      fs.rmdirSync(antiga);
      console.log(`${d}: paginas/ → web/ (${itens.map((n) => path.relative(C.site(d), destino(n))).join(', ') || 'vazia'})`);
    }
  }
  // "estoque" no site.json → web/multipla.json ("caminho" sai: a listagem é sempre /multipla/)
  if (cfg.estoque && typeof cfg.estoque === 'object') {
    if (fs.existsSync(C.multipla(d))) { console.error(`${d}: web/multipla.json já existe; "estoque" não mexido`); erro = true; }
    else {
      const { caminho, ...m } = cfg.estoque;
      fs.mkdirSync(C.web(d), { recursive: true });
      fs.writeFileSync(C.multipla(d), JSON.stringify(m, null, 2) + '\n');
      delete cfg.estoque;
      fs.writeFileSync(arq, JSON.stringify(cfg, null, 2) + '\n');
      console.log(`${d}: "estoque" do site.json → web/multipla.json`);
    }
  }
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
  if (!Array.isArray(cfg.paginas)) { if (!Migrar.migrarSite(d)) console.log(`${d}: nada (mais) a mover`); continue; }
  const destinos = cfg.paginas.map((p) => {
    const caminho = String(p.caminho ?? '').replace(/^\/+|\/+$/g, '');
    const { caminho: _, ...resto } = p;
    return [caminho ? path.join(C.paginasLivresSite(d), `${caminho}.json`) : C.home(d), resto];
  });
  const existe = destinos.find(([f]) => fs.existsSync(f));
  if (existe) { console.error(`${d}: ${path.relative(C.ROOT, existe[0])} já existe; nada foi mexido neste site`); erro = true; continue; }
  for (const [f, conteudo] of destinos) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(conteudo, null, 2) + '\n'); }
  delete cfg.paginas;
  fs.writeFileSync(arq, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${d}: ${destinos.length} página(s) → ${destinos.map(([f]) => path.relative(C.ROOT, f)).join(', ')}`);
  Migrar.migrarSite(d);
}
process.exitCode = erro ? 1 : 0;
