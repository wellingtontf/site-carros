#!/usr/bin/env node
// Gera os sites. Cada site = sites/<dominio>/ (site.json + estoque.json + assets/) + um template + uma versão do motor.
// É INCREMENTAL: guarda o que gerou em .estado/ e, na próxima vez, só reescreve o que mudou.
//   node core/build.js                                          todos os sites, com o motor que cada um usa (dist/)
//   node core/build.js --sites trokey.com.br,outro.com.br        só esses sites
//   node core/build.js --sites trokey.com.br --motor rascunho    testa o motor em rascunho num site (vai para dist-preview/)
//   --completo                                                  ignora o que já foi gerado e refaz tudo
//   --saida <pasta>                                             muda a pasta de saída
// Entradas:  sites/<dominio>/  templates/<nome>/  core/motor/<versao>/engine.js  core/ui/
// Saídas:    <saida>/<dominio>/...   e   .estado/<saida>/pendente.json (o que mudou e ainda não foi publicado)
//
// O que vai para cada site gerado:
//   motor/engine.js + motor/ui-*.js      ← core (motor da versão do site + ui)
//   css/ js/ img/ ...                    ← templates/<nome>/ (tudo menos paginas/ e template.json)
//   assets/                              ← sites/<dominio>/assets/
//   index.html                           ← a HOME institucional: página "" de "paginas" no site.json (sem ela, o core gera uma padrão)
//   multipla/index.html                  ← templates/<nome>/paginas/index.html (a listagem do estoque; sempre em /multipla)
//   carros/<Marca>/<Modelo>/<Versao>/<...>-<id>.html ← templates/<nome>/paginas/carro.html (e vendido.html); regra em core/ui/link-carro.js
//   <caminho>/index.html                 ← templates/<nome>/paginas/pagina.html + blocos/<tipo>.html ("paginas" no site.json)
//   carros.json, config.json, sitemap.xml, robots.txt
//
// Páginas de conteúdo (home institucional, "quero vender", política...) são listas de BLOCOS no site.json:
//   "paginas": [ { "caminho": "", "titulo": "...", "blocos": [ { "tipo": "banner", "imagem": "assets/x.webp" }, ... ] } ]
// Cada tipo de bloco é um HTML do template (templates/<nome>/blocos/<tipo>.html). Campos de link/imagem com caminho
// relativo (link, imagem, foto, logo...) recebem o prefixo certo para a página onde aparecem.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./caminhos');
const LinkCarro = require('./ui/link-carro.js'); // regra do link da página do carro (a mesma usada no navegador)

const ROOT = C.ROOT;
const ESTADO = C.ESTADO;
const CAMPOS_FILTRO = ['estado', 'cidade', 'loja', 'marca', 'modelo', 'carroceria', 'ano', 'preco', 'km', 'cambio', 'combustivel', 'cor'];
const TEXTOS_PADRAO = { botaoWhatsapp: 'Tenho interesse (WhatsApp)', busca: 'Buscar: marca, modelo, cidade, cor...', voltar: 'Voltar ao estoque', rodape: '' };
const TEMA_PADRAO = { cor: '#0b5fff', fundo: '#f5f6f8', texto: '#1b2430', raio: 12, colunas: 250, fonte: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' };
const ID_SITE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/; // o id do site é o domínio (nome da pasta)
const PAGINAS = ['index.html', 'carro.html', 'vendido.html', 'pagina.html'];
const CAMINHO_ESTOQUE = 'multipla'; // a listagem do estoque fica SEMPRE em /multipla; a raiz é a home institucional
// home de quem não configurou uma (o template precisa ter os blocos "banner" e "vitrine")
const HOME_PADRAO = (site) => [
  { tipo: 'banner', titulo: site.nome, subtitulo: site.slogan || '' },
  { tipo: 'vitrine', titulo: 'Destaques', quantidade: 8, botao: 'Ver estoque completo' },
];
const RESERVADOS = new Set(['carro', LinkCarro.PASTA, CAMINHO_ESTOQUE, 'motor', 'css', 'js', 'img', 'assets', 'carros.json', 'config.json', 'sitemap.xml', 'robots.txt']);
const CAMINHO_OK = /^([a-z0-9][a-z0-9-]*)(\/[a-z0-9][a-z0-9-]*)*$/;
const CHAVES_LINK = new Set(['link', 'imagem', 'foto', 'logo', 'logoRodape', 'banner', 'favicon']);
const RETENCAO_PADRAO_DIAS = 30; // quanto tempo a página de um carro que saiu continua mostrando "indisponível"
const REDIRECIONAMENTO_PADRAO_DIAS = 180; // quanto tempo um link antigo de carro (que mudou de endereço) continua redirecionando

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const RENDER_VERSION = sha(fs.readFileSync(__filename)); // mudou este arquivo → refaz todas as páginas (por segurança)

const lerJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lerJSONSeExiste = (p, padrao) => { try { return lerJSON(p); } catch (e) { return padrao; } };
// sites/<dominio>/site.json → o id é sempre o nome da pasta
const idsSites = () => (fs.existsSync(C.SITES) ? fs.readdirSync(C.SITES, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(C.siteJson(e.name))).map((e) => e.name).sort() : []);
const carregarSite = (id) => ({ ...lerJSON(C.siteJson(id)), id });
const listarSites = () => idsSites().map(carregarSite);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const foto = (base, id, n, w) => `${base}carros/${id}/${n}-${w}.webp`;
const ph = (t) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e8ecf1"/><text x="200" y="158" font-family="sans-serif" font-size="20" fill="#7b8794" text-anchor="middle">${esc(t)}</text></svg>`
  );

// ---------- mini motor de templates: {{x}} {{{x}}} {{#x}}..{{/x}} {{^x}}..{{/x}} ----------
// {{x}} escapa HTML; {{{x}}} insere sem escapar (só para HTML que o build gera); {{#x}} repete listas ou mostra se tiver valor.
const escT = (s) => esc(s).replace(/\{/g, '&#123;'); // nada vindo dos dados vira marcador
const get = (ctx, nome) => (nome === '.' ? ctx['.'] : nome.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx));
function render(tpl, ctx) {
  return tpl
    .replace(/\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g, (_, tipo, nome, corpo) => {
      const v = get(ctx, nome);
      const vazio = !v || (Array.isArray(v) && !v.length);
      if (tipo === '^') return vazio ? render(corpo, ctx) : '';
      if (vazio) return '';
      if (Array.isArray(v)) return v.map((item) => render(corpo, { ...ctx, '.': item, ...(item && typeof item === 'object' ? item : {}) })).join('');
      return render(corpo, typeof v === 'object' ? { ...ctx, ...v } : ctx);
    })
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, n) => String(get(ctx, n) ?? ''))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, n) => escT(get(ctx, n) ?? ''));
}

// ---------- arquivos: só escreve quando o conteúdo mudou ----------
function escreverSe(arquivo, conteudo, rel, mud) {
  if (fs.existsSync(arquivo) && fs.readFileSync(arquivo, 'utf8') === conteudo) return false;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
  mud.escritos.push(rel);
  return true;
}
function copiarSe(origem, destino, rel, mud) {
  const novo = fs.readFileSync(origem);
  if (fs.existsSync(destino) && fs.readFileSync(destino).equals(novo)) return;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, novo);
  mud.escritos.push(rel);
}
// lista os arquivos de uma pasta (caminho relativo → absoluto); "pular" recebe o caminho relativo
function listarArvore(dir, pular = () => false, prefixo = '') {
  const m = new Map();
  if (!fs.existsSync(dir)) return m;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefixo + e.name;
    if (pular(rel)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) for (const [k, v] of listarArvore(abs, pular, `${rel}/`)) m.set(k, v);
    else m.set(rel, abs);
  }
  return m;
}
function hashDir(dir) {
  const h = crypto.createHash('sha1');
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p); else { h.update(path.relative(ROOT, p)); h.update(fs.readFileSync(p)); }
    }
  };
  andar(dir);
  return h.digest('hex');
}

// ---------- estado (o que já foi gerado) e pendências (o que mudou e falta publicar) ----------
const arqEstado = (pasta, id) => path.join(ESTADO, pasta, `${id}.json`);
const lerEstado = (pasta, id) => lerJSONSeExiste(arqEstado(pasta, id), null);
function gravarEstado(pasta, id, obj) {
  fs.mkdirSync(path.join(ESTADO, pasta), { recursive: true });
  fs.writeFileSync(arqEstado(pasta, id), JSON.stringify(obj));
}
function registrarPendente(pasta, id, mud, completo) {
  const arq = path.join(ESTADO, pasta, 'pendente.json');
  const p = lerJSONSeExiste(arq, {});
  const s = p[id] || { escritos: [], removidos: [], completo: false };
  s.completo = s.completo || completo;
  s.removidos = [...new Set([...s.removidos, ...mud.removidos])];
  s.escritos = s.completo ? [] : [...new Set([...s.escritos, ...mud.escritos])].filter((x) => !s.removidos.includes(x));
  if (s.completo || s.escritos.length || s.removidos.length) p[id] = s;
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(p));
}

const limpaCss = (v) => String(v).replace(/[<>{};]/g, '');
function temaDoSite(site) {
  const t = { ...TEMA_PADRAO, ...(site.cor ? { cor: site.cor } : {}), ...(site.tema || {}) };
  if (t.fonteGoogle) t.fonte = `"${t.fonteGoogle}",${TEMA_PADRAO.fonte}`;
  return t;
}
const temaCss = (t) => `:root{--cor:${limpaCss(t.cor)};--fundo:${limpaCss(t.fundo)};--texto:${limpaCss(t.texto)};--raio:${Number(t.raio)}px;--colunas:${Number(t.colunas)}px;--fonte:${limpaCss(t.fonte)}}`;
// imagens do tema (logo, banner...): caminho relativo aponta para os arquivos do site (ex.: "assets/logo.png")
// e ganha o prefixo certo para cada página; URL absoluta fica como está
const IMAGEM = /\.(png|jpe?g|webp|avif|gif|svg|ico)$/i;
const temaDaPagina = (t, rel) => Object.fromEntries(Object.entries(t).map(([k, v]) =>
  [k, typeof v === 'string' && IMAGEM.test(v) && !/^([a-z]+:)?\/\//i.test(v) && !v.startsWith('/') ? rel + v : v]));
// links/imagens relativos dentro de cabeçalho, rodapé e blocos ganham o prefixo da página
const relativo = (v) => typeof v === 'string' && v !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(v);
function resolverLinks(o, rel) {
  if (Array.isArray(o)) return o.map((x) => resolverLinks(x, rel));
  if (!o || typeof o !== 'object') return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, CHAVES_LINK.has(k) && relativo(v) ? rel + v : resolverLinks(v, rel)]));
}
const limparCaminho = (c) => String(c ?? '').replace(/^\/+|\/+$/g, '');
const prefixo = (caminho) => (caminho ? '../'.repeat(caminho.split('/').length) : '');
const fonteLink = (t) =>
  t.fonteGoogle ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.fonteGoogle).replace(/%20/g, '+')}:wght@400;600;700&display=swap">` : '';

// restrições do site (o que ele pode vender, independente dos filtros que mostra)
function passa(c, loja, r) {
  if (r.precoMin != null && c.preco < r.precoMin) return false;
  if (r.precoMax != null && c.preco > r.precoMax) return false;
  if (r.anoMin != null && c.ano < r.anoMin) return false;
  if (r.marcas && !r.marcas.includes(c.marca)) return false;
  if (r.estados && !r.estados.includes(loja.uf)) return false;
  if (r.cidades && !r.cidades.includes(loja.cidade)) return false;
  return true;
}

// carros do site: sites/<dominio>/estoque.json; cada carro diz sua loja ("loja": "<id>" de site.lojas).
// Site com uma loja só: o campo "loja" do carro é opcional.
function juntar(site) {
  const lojas = site.lojas || {};
  const ids = Object.keys(lojas);
  if (!ids.length) throw new Error(`Site "${site.id}" sem lojas em sites/${site.id}/site.json`);
  const estoque = lerJSONSeExiste(C.estoque(site.id), null);
  if (!estoque) { console.warn(`  aviso: site "${site.id}" sem sites/${site.id}/estoque.json`); return []; }
  // ordem de exibição: campo "ordem" (menor primeiro); sem ele, a posição no arquivo. Empate: posição no arquivo.
  const lista = (estoque.carros || []).map((c, i) => ({ c, i }))
    .sort((a, b) => (typeof a.c.ordem === 'number' ? a.c.ordem : Infinity) - (typeof b.c.ordem === 'number' ? b.c.ordem : Infinity) || a.i - b.i)
    .map((x) => x.c);
  const carros = [];
  for (const c of lista) {
    const lid = c.loja || (ids.length === 1 ? ids[0] : null);
    const loja = lojas[lid];
    if (!loja) throw new Error(`Site "${site.id}": carro ${c.id} com loja ${lid ? `inexistente "${lid}"` : 'não informada'} (lojas: ${ids.join(', ')})`);
    if (!passa(c, loja, site.restricoes || {})) continue;
    carros.push({ ...c, opcionais: c.opcionais || [], descricao: c.descricao || '', carroceria: c.carroceria || '', destaque: !!c.destaque, lojaId: lid, loja: loja.nome, cidade: loja.cidade, uf: loja.uf });
  }
  return carros;
}

function construir({ sites = null, motor = null, saida = null, completo = false, efemero = false } = {}) {
  const pasta = saida || (motor ? 'dist-preview' : 'dist');
  const DIST = C.saida(pasta);
  const todos = listarSites();
  const alvo = sites
    ? sites.map((id) => todos.find((s) => s.id === id) || (() => { throw new Error(`Site inexistente: "${id}"`); })())
    : todos;
  fs.mkdirSync(DIST, { recursive: true });
  const hashTpl = new Map();
  const tplHash = (nome) => { if (!hashTpl.has(nome)) hashTpl.set(nome, sha(hashDir(C.template(nome)))); return hashTpl.get(nome); };
  const hoje = new Date().toISOString().slice(0, 10);
  const feitos = [];

  for (const site of alvo) {
    if (!ID_SITE.test(String(site.id))) throw new Error(`Pasta de site inválida: "sites/${site.id}" (o nome da pasta é o domínio, ex.: sites/minhaloja.com.br)`);
    const versao = motor || site.motor;
    if (!versao) throw new Error(`Site "${site.id}" sem "motor" (ex.: "motor": "v1") em sites/${site.id}/site.json`);
    const arqMotor = path.join(C.motor(versao), 'engine.js');
    if (!fs.existsSync(arqMotor)) throw new Error(`Site "${site.id}": motor "${versao}" não existe (core/motor/${versao}/engine.js)`);
    const nomeTpl = site.template;
    if (!nomeTpl || !fs.existsSync(C.template(nomeTpl))) throw new Error(`Site "${site.id}": template "${nomeTpl}" não existe (templates/${nomeTpl}/)`);
    const faltam = PAGINAS.filter((p) => !fs.existsSync(C.pagina(nomeTpl, p)));
    if (faltam.length) throw new Error(`Template "${nomeTpl}" incompleto: falta ${faltam.map((p) => `paginas/${p}`).join(', ')}`);

    // páginas de conteúdo; a home ("") é obrigatória: sem ela no site.json, o core usa HOME_PADRAO
    const cfgEstoque = site.estoque || {};
    if (cfgEstoque.caminho != null && limparCaminho(cfgEstoque.caminho) !== CAMINHO_ESTOQUE)
      console.warn(`  aviso: site "${site.id}": "estoque.caminho" foi ignorado (a listagem fica sempre em /${CAMINHO_ESTOQUE}/)`);
    const caminhoEstoque = CAMINHO_ESTOQUE;
    const paginasSite = (site.paginas || []).map((p) => ({ ...p, caminho: limparCaminho(p.caminho) }));
    if (!paginasSite.some((p) => p.caminho === '')) paginasSite.unshift({ caminho: '', titulo: site.nome, descricao: site.slogan || '', blocos: HOME_PADRAO(site) });
    const usados = new Set();
    for (const p of paginasSite) {
      const onde = `Site "${site.id}", página "${p.caminho || '(raiz)'}"`;
      if (p.caminho && !CAMINHO_OK.test(p.caminho)) throw new Error(`${onde}: caminho inválido (use letras minúsculas, números, hífen e /)`);
      if (RESERVADOS.has(p.caminho.split('/')[0])) throw new Error(`${onde}: "${p.caminho.split('/')[0]}" é reservado`);
      if (usados.has(p.caminho)) throw new Error(`${onde}: caminho repetido`);
      usados.add(p.caminho);
      if (!Array.isArray(p.blocos)) throw new Error(`${onde}: falta "blocos" (lista)`);
    }
    for (const f of site.filtros || []) {
      const campo = typeof f === 'string' ? f : f.campo;
      if (!CAMPOS_FILTRO.includes(campo)) console.warn(`  aviso: site "${site.id}" tem filtro desconhecido "${campo}" (use: ${CAMPOS_FILTRO.join(', ')})`);
    }

    const carros = juntar(site);
    const lojas = site.lojas;
    const out = path.join(DIST, site.id);
    const base = site.fotosBase || '';
    const tema = temaDoSite(site);
    const textos = { ...TEXTOS_PADRAO, ...(site.textos || {}) };

    // Só as páginas dependem disto (a versão do motor e os filtros ficam de fora de propósito:
    // trocar o motor ou os filtros não refaz nenhuma página).
    // nomes (não as contagens) de cidades/marcas/carrocerias entram: menus e rodapés podem listá-los em todas as páginas.
    // Contagens ("1052 veículos") mudam a toda hora: use-as só na listagem e nas páginas de conteúdo (sempre refeitas).
    const nomesEstoque = ['cidade', 'marca', 'carroceria', 'combustivel'].map((k) => [...new Set(carros.map((c) => c[k]))].sort().join('|'));
    const baseHash = sha(JSON.stringify([RENDER_VERSION, tplHash(nomeTpl), site.nome, site.slogan, site.url, site.cor, site.tema, site.textos, site.fotosBase, site.cabecalho, site.rodape, site.lojas, nomesEstoque]));
    const estadoAnt = completo || efemero ? null : lerEstado(pasta, site.id);
    const incremental = !!estadoAnt && fs.existsSync(path.join(out, 'index.html'));
    if (!incremental) fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, LinkCarro.PASTA), { recursive: true });
    const baseMudou = !incremental || estadoAnt.base !== baseHash;
    const mud = { escritos: [], removidos: [] };
    const rel = (p) => `${site.id}/${p}`;

    // core → motor/ (engine da versão do site + ui); template → css/ js/ img/...; site → assets/
    escreverSe(path.join(out, 'motor', 'engine.js'), fs.readFileSync(arqMotor, 'utf8').replace(/__VERSAO__/g, versao), rel('motor/engine.js'), mud);
    const arquivos = new Map();
    for (const [k, v] of listarArvore(C.UI)) arquivos.set(`motor/${k}`, v);
    for (const [k, v] of listarArvore(C.template(nomeTpl), (r) => ['paginas', 'blocos', 'parciais', 'template.json', 'motor', 'assets'].includes(r))) arquivos.set(k, v);
    for (const [k, v] of listarArvore(C.assets(site.id))) arquivos.set(`assets/${k}`, v);
    for (const [k, v] of arquivos) copiarSe(v, path.join(out, k), rel(k), mud);
    // {{> nome}} inclui templates/<nome>/parciais/<nome>.html (cabeçalho, rodapé... escritos uma vez só)
    const parciais = (txt, nivel = 0) => txt.replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/g, (_, n) => {
      const arq = path.join(C.template(nomeTpl), 'parciais', `${n}.html`);
      if (!fs.existsSync(arq)) throw new Error(`Template "${nomeTpl}": parcial "${n}" não existe (templates/${nomeTpl}/parciais/${n}.html)`);
      if (nivel > 5) throw new Error(`Template "${nomeTpl}": parciais aninhadas demais (${n})`);
      return parciais(fs.readFileSync(arq, 'utf8'), nivel + 1);
    });
    const pagina = (arquivo) => parciais(fs.readFileSync(C.pagina(nomeTpl, arquivo), 'utf8'));

    // dados que o motor lê
    escreverSe(
      path.join(out, 'carros.json'),
      // r = posição na ordem de exibição (ordenação "destaque" do motor); cr = carroceria
      JSON.stringify(carros.map((c, r) => ({ i: c.id, m: c.marca, o: c.modelo, v: c.versao, a: c.ano, p: c.preco, k: c.km, c: c.cor, b: c.cambio, f: c.combustivel, n: c.fotos, u: c.loja, cd: c.cidade, uf: c.uf, r, ...(c.carroceria ? { cr: c.carroceria } : {}) }))),
      rel('carros.json'), mud
    );
    const usadas = [...new Set(carros.map((c) => c.lojaId))].sort();
    escreverSe(
      path.join(out, 'config.json'),
      JSON.stringify({
        nome: site.nome, motor: versao, template: nomeTpl, whatsapp: site.whatsapp, vendedores: site.vendedores || {},
        busca: site.busca !== false, filtros: site.filtros || null, ordenacao: site.ordenacao || null, total: carros.length,
        lojas: Object.fromEntries(usadas.map((id) => [id, { nome: lojas[id].nome, cidade: lojas[id].cidade, uf: lojas[id].uf, endereco: lojas[id].endereco || '', whatsapp: lojas[id].whatsapp || '' }])),
      }),
      rel('config.json'), mud
    );

    // números e listas do estoque que qualquer página/bloco pode usar (menu de cidades, marcas no rodapé, "1052 veículos"...)
    const contar = (k) => { const m = new Map(); for (const c of carros) if (c[k]) m.set(c[k], (m.get(c[k]) || 0) + 1); return [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR')); };
    const estoqueInfo = (r) => {
      const url = r + `${CAMINHO_ESTOQUE}/`;
      const q = (k, v) => `${url}?${k}=${encodeURIComponent(v)}`;
      return {
        total: carros.length, destaques: carros.filter((c) => c.destaque).length,
        // chave = valor sem acento/espaço, em minúsculas (para classes CSS: ic-utilitario, ic-suv...)
        ...Object.fromEntries([['marcas', 'marca'], ['cidades', 'cidade'], ['carrocerias', 'carroceria'], ['combustiveis', 'combustivel']].map(([nome, k]) =>
          [nome, contar(k).map(([v, n]) => ({ valor: v, total: n, link: q(k, v), chave: LinkCarro.parte(v).toLowerCase() }))])),
        lojas: Object.entries(lojas).map(([id, l]) => ({ id, ...l, total: carros.filter((c) => c.lojaId === id).length, link: q('loja', l.nome) })),
      };
    };
    const ctxSite = { tema, base, temaCss: temaCss(tema), fonteLink: fonteLink(tema), motor: versao };
    // contexto de cada página: r = prefixo até a raiz do site ("", "../", "../../")
    const ctx = (r) => ({
      ...ctxSite, rel: r, tema: temaDaPagina(tema, r),
      site: { nome: site.nome, slogan: site.slogan || '', url: site.url || '', textos,
        cabecalho: resolverLinks(site.cabecalho || {}, r), rodape: resolverLinks(site.rodape || {}, r) },
      inicioUrl: r || './', estoqueUrl: r + `${CAMINHO_ESTOQUE}/`, estoque: estoqueInfo(r),
    });

    // ---- blocos (templates/<nome>/blocos/<tipo>.html) ----
    const tplBlocos = new Map();
    const tplBloco = (tipo) => {
      if (!tplBlocos.has(tipo)) {
        const arq = path.join(C.template(nomeTpl), 'blocos', `${tipo}.html`);
        if (!/^[a-z0-9-]+$/.test(String(tipo)) || !fs.existsSync(arq)) throw new Error(`Site "${site.id}": bloco "${tipo}" não existe no template "${nomeTpl}" (templates/${nomeTpl}/blocos/${tipo}.html)`);
        tplBlocos.set(tipo, parciais(fs.readFileSync(arq, 'utf8')));
      }
      return tplBlocos.get(tipo);
    };
    const marcas = [...new Set(carros.map((c) => c.marca))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((m) => ({ valor: m }));
    // opções de preço/ano para formulários de busca: as mesmas configuradas nos filtros do site (precisam bater com o motor)
    const opcoesFiltro = (campo, fmt) => {
      const f = (site.filtros || []).find((x) => typeof x === 'object' && x.campo === campo && Array.isArray(x.opcoes));
      return f ? f.opcoes.map((v) => ({ valor: v, rotulo: fmt(v) })) : [];
    };
    // dados que o build acrescenta a alguns tipos de bloco
    const enriquecer = (b, r) => {
      const d = { ...b };
      // vitrine = cards fixos; listagem = o estoque interativo (motor) dentro da página, já com os primeiros cards no HTML
      if (b.tipo === 'vitrine' || b.tipo === 'listagem') {
        // na ordem do estoque (campo "ordem"); "somenteDestaques": só os carros com "destaque": true
        const base_ = b.somenteDestaques ? carros.filter((c) => c.destaque) : carros;
        d.quantidade = b.quantidade || (b.tipo === 'listagem' ? 24 : 4);
        d.carros = base_.slice(0, d.quantidade).map((c) => {
          const nome = `${c.marca} ${c.modelo}`;
          const titulo = `${nome} ${c.versao} ${c.ano}`;
          return {
            id: c.id, lojaId: c.lojaId, nome, versao: c.versao, ano: c.ano, km: `${c.km.toLocaleString('pt-BR')} km`, preco: brl(c.preco),
            cambio: c.cambio, combustivel: c.combustivel, carroceria: c.carroceria, local: `${c.cidade}/${c.uf}`, loja: c.loja,
            href: r + LinkCarro.caminho(c),
            zap: `Olá! Tenho interesse no ${titulo} (ref. ${c.id}). Ainda está disponível?`,
            imgAttrs: base && c.fotos ? `src="${esc(foto(base, c.id, 1, 400))}" data-fb="${esc(nome)}"` : `src="${ph(nome)}"`,
          };
        });
      }
      if (b.tipo === 'busca') {
        d.marcas = estoqueInfo(r).marcas;
        d.modelos = contar('modelo').map(([v]) => ({ valor: v, marca: (carros.find((c) => c.modelo === v) || {}).marca }));
        d.opcoesPreco = opcoesFiltro('preco', (v) => `até ${brl(v)}`);
        d.opcoesAno = opcoesFiltro('ano', (v) => `a partir de ${v}`);
      }
      if (b.tipo === 'lojas' && !b.itens) d.itens = estoqueInfo(r).lojas;
      if (Array.isArray(b.itens)) d.itens = b.itens.map((i) => (i && i.nota ? { ...i, estrelas: '★'.repeat(Math.min(5, i.nota)) } : i));
      if (Array.isArray(b.campos)) {
        d.campos = b.campos.map((c, i) => ({
          ...c, id: `campo-${i + 1}`, nome: c.rotulo || `campo ${i + 1}`,
          ehLista: c.tipo === 'lista', ehTextoLongo: c.tipo === 'texto-longo', ehLinha: c.tipo !== 'lista' && c.tipo !== 'texto-longo',
          tipoHtml: { email: 'email', telefone: 'tel', numero: 'number' }[c.tipo] || 'text',
        }));
      }
      return d;
    };
    const renderBlocos = (lista, r) => (lista || []).map((b) => {
      const d = resolverLinks(enriquecer(b, r), r);
      return render(tplBloco(b.tipo), { ...ctx(r), ...d, bloco: d });
    }).join('\n');

    // listagem (estoque)
    const geradas = []; // páginas de listagem e de conteúdo (para apagar as que deixarem de existir)
    {
      const r = prefixo(caminhoEstoque);
      const arqRel = caminhoEstoque ? `${caminhoEstoque}/index.html` : 'index.html';
      geradas.push(arqRel);
      escreverSe(path.join(out, arqRel), render(pagina('index.html'), {
        ...ctx(r), blocosAntes: renderBlocos(cfgEstoque.blocosAntes, r), blocosDepois: renderBlocos(cfgEstoque.blocosDepois, r),
      }), rel(arqRel), mud);
    }
    // páginas de conteúdo
    const tplPagina = pagina('pagina.html');
    for (const p of paginasSite) {
      const r = prefixo(p.caminho);
      const arqRel = p.caminho ? `${p.caminho}/index.html` : 'index.html';
      geradas.push(arqRel);
      const canon = site.url ? `<link rel="canonical" href="${esc(site.url.replace(/\/$/, ''))}/${p.caminho ? esc(p.caminho) + '/' : ''}">` : '';
      const listagens = p.blocos.filter((b) => b.tipo === 'listagem').length;
      if (listagens > 1) throw new Error(`Site "${site.id}", página "${p.caminho || '(raiz)'}": só pode ter um bloco "listagem"`);
      escreverSe(path.join(out, arqRel), render(tplPagina, {
        ...ctx(r), pagina: { titulo: p.titulo || site.nome, descricao: p.descricao || site.slogan || '' }, canon, conteudo: renderBlocos(p.blocos, r),
        temListagem: listagens > 0, // a página carrega o motor + ui-lista (ids da listagem: ver README)
      }), rel(arqRel), mud);
    }
    // página que saiu do site.json (ou listagem que mudou de lugar): apaga
    for (const arqRel of (incremental && estadoAnt.paginas) || []) {
      if (geradas.includes(arqRel)) continue;
      fs.rmSync(path.join(out, arqRel), { force: true });
      mud.removidos.push(rel(arqRel));
      try { if (path.dirname(arqRel) !== '.') fs.rmdirSync(path.join(out, path.dirname(arqRel))); } catch (e) { /* pasta com outros arquivos: fica */ }
    }

    // páginas dos carros: só refaz as que mudaram
    // links[id] = caminho da página (core/ui/link-carro.js). Estado antigo sem "links" = formato antigo carro/<id>/index.html
    const linkAntigo = (id) => (incremental && estadoAnt.links && estadoAnt.links[id]) || `carro/${id}/index.html`;
    const relDe = (arqRel) => prefixo(path.posix.dirname(arqRel) === '.' ? '' : path.posix.dirname(arqRel));
    const raizUrl = site.url ? site.url.replace(/\/$/, '') : '';
    // apaga um arquivo gerado e as pastas que ficarem vazias (carros/<Marca>/<Modelo>/...)
    const remover = (arqRel) => {
      fs.rmSync(path.join(out, arqRel), { force: true });
      mud.removidos.push(rel(arqRel));
      for (let d = path.dirname(path.join(out, arqRel)); d.startsWith(out + path.sep); d = path.dirname(d)) {
        try { fs.rmdirSync(d); } catch (e) { break; } // só apaga se estiver vazia
      }
    };
    const tplCarro = pagina('carro.html');
    const hashes = {};
    const titulos = {};
    const links = {};
    let novos = 0, alterados = 0, inalterados = 0;
    for (const c of carros) {
      const titulo = `${c.marca} ${c.modelo} ${c.versao} ${c.ano}`;
      titulos[c.id] = titulo;
      const link = LinkCarro.caminho(c);
      links[c.id] = link;
      const h = sha(baseHash + JSON.stringify(c) + (lojas[c.lojaId].endereco || ''));
      hashes[c.id] = h;
      const antes = incremental ? estadoAnt.carros[c.id] : undefined;
      const arq = path.join(out, link);
      if (!baseMudou && antes === h && fs.existsSync(arq)) { inalterados++; continue; }
      if (incremental) { if (antes === undefined) novos++; else alterados++; }
      const canon = raizUrl ? `<link rel="canonical" href="${esc(raizUrl)}/${esc(link)}"><meta property="og:url" content="${esc(raizUrl)}/${esc(link)}">` : '';
      const og =
        `<meta property="og:title" content="${esc(titulo)} - ${esc(brl(c.preco))}">` +
        `<meta property="og:description" content="${esc(c.km.toLocaleString('pt-BR'))} km · ${esc(c.cambio)} · ${esc(c.cidade)}/${esc(c.uf)}">` +
        (base ? `<meta property="og:image" content="${esc(foto(base, c.id, 1, 800))}">` : '') + canon +
        `<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org', '@type': 'Car', name: titulo, brand: { '@type': 'Brand', name: c.marca }, model: c.modelo,
          vehicleModelDate: String(c.ano), mileageFromOdometer: { '@type': 'QuantitativeValue', value: c.km, unitCode: 'KMT' },
          color: c.cor, vehicleTransmission: c.cambio, fuelType: c.combustivel, itemCondition: 'https://schema.org/UsedCondition',
          ...(raizUrl ? { url: `${raizUrl}/${link}` } : {}),
          ...(base ? { image: Array.from({ length: Math.min(c.fotos, 5) }, (_, k) => foto(base, c.id, k + 1, 800)) } : {}),
          offers: { '@type': 'Offer', price: c.preco, priceCurrency: 'BRL', availability: 'https://schema.org/InStock', seller: { '@type': 'AutoDealer', name: c.loja } },
        }).replace(/</g, '\\u003c')}</script>`;
      const principalAttrs = base
        ? `data-fb="${esc(titulo)}" src="${esc(foto(base, c.id, 1, 800))}" srcset="${esc(foto(base, c.id, 1, 800))} 800w, ${esc(foto(base, c.id, 1, 1600))} 1600w" sizes="(max-width:800px) 100vw, 800px"`
        : `src="${ph(titulo)}"`;
      const fotos = Array.from({ length: c.fotos }, (_, k) => k + 1).map((n) => ({
        n, imgAttrs: base ? `data-fb="foto ${n}" src="${esc(foto(base, c.id, n, 400))}"` : `src="${ph('foto ' + n)}"`,
      }));
      const carro = {
        id: c.id, lojaId: c.lojaId, titulo, precoFmt: brl(c.preco), descricao: c.descricao,
        descricaoCurta: `${titulo}, ${c.km.toLocaleString('pt-BR')} km. ${brl(c.preco)}`,
        specs: [
          { rotulo: 'Ano', valor: c.ano }, { rotulo: 'Km', valor: c.km.toLocaleString('pt-BR') }, { rotulo: 'Câmbio', valor: c.cambio },
          { rotulo: 'Combustível', valor: c.combustivel }, { rotulo: 'Cor', valor: c.cor }, { rotulo: 'Loja', valor: c.loja },
          { rotulo: 'Local', valor: `${c.cidade}/${c.uf}` }, { rotulo: 'Ref.', valor: c.id },
        ],
        opcionais: c.opcionais, endereco: lojas[c.lojaId].endereco || '', principalAttrs, fotos,
      };
      escreverSe(arq, render(tplCarro, { ...ctx(relDe(link)), carro, og }), rel(link), mud);
    }

    // sitemap e robots: é por aqui que o Google descobre as páginas dos carros (a listagem é montada por JS)
    if (raizUrl) {
      const urls = [...geradas.map((g) => `${raizUrl}/${g.replace(/index\.html$/, '')}`), ...carros.map((c) => `${raizUrl}/${links[c.id]}`)];
      escreverSe(path.join(out, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`, rel('sitemap.xml'), mud);
      escreverSe(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${raizUrl}/sitemap.xml\n`, rel('robots.txt'), mud);
    }

    // carros que saíram: a página vira "indisponível" (o link compartilhado no WhatsApp não pode dar erro)
    // vendidos[id] = { data, link } (estado antigo guardava só a data)
    const vendidos = {};
    if (incremental) for (const [id, v] of Object.entries(estadoAnt.vendidos || {})) vendidos[id] = typeof v === 'string' ? { data: v, link: linkAntigo(id) } : v;
    const titulosAnt = incremental ? estadoAnt.titulos || {} : {};
    const emUso = new Set(Object.values(links));
    const voltaram = [];
    let saiu = 0;
    if (incremental) for (const id of Object.keys(estadoAnt.carros)) if (!(id in hashes)) { vendidos[id] = vendidos[id] || { data: hoje, link: linkAntigo(id) }; saiu++; }
    for (const id of Object.keys(hashes)) {
      if (vendidos[id] && vendidos[id].link !== links[id] && !emUso.has(vendidos[id].link)) voltaram.push({ velho: vendidos[id].link, id }); // voltou com outro link: o anterior redireciona
      delete vendidos[id]; // carro que voltou
    }
    const retencao = site.retencaoVendidosDias ?? RETENCAO_PADRAO_DIAS;
    const tplVendido = pagina('vendido.html');
    for (const [id, v] of Object.entries(vendidos)) {
      if ((Date.parse(hoje) - Date.parse(v.data)) / 86400000 > retencao) { remover(v.link); delete vendidos[id]; continue; }
      titulos[id] = titulosAnt[id] || id;
      escreverSe(path.join(out, v.link), render(tplVendido, { ...ctx(relDe(v.link)), carro: { id, titulo: titulos[id] } }), rel(v.link), mud);
    }

    // carro que MUDOU de link (mudou marca/modelo/versão/cidade, ou o formato do link): o endereço antigo redireciona
    // para o novo por um tempo, para não quebrar link já compartilhado nem perder o Google
    const redirecionados = incremental ? { ...(estadoAnt.redirecionados || {}) } : {};
    if (incremental) for (const id of Object.keys(estadoAnt.carros)) {
      const velho = linkAntigo(id);
      if (links[id] && velho !== links[id] && !redirecionados[velho]) redirecionados[velho] = { id, desde: hoje };
    }
    for (const { velho, id } of voltaram) redirecionados[velho] = redirecionados[velho] || { id, desde: hoje };
    const diasRedir = site.retencaoRedirecionamentoDias ?? REDIRECIONAMENTO_PADRAO_DIAS;
    let redir = 0;
    for (const [velho, r] of Object.entries(redirecionados)) {
      if (emUso.has(velho)) { delete redirecionados[velho]; continue; } // o endereço voltou a ser de um carro
      const destino = links[r.id] || (vendidos[r.id] && vendidos[r.id].link); // vendido: aponta para a página "indisponível"
      if (!destino || (Date.parse(hoje) - Date.parse(r.desde)) / 86400000 > diasRedir) { remover(velho); delete redirecionados[velho]; continue; }
      const para = relDe(velho) + destino;
      const abs = raizUrl ? `${raizUrl}/${destino}` : para;
      escreverSe(path.join(out, velho),
        `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${esc(abs)}">` +
        `<meta http-equiv="refresh" content="0; url=${esc(para)}"><title>Redirecionando...</title>` +
        `<script>location.replace(${JSON.stringify(para)} + location.search + location.hash)</script>` +
        `<p>Este anúncio mudou de endereço: <a href="${esc(para)}">clique aqui</a>.</p>`, rel(velho), mud);
      redir++;
    }

    if (!efemero) {
      gravarEstado(pasta, site.id, { render: RENDER_VERSION, base: baseHash, carros: hashes, links, titulos, vendidos, redirecionados, paginas: geradas, em: new Date().toISOString() });
      registrarPendente(pasta, site.id, mud, !incremental);
    }

    const resumo = { novos, alterados, saiu, inalterados, escritos: mud.escritos.length, removidos: mud.removidos.length, completo: !incremental, base: incremental && baseMudou };
    const kb = (fs.statSync(path.join(out, 'carros.json')).size / 1024).toFixed(0);
    const detalhe = !incremental ? 'gerado do zero'
      : resumo.base ? `visual/config mudou: ${carros.length} páginas refeitas`
      : mud.escritos.length || mud.removidos.length ? `+${novos} novos ~${alterados} alterados -${saiu} saíram${redir ? ` · ${redir} link(s) antigo(s) redirecionando` : ''} · ${mud.escritos.length} arquivo(s) escrito(s)`
      : 'sem mudanças';
    console.log(`${site.id}: ${carros.length} carros · ${detalhe} · template ${nomeTpl} · motor ${versao} · carros.json ${kb} KB`);
    feitos.push({ site, total: carros.length, motor: versao, template: nomeTpl, resumo });
  }

  // índice só para navegar entre os sites durante o desenvolvimento
  const presentes = todos.filter((s) => fs.existsSync(path.join(DIST, s.id, 'index.html')));
  fs.writeFileSync(
    path.join(DIST, 'index.html'),
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sites</title>` +
      `<body style="font:16px system-ui;max-width:600px;margin:2rem auto;padding:0 1rem"><h1>Sites gerados</h1><ul>` +
      presentes.map((s) => `<li><a href="${esc(s.id)}/index.html">${esc(s.nome)}</a> &middot; ${esc(s.id)} &middot; template ${esc(s.template)}</li>`).join('') +
      `</ul></body>`
  );
  return { pasta, feitos };
}

module.exports = { construir, listarSites, carregarSite, idsSites, ID_SITE };

if (require.main === module) {
  const a = process.argv.slice(2);
  const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  try {
    construir({ sites: val('--sites') ? val('--sites').split(',').map((s) => s.trim()) : null, motor: val('--motor'), saida: val('--saida'), completo: a.includes('--completo') });
  } catch (e) {
    console.error('Erro: ' + e.message);
    process.exit(1);
  }
}
