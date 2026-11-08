// Repositório de sites: o ÚNICO lugar que lê a pasta sites-config/. Todo o resto (build, atualização, CLI, API) lista,
// confere e carrega sites por aqui, para que a regra "o que é um site" exista uma vez só.
//
//   listar({inquilino})  → ['a.com.br', ...]  domínios com sites-config/<dominio>/site.json, em ordem (do inquilino, se pedido)
//   existe(dominio)      → true/false (sem varrer a pasta)
//   carregar(dominio)    → cadastro (site.json) + id
//   carregarTodos()      → [cadastro, ...]
//   lojas(dominio)       → ids das lojas do site
//   estoque(dominio)     → { carros: [...] } atual (vazio se não houver)
//   resumo(dominio)      → { site, nome, tema, motor, url, carros, lojas, atualizado }
//   resumos(filtro?)     → [resumo, ...]
//
// Cadastro:
//   validarSite(obj, dominio) → [erros]          cadastroNovo(dominio, parcial) → cadastro completo a partir do modelo
//   gravarSite(dominio, obj)  → { criado }       criarArquivos(dominio, cadastro) → estrutura de um site novo
//   renomearArquivos(antigo, novo) → desfazer()  troca o domínio em tudo que é do site (com volta atrás)
//
// Rascunhos: endereços provisórios em sequência (config/rascunhos.json → "padrao": "site{n}.carro57.com.br")
//   proximoRascunho({ inquilino, reservar }) → 'site7.carro57.com.br'   ehDominioRascunho(d)   inquilinoDoRascunho(d)
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');
const { ultimaVersao } = require('./versoes');
const Inq = require('./inquilinos');

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
// listar({ inquilino }) = só os sites daquele inquilino
function listar({ inquilino = null } = {}) {
  const todos = fs.existsSync(C.SITES)
    ? fs.readdirSync(C.SITES, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(C.siteJson(e.name))).map((e) => e.name).sort()
    : [];
  return inquilino ? todos.filter((d) => Inq.doSite(d) === inquilino) : todos;
}
const carregar = (d) => ({ ...lerJSON(C.siteJson(d)), id: d });
const carregarTodos = () => listar().map(carregar);
const lojas = (d) => Object.keys(lerJSON(C.siteJson(d), {}).lojas || {});
const estoque = (d) => lerJSON(C.estoque(d), { carros: [] });
function resumo(d) {
  const s = lerJSON(C.siteJson(d), {});
  const e = estoque(d);
  return { site: d, inquilino: s.inquilino || Inq.PADRAO, nome: s.nome || '', rascunho: !!s.rascunho, tema: typeof s.tema === 'string' ? s.tema : '', motor: s.motor || '', url: s.url || '', carros: (e.carros || []).length, lojas: Object.keys(s.lojas || {}).length, atualizado: e.atualizado || null };
}
const resumos = (filtro = () => true) => listar().filter(filtro).map(resumo);

// ---------- rascunhos: site1.carro57.com.br, site2..., em sequência, POR INQUILINO ----------
// Cada inquilino tem o seu padrão (inquilino.json → "rascunhos": { "padrao": "site{n}.carro57.com.br" }; o "padrao" usa
// config/rascunhos.json). O número NUNCA volta: depois que o site3 é promovido, o próximo é o site4 (o endereço do 3
// pode ter sido compartilhado). Contador em .estado/rascunhos/<inquilino>.json + o maior número existente.
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function padraoRascunho(inquilino = Inq.PADRAO) {
  const r = Inq.carregar(inquilino).rascunhos;
  const p = r && r.padrao;
  if (!p) throw new Error(`o inquilino "${inquilino}" não tem padrão de rascunho ("rascunhos": { "padrao": "site{n}.exemplo.com.br" } em ${inquilino === Inq.PADRAO ? 'config/rascunhos.json' : `inquilinos/${inquilino}/inquilino.json`})`);
  if (p.split('{n}').length !== 2 || !ID_SITE.test(p.replace('{n}', '1'))) throw new Error(`padrão de rascunho inválido "${p}": precisa ter {n} uma vez e virar um domínio (ex.: site{n}.carro57.com.br)`);
  return p;
}
const reDoPadrao = (p) => { const [a, b] = p.split('{n}').map(escRe); return new RegExp(`^${a}([1-9]\\d*)${b}$`); };
// [inquilino, padrão] de todos os inquilinos que têm rascunho
const padroesRascunho = () => [Inq.PADRAO, ...Inq.listar()].map((id) => { try { return [id, padraoRascunho(id)]; } catch (e) { return null; } }).filter(Boolean);
// inquilino dono de um endereço de rascunho (ou null: não é endereço de rascunho)
function inquilinoDoRascunho(d) { const x = padroesRascunho().find(([, p]) => reDoPadrao(p).test(String(d))); return x ? x[0] : null; }
const ehDominioRascunho = (d) => inquilinoDoRascunho(d) !== null;
const arqContador = (inq) => path.join(C.ESTADO, 'rascunhos', `${inq}.json`);
function proximoRascunho({ inquilino = Inq.PADRAO, reservar = false } = {}) {
  const p = padraoRascunho(inquilino);
  const re = reDoPadrao(p);
  const usados = listar().map((d) => re.exec(d)).filter(Boolean).map((m) => Number(m[1]));
  let n = Math.max(lerJSON(arqContador(inquilino), {}).ultimo || 0, ...usados, 0) + 1;
  while (fs.existsSync(C.site(p.replace('{n}', n)))) n++;
  if (reservar) gravarJSON(arqContador(inquilino), { ultimo: n, em: new Date().toISOString() }, false);
  return p.replace('{n}', n);
}
// site criado num endereço de rascunho por qualquer caminho: o contador do inquilino sobe junto
function registrarRascunho(d) {
  const inq = inquilinoDoRascunho(d);
  if (!inq) return;
  const n = Number(reDoPadrao(padraoRascunho(inq)).exec(d)[1]);
  if (n > (lerJSON(arqContador(inq), {}).ultimo || 0)) gravarJSON(arqContador(inq), { ultimo: n, em: new Date().toISOString() }, false);
}

// ---------- cadastro ----------
// campos que a plataforma usa no site.json. Campo fora da lista não é erro (o site gera do mesmo jeito), mas volta como
// AVISO: "whatsap" escrito errado gravaria sem efeito e o site ficaria sem WhatsApp sem ninguém perceber.
const CAMPOS_SITE = new Set(['inquilino', 'nome', 'slogan', 'tema', 'motor', 'url', 'whatsapp', 'fotosBase', 'cor', 'configuracoes', 'textos',
  'cabecalho', 'rodape', 'lojas', 'empresa', 'vendedores', 'busca', 'filtros', 'ordenacao', 'restricoes',
  'avisoCookies', 'paginasPadrao', 'pagina404', 'retencaoVendidosDias', 'retencaoRedirecionamentoDias', 'robots', 'formatoEstoque', 'rascunho']);
const avisosSite = (s) => (s && typeof s === 'object' ? Object.keys(s).filter((k) => !CAMPOS_SITE.has(k)).map((k) => `campo "${k}" não é usado pela plataforma (erro de digitação?)`) : []);

// nomes antigos (antes do padrão Shopify, 2026-11-08): erro claro com o caminho da migração
const MIGRAR = 'node ferramentas/migrar-temas.js';
const erroSecoes = (o) => (o && typeof o === 'object' && o.blocos !== undefined ? [`"blocos" agora se chama "secoes" (${MIGRAR})`] : []);
// página de seções de um site (sites-config/<dominio>/web/paginas/<caminho>.json): formato e seções que o tema do site tem
function validarPagina(dominio, caminho, pagina) {
  const erros = [];
  if (caminho !== '' && !/^([a-z0-9][a-z0-9-]*)(\/[a-z0-9][a-z0-9-]*)*$/.test(String(caminho))) erros.push(`nome de página inválido "${caminho}" (minúsculas, números, hífen e /)`);
  if (!pagina || typeof pagina !== 'object' || Array.isArray(pagina)) return [...erros, 'a página precisa ser um objeto { "titulo", "secoes": [...] }'];
  erros.push(...erroSecoes(pagina));
  if ('caminho' in pagina) erros.push('"caminho" não vai na página: ele é o endereço da chamada');
  if (!Array.isArray(pagina.secoes) && pagina.blocos === undefined) erros.push('falta "secoes" (lista)');
  const s = existe(dominio) ? carregar(dominio) : null;
  if (s && Array.isArray(pagina.secoes)) {
    const dir = Inq.dirTema(Inq.doSite(s), s.tema);
    pagina.secoes.forEach((b, i) => {
      if (b && b.tipo === 'componente') { require('./componentes').validar(b.nome, b.opcoes, `bloco ${i + 1}`).forEach((x) => erros.push(`bloco ${i + 1}: ${x}`)); return; }
      if (!b || !/^[a-z0-9-]+$/.test(String(b.tipo)) || !fs.existsSync(path.join(dir, C.TEMA.secoes, `${b.tipo}.html`))) erros.push(`seção ${i + 1}: tipo "${b && b.tipo}" não existe no tema "${s.tema}"`);
    });
    if (pagina.secoes.filter((b) => b && b.tipo === 'listagem').length > 1) erros.push('só pode ter uma seção "listagem" por página');
  }
  return erros;
}

// web/multipla.json (listagem do estoque): { "secoesAntes": [...], "secoesDepois": [...] }, seções do tema do site
function validarMultipla(dominio, cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['a multipla precisa ser um objeto { "secoesAntes": [...], "secoesDepois": [...] }'];
  const antigos = Object.keys(cfg).filter((k) => k === 'blocosAntes' || k === 'blocosDepois');
  const fora = Object.keys(cfg).filter((k) => !['secoesAntes', 'secoesDepois', 'componentes', ...antigos].includes(k));
  const erros = [...antigos.map((k) => `"${k}" agora se chama "${k.replace('blocos', 'secoes')}" (${MIGRAR})`),
    ...fora.map((k) => `campo "${k}" não existe na multipla (use secoesAntes, secoesDepois e componentes)`)];
  // opções dos componentes SÓ desta página (valem mais que as do tema e as do site): { "filtro": { "checkbox": "marca,cidade" } }
  if (cfg.componentes != null) {
    if (typeof cfg.componentes !== 'object' || Array.isArray(cfg.componentes)) erros.push('"componentes" deve ser um objeto { "<componente>": { opções } }');
    else for (const [n, op] of Object.entries(cfg.componentes)) erros.push(...require('./componentes').validar(n, op, `componentes.${n}`));
  }
  for (const k of ['secoesAntes', 'secoesDepois']) {
    if (cfg[k] == null) continue;
    if (!Array.isArray(cfg[k])) { erros.push(`"${k}" deve ser lista de seções`); continue; }
    erros.push(...validarPagina(dominio, '', { secoes: cfg[k] }).map((x) => `${k}: ${x}`));
  }
  return erros;
}

function validarSite(s, dominio) {
  const erros = [];
  const e = (m) => { if (erros.length < 30) erros.push(m); };
  if (!ID_SITE.test(String(dominio))) e(`domínio inválido "${dominio}" (ex.: minhaloja.com.br, só minúsculas)`);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [...erros, 'o cadastro precisa ser um objeto JSON'];
  if ('id' in s) e('"id" não vai no cadastro: o id do site é o domínio (o endereço da chamada)');
  if (!txt(s.nome)) e('"nome" vazio ou ausente');
  if (s.inquilino != null && (s.inquilino === Inq.PADRAO || !Inq.existe(s.inquilino))) e(`inquilino "${s.inquilino}" não existe`);
  const inq = s.inquilino && Inq.existe(s.inquilino) ? s.inquilino : Inq.PADRAO;
  const donoRascunho = inquilinoDoRascunho(dominio);
  if (donoRascunho && donoRascunho !== inq) e(`"${dominio}" é endereço de rascunho de outro inquilino`);
  // padrão Shopify (2026-11-08): "template" virou "tema" (o nome do tema) e o antigo objeto "tema" virou "configuracoes"
  if (s.template !== undefined) e(`"template" agora se chama "tema" ("tema": "${s.template}") e as cores/logo vão em "configuracoes" (${MIGRAR})`);
  else if (s.tema && typeof s.tema === 'object') e(`"tema" agora é o NOME do tema (ex.: "template-basico"); cores, fonte e logo vão em "configuracoes" (${MIGRAR})`);
  else if (!txt(s.tema)) e('"tema" vazio ou ausente (ex.: "tema": "template-basico")');
  else if (!Inq.temaPermitido(inq, s.tema)) e(`o tema "${s.tema}" não está liberado para o inquilino "${inq}"`);
  else if (!/^[a-z0-9-]+$/.test(s.tema) || !fs.existsSync(path.join(Inq.dirTema(inq, s.tema), C.TEMA.schema))) e(`tema "${s.tema}" não existe`);
  if (s.configuracoes != null && (typeof s.configuracoes !== 'object' || Array.isArray(s.configuracoes))) e('"configuracoes" deve ser um objeto (ex.: { "cor": "#0b5fff", "logo": "assets/logo.png" })');
  if (!txt(s.motor)) e('"motor" vazio ou ausente (ex.: "v2")');
  else if (!/^[a-z0-9]+$/.test(s.motor) || !fs.existsSync(path.join(C.motor(s.motor), 'engine.js'))) e(`motor "${s.motor}" não existe`);
  if (s.url != null && !(typeof s.url === 'string' && /^https:\/\/[^\s/]+\/?$/i.test(s.url))) e('"url" precisa ser https://dominio (sem caminho)');
  if (s.fotosBase != null && !(typeof s.fotosBase === 'string' && /^https?:\/\/\S+\/$/i.test(s.fotosBase))) e('"fotosBase" precisa ser uma URL terminada em "/"');
  if (s.whatsapp != null && !/^\d{10,15}$/.test(String(s.whatsapp))) e('"whatsapp" só com números, com DDI e DDD (ex.: 5541999990000)');
  for (const k of ['filtros', 'ordenacao']) if (s[k] != null && !Array.isArray(s[k])) e(`"${k}" deve ser lista`);
  if (s.paginas != null) e('"paginas" não vai no cadastro: cada página é um arquivo em sites-config/<dominio>/web/ (web/index.json = home, web/paginas/lojas.json...)');
  if (s.estoque != null) e('"estoque" não vai no cadastro: a listagem (/multipla/) é configurada em sites-config/<dominio>/web/multipla.json; pela API, PUT /v1/sites/<dominio>/multipla');
  if (s.rascunho != null && typeof s.rascunho !== 'boolean') e('"rascunho" deve ser true ou false');
  // opções de componente não ficam no cadastro: cada uma é um arquivo em sites-config/<dominio>/componentes/<nome>.json
  if (s.componentes != null) e('"componentes" não vai no cadastro: as opções de cada componente ficam em sites-config/<dominio>/componentes/<nome>.json (ex.: estoque.json); pela API, PUT /v1/sites/<dominio>/componentes/<nome>');
  if (s.robots != null) { const r = require('./robots').validarRobots(s.robots); r.erros.forEach((x) => e(`robots: ${x}`)); }
  if (s.formatoEstoque != null && !['lista', 'compacto'].includes(s.formatoEstoque)) e('"formatoEstoque" (formato do estoque.json gerado) deve ser "lista" (padrão) ou "compacto"');
  // lojas: opcionais num site novo (sem lojas, o site sobe sem estoque); se vierem, cada uma completa
  if (s.lojas != null && (typeof s.lojas !== 'object' || Array.isArray(s.lojas))) e('"lojas" deve ser um objeto: { "matriz": { "nome", "cidade", "uf" } }');
  const lj = s.lojas && typeof s.lojas === 'object' && !Array.isArray(s.lojas) ? s.lojas : {};
  for (const [id, l] of Object.entries(lj)) {
    if (!ID_LOJA.test(id)) e(`loja "${id}": id só com minúsculas, números e hífen`);
    if (!l || !txt(l.nome) || !txt(l.cidade) || !/^[A-Z]{2}$/.test(String(l && l.uf))) e(`loja "${id}": precisa de "nome", "cidade" e "uf" (2 letras maiúsculas)`);
  }
  // trocar de tema: as seções das páginas do site (sites-config/<dominio>/web/) precisam existir no tema novo
  if (txt(s.tema) && ID_SITE.test(String(dominio))) {
    let pags = [];
    try { pags = require('./paginas-livres').paginasJsonDoSite(C, dominio); } catch (x) { e(x.message); }
    if (fs.existsSync(C.multipla(dominio))) pags.push({ caminho: 'multipla', arquivo: C.multipla(dominio), multipla: true });
    for (const p of pags) {
      const j = lerJSON(p.arquivo, {});
      for (const b of p.multipla ? [...(j.secoesAntes || []), ...(j.secoesDepois || [])] : Array.isArray(j.secoes) ? j.secoes : []) {
        if (!b || !/^[a-z0-9-]+$/.test(String(b.tipo)) || !fs.existsSync(path.join(Inq.dirTema(inq, s.tema), C.TEMA.secoes, `${b.tipo}.html`))) e(`página "${p.caminho || '(home)'}": seção "${b && b.tipo}" não existe no tema "${s.tema}"`);
      }
    }
  }
  // o estoque que já está no ar precisa continuar válido com as lojas novas
  if (ID_SITE.test(String(dominio))) {
    const ids = Object.keys(lj);
    const ruins = (estoque(dominio).carros || []).filter((c) => (c.loja != null ? !ids.includes(c.loja) : ids.length !== 1));
    if (ruins.length) e(`${ruins.length} carro(s) do estoque atual ficariam sem loja (ex.: ${ruins[0].id} → "${ruins[0].loja ?? '(sem loja)'}"); mande o estoque novo junto ou mantenha a loja`);
  }
  return erros;
}

// cadastro de um site novo: site-modelo.json do inquilino (o "padrão da casa"; sem ele, config/site-modelo.json) + o que veio na chamada.
// Só com o domínio já dá um site válido: nome = domínio, url = https://<domínio>, motor = a última versão congelada.
// Endereço de rascunho (siteN.carro57.com.br) é sempre rascunho, mesmo que venha "rascunho": false.
function cadastroNovo(dominio, parcial = {}, inquilino = Inq.PADRAO) {
  const modelo = Inq.lerConfig(inquilino, 'site-modelo.json', {});
  const limpo = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))); // "_comentario" no modelo
  return { ...limpo(modelo), ...parcial, ...(inquilino !== Inq.PADRAO ? { inquilino } : {}), ...(ehDominioRascunho(dominio) ? { rascunho: true } : {}), nome: parcial.nome || dominio, url: parcial.url || `https://${dominio}`, motor: parcial.motor || modelo.motor || ultimaVersao(), tema: parcial.tema || modelo.tema || 'barra-topo' };
}

// JSON Merge Patch (RFC 7396): objeto mescla campo a campo, null apaga o campo, o resto (texto, número, lista) substitui
function mesclar(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const r = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete r[k]; else r[k] = mesclar(r[k], v); }
  return r;
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

// ---------- componentes do site: sites-config/<dominio>/componentes/<nome>.json = opções do componente no site inteiro ----------
// (vale para todas as páginas do site; o que a página passar no bloco ainda vale mais)
function componentesDoSite(d) {
  const dir = C.componentesSite(d);
  if (!fs.existsSync(dir)) return {};
  const r = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const nome = f.slice(0, -5);
    try { r[nome] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { throw new Error(`sites-config/${d}/componentes/${f}: JSON inválido (${e.message})`); }
  }
  return r;
}
function gravarComponenteSite(d, nome, opcoes) { gravarJSON(path.join(C.componentesSite(d), `${nome}.json`), opcoes); }
function removerComponenteSite(d, nome) {
  const arq = path.join(C.componentesSite(d), `${nome}.json`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(nome)) || !fs.existsSync(arq)) return false;
  fs.rmSync(arq);
  return true;
}

// estrutura de um site novo: sites-config/<dominio>/{site.json, estoque.json vazio, assets/, web/paginas/, componentes/}
function criarArquivos(dominio, cadastro) {
  if (existe(dominio)) throw new Error(`site "${dominio}" já existe`);
  fs.mkdirSync(C.assets(dominio), { recursive: true });
  fs.mkdirSync(C.paginasLivresSite(dominio), { recursive: true });
  fs.mkdirSync(C.componentesSite(dominio), { recursive: true });
  gravarSite(dominio, cadastro);
  registrarRascunho(dominio);
  if (!fs.existsSync(C.estoque(dominio))) gravarJSON(C.estoque(dominio), { carros: [] }, false);
}

// troca o domínio de um site em TUDO que é dele: pasta do site, saída gerada, estado do build (links, vendidos,
// redirecionamentos: o SEO das páginas de carro vai junto), fotos, cópias de segurança, pendências de publicação,
// config/fontes.json e as menções ao domínio no site.json (url, e-mails, links). Devolve desfazer() para voltar
// tudo como estava se um passo seguinte (o build) falhar.
function renomearArquivos(antigo, novo, { pasta = C.PUBLICO } = {}) {
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
    const Pendentes = require('./pendentes');
    const pendAntes = Pendentes.mover(pasta, antigo, novo);
    feitos.push(() => { Pendentes.remover(pasta, novo); if (pendAntes) Pendentes.registrar(pasta, antigo, pendAntes, pendAntes.completo); });
    reescrever(C.config('fontes.json'), (t) => { const f = JSON.parse(t); if (!(antigo in f)) return t; f[novo] = f[antigo]; delete f[antigo]; return JSON.stringify(f, null, 2) + '\n'; });
  } catch (e) { desfazer(); throw e; }
  return { trocas, desfazer };
}

// tira o site da plataforma SEM destruir: cadastro, estoque e estado vão para .estado/removidos/<dominio>-<data>/
// (dá para recuperar). Só a saída gerada (sites-public/<dominio>) é apagada. Pendências de publicação e fontes.json saem.
function arquivarArquivos(dominio, { pasta = C.PUBLICO } = {}) {
  if (!existe(dominio)) throw new Error(`site "${dominio}" não existe`);
  const destino = path.join(C.ESTADO, 'removidos', `${dominio}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const mover = (de, para) => { if (!fs.existsSync(de)) return; fs.mkdirSync(path.dirname(para), { recursive: true }); fs.renameSync(de, para); };
  mover(C.site(dominio), path.join(destino, 'site'));
  mover(path.join(C.ESTADO, pasta, `${dominio}.json`), path.join(destino, 'estado-build.json'));
  mover(C.fotosEstado(dominio), path.join(destino, 'fotos.json'));
  for (const d of ['estoques-anteriores', 'sites-anteriores']) mover(path.join(C.ESTADO, d, `${dominio}.json`), path.join(destino, `${d}.json`));
  fs.rmSync(path.join(C.saida(pasta), dominio), { recursive: true, force: true });
  require('./pendentes').remover(pasta, dominio);
  const fontes = lerJSON(C.config('fontes.json'), null);
  if (fontes && dominio in fontes) { delete fontes[dominio]; gravarJSON(C.config('fontes.json'), fontes); }
  return { arquivo: path.relative(C.ROOT, destino) };
}

module.exports = { validarMultipla, componentesDoSite, gravarComponenteSite, removerComponenteSite, avisosSite, validarPagina, CAMPOS_SITE, mesclar, arquivarArquivos, proximoRascunho, ehDominioRascunho, inquilinoDoRascunho, padraoRascunho, ID_SITE, listar, existe, carregar, carregarTodos, lojas, estoque, resumo, resumos, validarSite, cadastroNovo, gravarSite, criarArquivos, renomearArquivos };
