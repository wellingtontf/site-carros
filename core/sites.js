// Repositório de sites: o ÚNICO lugar que lê a pasta sites/. Todo o resto (build, atualização, CLI, API) lista,
// confere e carrega sites por aqui, para que a regra "o que é um site" exista uma vez só.
//
//   listar()             → ['a.com.br', ...]  domínios com sites/<dominio>/site.json, em ordem
//   existe(dominio)      → true/false (sem varrer a pasta)
//   carregar(dominio)    → cadastro (site.json) + id
//   carregarTodos()      → [cadastro, ...]
//   lojas(dominio)       → ids das lojas do site
//   estoque(dominio)     → { carros: [...] } atual (vazio se não houver)
//   resumo(dominio)      → { site, nome, template, motor, url, carros, lojas, atualizado }
//   resumos(filtro?)     → [resumo, ...]
//
// Cadastro:
//   validarSite(obj, dominio) → [erros]          cadastroNovo(dominio, parcial) → cadastro completo a partir do modelo
//   gravarSite(dominio, obj)  → { criado }       criarArquivos(dominio, cadastro) → estrutura de um site novo
//   renomearArquivos(antigo, novo) → desfazer()  troca o domínio em tudo que é do site (com volta atrás)
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');
const { ultimaVersao } = require('./versoes');

const ID_SITE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/; // o id do site é o domínio (nome da pasta)
const ID_LOJA = /^[a-z0-9][a-z0-9-]{0,40}$/;
const txt = (v) => typeof v === 'string' && v.trim() !== '';
const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (padrao !== undefined) return padrao; throw e; } };
const gravarJSON = (arq, obj, bonito = true) => {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, bonito ? JSON.stringify(obj, null, 2) + '\n' : JSON.stringify(obj));
  fs.renameSync(`${arq}.tmp`, arq);
};

// ---------- leitura ----------
const existe = (d) => ID_SITE.test(String(d)) && fs.existsSync(C.siteJson(d));
const listar = () => (fs.existsSync(C.SITES)
  ? fs.readdirSync(C.SITES, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(C.siteJson(e.name))).map((e) => e.name).sort()
  : []);
const carregar = (d) => ({ ...lerJSON(C.siteJson(d)), id: d });
const carregarTodos = () => listar().map(carregar);
const lojas = (d) => Object.keys(lerJSON(C.siteJson(d), {}).lojas || {});
const estoque = (d) => lerJSON(C.estoque(d), { carros: [] });
function resumo(d) {
  const s = lerJSON(C.siteJson(d), {});
  const e = estoque(d);
  return { site: d, nome: s.nome || '', rascunho: !!s.rascunho, template: s.template || '', motor: s.motor || '', url: s.url || '', carros: (e.carros || []).length, lojas: Object.keys(s.lojas || {}).length, atualizado: e.atualizado || null };
}
const resumos = (filtro = () => true) => listar().filter(filtro).map(resumo);

// ---------- cadastro ----------
function validarSite(s, dominio) {
  const erros = [];
  const e = (m) => { if (erros.length < 30) erros.push(m); };
  if (!ID_SITE.test(String(dominio))) e(`domínio inválido "${dominio}" (ex.: minhaloja.com.br, só minúsculas)`);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [...erros, 'o cadastro precisa ser um objeto JSON'];
  if ('id' in s) e('"id" não vai no cadastro: o id do site é o domínio (o endereço da chamada)');
  if (!txt(s.nome)) e('"nome" vazio ou ausente');
  if (!txt(s.template)) e('"template" vazio ou ausente');
  else if (!/^[a-z0-9-]+$/.test(s.template) || !fs.existsSync(path.join(C.template(s.template), 'template.json'))) e(`template "${s.template}" não existe`);
  if (!txt(s.motor)) e('"motor" vazio ou ausente (ex.: "v2")');
  else if (!/^[a-z0-9]+$/.test(s.motor) || !fs.existsSync(path.join(C.motor(s.motor), 'engine.js'))) e(`motor "${s.motor}" não existe`);
  if (s.url != null && !(typeof s.url === 'string' && /^https:\/\/[^\s/]+\/?$/i.test(s.url))) e('"url" precisa ser https://dominio (sem caminho)');
  if (s.fotosBase != null && !(typeof s.fotosBase === 'string' && /^https?:\/\/\S+\/$/i.test(s.fotosBase))) e('"fotosBase" precisa ser uma URL terminada em "/"');
  if (s.whatsapp != null && !/^\d{10,15}$/.test(String(s.whatsapp))) e('"whatsapp" só com números, com DDI e DDD (ex.: 5541999990000)');
  for (const k of ['paginas', 'filtros', 'ordenacao']) if (s[k] != null && !Array.isArray(s[k])) e(`"${k}" deve ser lista`);
  if (s.rascunho != null && typeof s.rascunho !== 'boolean') e('"rascunho" deve ser true ou false');
  if (s.robots != null) { const r = require('./robots').validarRobots(s.robots); r.erros.forEach((x) => e(`robots: ${x}`)); }
  if (s.feedXml != null && s.feedXml !== false && !(typeof s.feedXml === 'object' && typeof s.feedXml.caminho === 'string' && /^[a-z0-9][a-z0-9_/-]*\.xml$/.test(s.feedXml.caminho))) e('"feedXml" deve ser false ou { "caminho": "estoque.xml" }');
  // lojas: opcionais num site novo (sem lojas, o site sobe sem estoque); se vierem, cada uma completa
  if (s.lojas != null && (typeof s.lojas !== 'object' || Array.isArray(s.lojas))) e('"lojas" deve ser um objeto: { "matriz": { "nome", "cidade", "uf" } }');
  const lj = s.lojas && typeof s.lojas === 'object' && !Array.isArray(s.lojas) ? s.lojas : {};
  for (const [id, l] of Object.entries(lj)) {
    if (!ID_LOJA.test(id)) e(`loja "${id}": id só com minúsculas, números e hífen`);
    if (!l || !txt(l.nome) || !txt(l.cidade) || !/^[A-Z]{2}$/.test(String(l && l.uf))) e(`loja "${id}": precisa de "nome", "cidade" e "uf" (2 letras maiúsculas)`);
  }
  // blocos das páginas precisam existir no template (senão o build para)
  if (Array.isArray(s.paginas) && txt(s.template)) {
    s.paginas.forEach((p, i) => (p && Array.isArray(p.blocos) ? p.blocos : []).forEach((b) => {
      if (!b || !/^[a-z0-9-]+$/.test(String(b.tipo)) || !fs.existsSync(path.join(C.template(s.template), 'blocos', `${b.tipo}.html`))) e(`página ${i + 1}: bloco "${b && b.tipo}" não existe no template "${s.template}"`);
    }));
  }
  // o estoque que já está no ar precisa continuar válido com as lojas novas
  if (ID_SITE.test(String(dominio))) {
    const ids = Object.keys(lj);
    const ruins = (estoque(dominio).carros || []).filter((c) => (c.loja != null ? !ids.includes(c.loja) : ids.length !== 1));
    if (ruins.length) e(`${ruins.length} carro(s) do estoque atual ficariam sem loja (ex.: ${ruins[0].id} → "${ruins[0].loja ?? '(sem loja)'}"); mande o estoque novo junto ou mantenha a loja`);
  }
  return erros;
}

// cadastro de um site novo: config/site-modelo.json (o "padrão da casa") + o que veio na chamada.
// Só com o domínio já dá um site válido: nome = domínio, url = https://<domínio>, motor = a última versão congelada.
function cadastroNovo(dominio, parcial = {}) {
  const modelo = lerJSON(C.config('site-modelo.json'), {});
  const limpo = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))); // "_comentario" no modelo
  return { ...limpo(modelo), ...parcial, nome: parcial.nome || dominio, url: parcial.url || `https://${dominio}`, motor: parcial.motor || modelo.motor || ultimaVersao(), template: parcial.template || modelo.template || 'barra-topo' };
}

function gravarSite(dominio, obj) {
  const arq = C.siteJson(dominio);
  const criado = !fs.existsSync(arq);
  if (!criado) {
    fs.mkdirSync(path.join(C.ESTADO, 'sites-anteriores'), { recursive: true });
    fs.copyFileSync(arq, path.join(C.ESTADO, 'sites-anteriores', `${dominio}.json`));
  }
  gravarJSON(arq, obj);
  return { criado };
}

// estrutura de um site novo: sites/<dominio>/{site.json, estoque.json vazio, assets/, paginas/}
function criarArquivos(dominio, cadastro) {
  if (existe(dominio)) throw new Error(`site "${dominio}" já existe`);
  fs.mkdirSync(C.assets(dominio), { recursive: true });
  fs.mkdirSync(C.paginasLivresSite(dominio), { recursive: true });
  gravarSite(dominio, cadastro);
  if (!fs.existsSync(C.estoque(dominio))) gravarJSON(C.estoque(dominio), { carros: [] }, false);
}

// troca o domínio de um site em TUDO que é dele: pasta do site, saída gerada, estado do build (links, vendidos,
// redirecionamentos: o SEO das páginas de carro vai junto), fotos, cópias de segurança, pendências de publicação,
// config/fontes.json e as menções ao domínio no site.json (url, e-mails, links). Devolve desfazer() para voltar
// tudo como estava se um passo seguinte (o build) falhar.
function renomearArquivos(antigo, novo, { pasta = 'dist' } = {}) {
  if (!existe(antigo)) throw new Error(`site "${antigo}" não existe`);
  if (!ID_SITE.test(String(novo))) throw new Error(`domínio novo inválido "${novo}"`);
  if (fs.existsSync(C.site(novo))) throw new Error(`já existe um site "${novo}"`);
  const feitos = []; // [desfazer, ...]
  const mover = (de, para) => { if (!fs.existsSync(de)) return; fs.mkdirSync(path.dirname(para), { recursive: true }); fs.renameSync(de, para); feitos.push(() => fs.renameSync(para, de)); };
  const reescrever = (arq, fn) => { if (!fs.existsSync(arq)) return; const antes = fs.readFileSync(arq, 'utf8'); const depois = fn(antes); if (depois === antes) return; fs.writeFileSync(arq, depois); feitos.push(() => fs.writeFileSync(arq, antes)); };
  const desfazer = () => { for (const f of feitos.reverse()) { try { f(); } catch (e) { /* segue desfazendo o resto */ } } };
  // o domínio como palavra: pega "www.antigo" e "contato@antigo", mas não "xantigo" nem "antigo.outra-coisa"
  const dom = new RegExp(`(?<![a-z0-9-])${antigo.replace(/[.]/g, '\\.')}(?![a-z0-9-]|\\.[a-z0-9])`, 'gi');
  let trocas = 0;
  try {
    mover(C.site(antigo), C.site(novo));
    reescrever(C.siteJson(novo), (t) => t.replace(dom, () => { trocas++; return novo; }));
    mover(path.join(C.saida(pasta), antigo), path.join(C.saida(pasta), novo));
    mover(path.join(C.ESTADO, pasta, `${antigo}.json`), path.join(C.ESTADO, pasta, `${novo}.json`));
    mover(C.fotosEstado(antigo), C.fotosEstado(novo));
    for (const d of ['estoques-anteriores', 'sites-anteriores']) mover(path.join(C.ESTADO, d, `${antigo}.json`), path.join(C.ESTADO, d, `${novo}.json`));
    // pendências: o domínio novo precisa ser publicado inteiro; o antigo sai da lista (quem cuida dele é a infra: 301)
    const arqPend = path.join(C.ESTADO, pasta, 'pendente.json');
    if (!fs.existsSync(arqPend)) { gravarJSON(arqPend, {}, false); feitos.push(() => fs.rmSync(arqPend, { force: true })); }
    reescrever(arqPend, (t) => { const p = JSON.parse(t); delete p[antigo]; p[novo] = { escritos: [], removidos: [], completo: true }; return JSON.stringify(p); });
    reescrever(C.config('fontes.json'), (t) => { const f = JSON.parse(t); if (!(antigo in f)) return t; f[novo] = f[antigo]; delete f[antigo]; return JSON.stringify(f, null, 2) + '\n'; });
  } catch (e) { desfazer(); throw e; }
  return { trocas, desfazer };
}

module.exports = { ID_SITE, listar, existe, carregar, carregarTodos, lojas, estoque, resumo, resumos, validarSite, cadastroNovo, gravarSite, criarArquivos, renomearArquivos };
