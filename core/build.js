#!/usr/bin/env node
// Gera os sites. Cada site = sites/<dominio>/ (site.json + estoque.json + assets/) + um template + uma versão do motor.
// É INCREMENTAL: guarda o que gerou em .estado/ e, na próxima vez, só reescreve o que mudou.
//   node core/build.js                                          todos os sites, com o motor que cada um usa (dist/)
//   node core/build.js --sites trokey.com.br,outro.com.br        só esses sites
//   node core/build.js --sites trokey.com.br --motor rascunho    testa o motor em rascunho num site (vai para dist-preview/)
//   --completo                                                  ignora o que já foi gerado e refaz tudo
//   --saida <pasta>                                             muda a pasta de saída
// Entradas:  sites/<dominio>/  templates/<nome>/  core/motor/<versao>/engine.js  core/ui/
// Saídas:    <saida>/<dominio>/...   e   .estado/<saida>/pendentes/<dominio>.json (o que mudou e ainda não foi publicado)
//
// O que vai para cada site gerado:
//   motor/engine.js + motor/ui-*.js      ← core (motor da versão do site + ui)
//   css/ js/ img/ ...                    ← templates/<nome>/ (tudo menos paginas/ e template.json)
//   assets/                              ← sites/<dominio>/assets/
//   index.html                           ← a HOME institucional: página "" de "paginas" no site.json (sem ela, o core gera uma padrão)
//   multipla/index.html                  ← templates/<nome>/paginas/index.html (a listagem do estoque; sempre em /multipla)
//   carros/<Marca>/<Modelo>/<Versao>/<...>-<id>.html ← templates/<nome>/paginas/carro.html (e vendido.html); regra em core/ui/link-carro.js
//   <caminho>/index.html                 ← templates/<nome>/paginas/pagina.html + blocos/<tipo>.html ("paginas" no site.json)
//   multipla/<campo>/<valor>/index.html  ← páginas fixas de filtro (marca, cidade, carroceria): a listagem já filtrada,
//                                          com título próprio e os carros no HTML (SEO). "paginasFiltro" no site.json
//   carros.json, config.json, sitemap.xml (com <lastmod> = quando cada página mudou de verdade), robots.txt (core/robots.js)
//   estoque.xml                          ← o estoque em XML, para quem só lê XML (portais, catálogos, integrações antigas).
//                                          "feedXml": { "caminho": "xml/estoque.xml" } muda o endereço; "feedXml": false desliga
//
// Páginas de conteúdo (home institucional, "quero vender", política...) são listas de BLOCOS no site.json:
//   "paginas": [ { "caminho": "", "titulo": "...", "blocos": [ { "tipo": "banner", "imagem": "assets/x.webp" }, ... ] } ]
// Cada tipo de bloco é um HTML do template (templates/<nome>/blocos/<tipo>.html).
// Páginas que TODO site ganha (contato, privacidade, cookies, LGPD) vêm de paginas-padrao/<nome>.json, com
// {{site.nome}}, {{site.dominio}}, {{empresa.cnpj}}, {{rel}}... preenchidos por site. O site substitui uma delas com uma
// página de mesmo "caminho" em "paginas", ou desliga com "paginasPadrao": { "<nome>": false }. Campos de link/imagem com caminho
// relativo (link, imagem, foto, logo...) recebem o prefixo certo para a página onde aparecem.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./caminhos');
const LinkCarro = require('./ui/link-carro.js'); // regra do link da página do carro (a mesma usada no navegador)
const PL = require('./paginas-livres'); // páginas livres dos web designers (HTML normal)
const Fotos = require('./fotos'); // fotos por URL: quantas já estão prontas
const Robots = require('./robots');
const Inq = require('./inquilinos'); // inquilino do site: template próprio dele, se houver
const Sites = require('./sites'); // repositório de sites: o único que lê a pasta sites/
const Pendentes = require('./pendentes'); // o que falta publicar, um arquivo por site
const { renovarMinhas } = require('./trava'); // build longo: mantém as travas do trabalhador vivas // modelo do robots.txt (um para todos os sites; o site pode ter o seu)

const ROOT = C.ROOT;
const ESTADO = C.ESTADO;
const CAMPOS_FILTRO = ['estado', 'cidade', 'loja', 'marca', 'modelo', 'carroceria', 'ano', 'preco', 'km', 'cambio', 'combustivel', 'cor'];
const TEXTOS_PADRAO = { botaoWhatsapp: 'Tenho interesse (WhatsApp)', busca: 'Buscar: marca, modelo, cidade, cor...', voltar: 'Voltar ao estoque', rodape: '' };
const TEMA_PADRAO = { cor: '#0b5fff', fundo: '#f5f6f8', texto: '#1b2430', raio: 12, colunas: 250, fonte: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' };
const PAGINAS = ['index.html', 'carro.html', 'vendido.html', 'pagina.html'];
// blocos que todo template precisa ter: home padrão (banner, vitrine) e páginas padrão (titulo, texto, formulario, lojas)
const BLOCOS_OBRIGATORIOS = ['banner', 'vitrine', 'titulo', 'texto', 'formulario', 'lojas'];
const AVISO_COOKIES_PADRAO = 'Usamos cookies para melhorar sua experiência e, se ativadas, ferramentas de medição. Ao continuar, você concorda.';
const CAMINHO_ESTOQUE = 'multipla'; // a listagem do estoque fica SEMPRE em /multipla; a raiz é a home institucional
// páginas fixas de filtro: campo do carro → pasta em /multipla/ (padrão quando o site não define "paginasFiltro")
const FILTROS_PAGINA = { marca: 'marca', cidade: 'cidade', carroceria: 'carroceria', combustivel: 'combustivel', modelo: 'modelo' };
const PAGINAS_FILTRO_PADRAO = ['marca', 'cidade', 'carroceria'];
// filtros que o motor de cada versão conhece sem configuração (a página de filtro só existe se o filtro existir no motor)
const FILTROS_MOTOR_V1 = ['estado', 'cidade', 'loja', 'marca', 'modelo', 'ano', 'preco', 'km', 'cambio', 'combustivel', 'cor'];
const CARDS_POR_PAGINA = 24; // padrão da ui-lista (data-pagina no #grade muda)
// "formatoUrls": "revendamais" no site.json: páginas de filtro nos MESMOS endereços do Revenda Mais (migração sem 301)
const FILTROS_REVENDAMAIS = {
  marca: (v) => `marca/${String(v).toLowerCase()}`, // /multipla/marca/caoa chery
  cidade: (v) => `revenda_cidade_nome/${v}`, // /multipla/revenda_cidade_nome/Curitiba
  carroceria: (v) => `carroceria/${String(v).toLowerCase()}`,
  combustivel: (v) => `combustivel/${v}`,
  modelo: (v) => `modelo-marca/${String(v).toUpperCase()}`,
};
// link do carro: o "link" que vem no estoque (o do Revenda Mais, idêntico ao já indexado) ou a regra de core/ui/link-carro.js
const normalizarLink = (l) => String(l).replace(/^\/+/, '').replace(/\/{2,}/g, '/');
const caminhoCarro = (c) => c.link || LinkCarro.caminho(c);
// caminho com espaço/acento (páginas no formato revendamais) precisa ir codificado no href e no sitemap
const url = (caminho) => caminho.split('/').map(encodeURIComponent).join('/');
// 404.html de quem não configurou uma ("pagina404" no site.json, mesmo formato de uma página de "paginas")
const PAGINA_404_PADRAO = {
  titulo: 'Página não encontrada',
  blocos: [
    { tipo: 'titulo', titulo: 'Página não encontrada', subtitulo: 'O endereço pode ter mudado ou o veículo já foi vendido.' },
    { tipo: 'vitrine', titulo: 'Veja alguns carros do nosso estoque', quantidade: 4, botao: 'Ver estoque completo' },
  ],
};
// O que quebra o site quando publicado (a publicação recusa o site; o build só avisa, para o teste local continuar funcionando)
function problemasProducao(site) {
  const p = [];
  const local = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i;
  if (site.url && (!/^https:\/\//i.test(site.url) || local.test(site.url))) p.push(`"url" precisa ser https e público (está "${site.url}")`);
  if (site.fotosBase && local.test(site.fotosBase)) p.push(`"fotosBase" aponta para a máquina local ("${site.fotosBase}"): no ar, o site fica sem fotos`);
  else if (site.fotosBase && /^http:\/\//i.test(site.fotosBase)) p.push(`"fotosBase" sem https ("${site.fotosBase}"): o navegador bloqueia as fotos num site https`);
  return p;
}
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
// XML: tira caracteres que o XML não aceita (controle) e escapa os especiais
const xmlEsc = (s) => String(s).replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const FEED_OK = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.xml$/;
// VERSAO_HTML: aumente quando uma mudança NESTE arquivo alterar o HTML/JSON gerado. Mudar a versão refaz as páginas de
// TODOS os sites (com 2500 sites, ~1 milhão de arquivos para publicar), então não amarramos isso ao arquivo inteiro:
// um comentário ou refatoração não deve refazer nada. O teste tests/snapshot-html.test.js avisa se a saída mudou e a
// versão não (e vice-versa). Templates, tema, textos e dados do site já entram no hash de cada site por conta própria.
const VERSAO_HTML = 6; // 6: estoque.xml; 2: cards no HTML, filtros, <lastmod>; 3: páginas padrão; 4: link do estoque, URLs codificadas, formato revendamais; 5: 404.html, ?v= nos css/js, canonical nas páginas livres
const RENDER_VERSION = `html-${VERSAO_HTML}`;

const lerJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lerJSONSeExiste = (p, padrao) => { try { return lerJSON(p); } catch (e) { return padrao; } };
// sites/<dominio>/site.json → o id é sempre o nome da pasta
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
function hashDir(dir, pular = () => false) {
  const h = crypto.createHash('sha1');
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (pular(path.relative(dir, p))) continue;
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
const registrarPendente = (pasta, id, mud, completo) => Pendentes.registrar(pasta, id, mud, completo); // core/pendentes.js

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
  if (!fs.existsSync(C.estoque(site.id))) console.warn(`  aviso: site "${site.id}" sem sites/${site.id}/estoque.json`);
  const estoque = Sites.estoque(site.id);
  // site recém-criado ainda sem lojas: sobe sem estoque (carro só entra depois que a loja dele existir)
  if (!ids.length) { if ((estoque.carros || []).length) throw new Error(`Site "${site.id}" tem carros mas nenhuma loja em sites/${site.id}/site.json`); return []; }
  // ordem de exibição: campo "ordem" (menor primeiro); sem ele, a posição no arquivo. Empate: posição no arquivo.
  const lista = (estoque.carros || []).map((c, i) => ({ c, i }))
    .sort((a, b) => (typeof a.c.ordem === 'number' ? a.c.ordem : Infinity) - (typeof b.c.ordem === 'number' ? b.c.ordem : Infinity) || a.i - b.i)
    .map((x) => x.c);
  const carros = [];
  const estFotos = Fotos.lerEstadoFotos(site.id);
  for (const c of lista) {
    const lid = c.loja || (ids.length === 1 ? ids[0] : null);
    const loja = lojas[lid];
    if (!loja) throw new Error(`Site "${site.id}": carro ${c.id} com loja ${lid ? `inexistente "${lid}"` : 'não informada'} (lojas: ${ids.join(', ')})`);
    if (!passa(c, loja, site.restricoes || {})) continue;
    // fotos em lista de URLs: só conta as já processadas (até lá, o site mostra o marcador, nunca imagem quebrada)
    carros.push({ ...c, fotos: Fotos.contarFotos(c, estFotos), ...(c.link ? { link: normalizarLink(c.link) } : {}), opcionais: c.opcionais || [], descricao: c.descricao || '', carroceria: c.carroceria || '', destaque: !!c.destaque, lojaId: lid, loja: loja.nome, cidade: loja.cidade, uf: loja.uf });
  }
  return carros;
}

// hoje: "AAAA-MM-DD" (padrão: a data atual; SITE_CARROS_HOJE ou o parâmetro servem para testar prazos de retenção)
// paginas-padrao/*.json (lidas uma vez por build)
function lerPaginasPadrao() {
  if (!fs.existsSync(C.PAGINAS_PADRAO)) return [];
  return fs.readdirSync(C.PAGINAS_PADRAO).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const p = lerJSON(path.join(C.PAGINAS_PADRAO, f));
    if (!p.caminho || !Array.isArray(p.blocos)) throw new Error(`paginas-padrao/${f}: precisa de "caminho" e "blocos"`);
    return { ...p, nome: f.replace(/\.json$/, '') };
  });
}
// preenche {{site.nome}}, {{rel}}... em todos os textos de uma página padrão
const preencherTextos = (o, ctx) => (typeof o === 'string' ? render(o, ctx) : Array.isArray(o) ? o.map((x) => preencherTextos(x, ctx))
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, preencherTextos(v, ctx)])) : o);

function construir({ sites = null, motor = null, saida = null, completo = false, efemero = false, hoje: hojeParam = null } = {}) {
  const pasta = saida || (motor ? 'dist-preview' : 'dist');
  const DIST = C.saida(pasta);
  const todos = Sites.carregarTodos();
  const alvo = sites
    ? sites.map((id) => todos.find((s) => s.id === id) || (() => { throw new Error(`Site inexistente: "${id}"`); })())
    : todos;
  fs.mkdirSync(DIST, { recursive: true });
  const hashTpl = new Map();
  // paginas-extras/ fica de fora: editar uma página livre do template não deve refazer as páginas de carro de todos os sites
  const tplHash = (dir) => { if (!hashTpl.has(dir)) hashTpl.set(dir, sha(hashDir(dir, (r) => r === 'paginas-extras'))); return hashTpl.get(dir); };
  const hoje = hojeParam || process.env.SITE_CARROS_HOJE || new Date().toISOString().slice(0, 10);
  const feitos = [];
  const PADRAO = lerPaginasPadrao();
  const provisorias = PADRAO.filter((p) => p.provisorio).map((p) => p.nome);
  if (provisorias.length) console.warn(`  aviso: páginas padrão com TEXTO PROVISÓRIO (falta o texto do jurídico): ${provisorias.map((n) => `paginas-padrao/${n}.json`).join(', ')}`);

  for (const site of alvo) {
    if (!Sites.ID_SITE.test(String(site.id))) throw new Error(`Pasta de site inválida: "sites/${site.id}" (o nome da pasta é o domínio, ex.: sites/minhaloja.com.br)`);
    const versao = motor || site.motor;
    if (!versao) throw new Error(`Site "${site.id}" sem "motor" (ex.: "motor": "v1") em sites/${site.id}/site.json`);
    const arqMotor = path.join(C.motor(versao), 'engine.js');
    if (!fs.existsSync(arqMotor)) throw new Error(`Site "${site.id}": motor "${versao}" não existe (core/motor/${versao}/engine.js)`);
    const nomeTpl = site.template;
    // template próprio do inquilino (inquilinos/<id>/templates/<nome>, sem deploy) ou o da imagem (templates/<nome>)
    const dirTpl = nomeTpl ? Inq.dirTemplate(Inq.doSite(site), nomeTpl) : null;
    if (!nomeTpl || !fs.existsSync(dirTpl)) throw new Error(`Site "${site.id}": template "${nomeTpl}" não existe (templates/${nomeTpl}/)`);
    const faltam = [...PAGINAS.map((p) => [path.join(dirTpl, 'paginas', p), `paginas/${p}`]), ...BLOCOS_OBRIGATORIOS.map((b) => [path.join(dirTpl, 'blocos', `${b}.html`), `blocos/${b}.html`])]
      .filter(([arq]) => !fs.existsSync(arq)).map(([, nome]) => nome);
    if (faltam.length) throw new Error(`Template "${nomeTpl}" incompleto: falta ${faltam.join(', ')}`);

    // páginas de conteúdo; a home ("") é obrigatória: sem ela no site.json, o core usa HOME_PADRAO
    const cfgEstoque = site.estoque || {};
    if (cfgEstoque.caminho != null && limparCaminho(cfgEstoque.caminho) !== CAMINHO_ESTOQUE)
      console.warn(`  aviso: site "${site.id}": "estoque.caminho" foi ignorado (a listagem fica sempre em /${CAMINHO_ESTOQUE}/)`);
    const caminhoEstoque = CAMINHO_ESTOQUE;
    const paginasSite = (site.paginas || []).map((p) => ({ ...p, caminho: limparCaminho(p.caminho) }));
    const desligadas = site.paginasPadrao || {};
    // páginas livres dos designers (HTML normal). Prioridade de quem tem o mesmo caminho:
    //   site.json "paginas" > sites/<dominio>/paginas/ > templates/<nome>/paginas-extras/ > paginas-padrao/
    const livres = [
      ...PL.lerPaginasLivres(C.paginasLivresSite(site.id)).map((p) => ({ ...p, origem: `sites/${site.id}/paginas` })),
      ...PL.lerPaginasLivres(path.join(dirTpl, 'paginas-extras')).map((p) => ({ ...p, origem: `templates/${nomeTpl}/paginas-extras`, doTemplate: true })),
    ];
    const vistosLivres = new Map();
    for (const p of livres) {
      const onde = `${p.origem}/${path.relative(p.origem.startsWith('sites') ? C.paginasLivresSite(site.id) : path.join(dirTpl, 'paginas-extras'), p.arquivo)}`;
      if (vistosLivres.get(p.caminho) === p.origem) throw new Error(`Página "${p.caminho}" duplicada em ${p.origem} (existe ${p.caminho}.html e ${p.caminho}/index.html)`);
      if (paginasSite.some((x) => x.caminho === p.caminho) || vistosLivres.has(p.caminho)) continue; // quem vem antes ganha
      if (p.doTemplate && desligadas[p.caminho] === false) continue;
      if (!CAMINHO_OK.test(p.caminho)) throw new Error(`Página livre ${onde}: nome inválido "${p.caminho}" (use letras minúsculas, números e hífen: ex. feirao-novembro.html)`);
      vistosLivres.set(p.caminho, p.origem);
      const html = fs.readFileSync(p.arquivo, 'utf8');
      const m = PL.metadados(html, p.caminho);
      paginasSite.push({ caminho: p.caminho, titulo: m.titulo, descricao: m.descricao, ...(m.rotulo ? { rotulo: m.rotulo } : {}), blocos: [],
        livre: { arquivo: p.arquivo, assets: p.assets, semMoldura: m.livre, onde } });
    }
    // páginas padrão (contato, privacidade, cookies, LGPD): entram se o site não tem uma de mesmo caminho nem desligou
    const extrasTpl = PL.lerPaginasLivres(path.join(dirTpl, 'paginas-extras')).map((p) => p.caminho);
    for (const n of Object.keys(desligadas)) if (!PADRAO.some((p) => p.nome === n) && !extrasTpl.includes(n)) console.warn(`  aviso: site "${site.id}": paginasPadrao "${n}" não existe em paginas-padrao/ nem em templates/${nomeTpl}/paginas-extras/`);
    for (const p of PADRAO) {
      const caminho = limparCaminho(p.caminho);
      if (desligadas[p.nome] === false || paginasSite.some((x) => x.caminho === caminho)) continue;
      const { nome, provisorio, ...resto } = p;
      paginasSite.push({ ...preencherTextos(resto, {
        site: { nome: site.nome, url: site.url || '', dominio: site.id, whatsapp: site.whatsapp || '' }, empresa: site.empresa || {}, rel: prefixo(caminho),
      }), caminho, padrao: nome });
    }
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

    for (const x of problemasProducao(site)) console.warn(`  aviso: site "${site.id}": ${x} (a publicação vai recusar este site)`);
    const carros = juntar(site);
    const lojas = site.lojas || {};
    const out = path.join(DIST, site.id);
    const base = site.fotosBase || '';
    const tema = temaDoSite(site);
    const textos = { ...TEXTOS_PADRAO, ...(site.textos || {}) };

    // Só as páginas dependem disto (a versão do motor e os filtros ficam de fora de propósito:
    // trocar o motor ou os filtros não refaz nenhuma página).
    // nomes (não as contagens) de cidades/marcas/carrocerias entram: menus e rodapés podem listá-los em todas as páginas.
    // Contagens ("1052 veículos") mudam a toda hora: use-as só na listagem e nas páginas de conteúdo (sempre refeitas).
    const nomesEstoque = ['cidade', 'marca', 'carroceria', 'combustivel'].map((k) => [...new Set(carros.map((c) => c[k]))].sort().join('|'));
    const baseHash = sha(JSON.stringify([RENDER_VERSION, tplHash(dirTpl), site.nome, site.slogan, site.url, site.cor, site.tema, site.textos, site.fotosBase, site.cabecalho, site.rodape, site.lojas, nomesEstoque,
      paginasSite.filter((p) => p.rotulo).map((p) => [p.rotulo, p.caminho]), // links legais aparecem no rodapé das páginas de carro
      ...(site.rascunho ? ['rascunho'] : [])])); // só entra quando é rascunho: os sites definitivos não refazem nada por causa disso
    const estadoAnt = completo || efemero ? null : lerEstado(pasta, site.id);
    const incremental = !!estadoAnt && fs.existsSync(path.join(out, 'index.html'));
    if (!incremental) fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, LinkCarro.PASTA), { recursive: true });
    const baseMudou = !incremental || estadoAnt.base !== baseHash;
    const mud = { escritos: [], removidos: [] };
    const rel = (p) => `${site.id}/${p}`;

    // core → motor/ (engine da versão do site + ui); template → css/ js/ img/...; site → assets/
    const engine = fs.readFileSync(arqMotor, 'utf8').replace(/__VERSAO__/g, versao);
    escreverSe(path.join(out, 'motor', 'engine.js'), engine, rel('motor/engine.js'), mud);
    const arquivos = new Map();
    for (const [k, v] of listarArvore(C.UI)) arquivos.set(`motor/${k}`, v);
    for (const [k, v] of listarArvore(dirTpl, (r) => ['paginas', 'paginas-extras', 'blocos', 'parciais', 'template.json', 'motor', 'assets'].includes(r))) arquivos.set(k, v);
    for (const [k, v] of listarArvore(C.assets(site.id))) arquivos.set(`assets/${k}`, v);
    for (const [k, v] of arquivos) copiarSe(v, path.join(out, k), rel(k), mud);
    const estaticos = new Set(arquivos.keys()); // arquivos copiados (template, assets, páginas livres): o que sumir da origem é apagado
    // cache busting: todo .css/.js do site vai no HTML com ?v=<hash do conteúdo>. A hospedagem pode guardar css/js por
    // 1 ano (Cache-Control immutable) e HTML novo sempre pede o arquivo novo. Arquivos do template entram no hash das
    // páginas (mudou o css → as páginas são refeitas com o ?v novo). Os do core (motor/) não: página de carro antiga
    // continua com o ?v antigo, então o core/ui precisa continuar funcionando com HTML antigo (os ids não mudam).
    const versoes = new Map([['motor/engine.js', sha(engine).slice(0, 8)]]);
    for (const [k, v] of arquivos) if (/\.(css|js)$/.test(k)) versoes.set(k, sha(fs.readFileSync(v)).slice(0, 8));
    // o endereço é resolvido a partir da página (arqRel): "../css/x.css", "/css/x.css" e "feirao.css" (arquivo de página livre)
    const versionar = (html, arqRel) => html.replace(/\b(href|src)="([^"?#:]+\.(?:css|js))"/g, (m, a, u) => {
      const k = u.startsWith('/') ? u.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(arqRel), u));
      return versoes.has(k) ? `${a}="${u}?v=${versoes.get(k)}"` : m;
    });
    // site em RASCUNHO (endereço provisório, antes de ir para o domínio definitivo): nenhuma página pode entrar no Google.
    // noindex em toda página + robots.txt "Disallow: /" (core/robots.js). Promover (core/operacoes.js) tira os dois.
    const rascunho = (html) => (!site.rascunho || /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) ? html
      : html.replace(/<head([^>]*)>/i, '<head$1>\n<meta name="robots" content="noindex, nofollow">'));
    const escreverHtml = (arqRel, html) => escreverSe(path.join(out, arqRel), rascunho(versionar(html, arqRel)), rel(arqRel), mud);
    // {{> nome}} inclui templates/<nome>/parciais/<nome>.html (cabeçalho, rodapé... escritos uma vez só)
    const parciais = (txt, nivel = 0) => txt.replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/g, (_, n) => {
      const arq = path.join(dirTpl, 'parciais', `${n}.html`);
      if (!fs.existsSync(arq)) throw new Error(`Template "${nomeTpl}": parcial "${n}" não existe (templates/${nomeTpl}/parciais/${n}.html)`);
      if (nivel > 5) throw new Error(`Template "${nomeTpl}": parciais aninhadas demais (${n})`);
      return parciais(fs.readFileSync(arq, 'utf8'), nivel + 1);
    });
    const pagina = (arquivo) => parciais(fs.readFileSync(path.join(dirTpl, 'paginas', arquivo), 'utf8'));

    // dados que o motor lê
    escreverSe(
      path.join(out, 'carros.json'),
      // r = posição na ordem de exibição (ordenação "destaque" do motor); cr = carroceria
      JSON.stringify(carros.map((c, r) => ({ i: c.id, m: c.marca, o: c.modelo, v: c.versao, a: c.ano, p: c.preco, k: c.km, c: c.cor, b: c.cambio, f: c.combustivel, n: c.fotos, u: c.loja, cd: c.cidade, uf: c.uf, r, ...(c.carroceria ? { cr: c.carroceria } : {}), ...(c.link ? { l: c.link } : {}) }))), // l = link vindo do estoque
      rel('carros.json'), mud
    );
    // estoque em XML (compatibilidade): mesma ordem do site, links e fotos com endereço completo. Só com "url".
    // Entra em "estaticos": se o caminho mudar ou o feed for desligado, o arquivo antigo é apagado (e despublicado).
    const feed = site.feedXml === false ? null : { caminho: 'estoque.xml', ...(site.feedXml && typeof site.feedXml === 'object' ? site.feedXml : {}) };
    if (feed && site.url) {
      if (!FEED_OK.test(feed.caminho) || feed.caminho === 'sitemap.xml' || RESERVADOS.has(feed.caminho.split('/')[0]))
        throw new Error(`Site "${site.id}": feedXml.caminho inválido "${feed.caminho}" (ex.: "estoque.xml" ou "xml/estoque.xml")`);
      const raiz = site.url.replace(/\/$/, '');
      const t = (k, v) => (v === '' || v == null ? '' : `<${k}>${xmlEsc(v)}</${k}>`);
      const veiculo = (c, i) => `  <veiculo>${[
        t('id', c.id), t('ordem', i + 1), t('marca', c.marca), t('modelo', c.modelo), t('versao', c.versao), t('ano', c.ano), t('preco', c.preco),
        t('km', c.km), t('cor', c.cor), t('cambio', c.cambio), t('combustivel', c.combustivel), t('carroceria', c.carroceria), t('destaque', c.destaque ? 'sim' : 'nao'),
        t('loja', c.loja), t('cidade', c.cidade), t('uf', c.uf), t('link', `${raiz}/${url(caminhoCarro(c))}`),
        base && c.fotos ? `<fotos>${Array.from({ length: c.fotos }, (_, k) => t('foto', foto(base, c.id, k + 1, 1600))).join('')}</fotos>` : '',
        c.opcionais.length ? `<opcionais>${c.opcionais.map((o) => t('opcional', o)).join('')}</opcionais>` : '', t('descricao', c.descricao),
      ].join('')}</veiculo>`;
      escreverSe(path.join(out, feed.caminho), `<?xml version="1.0" encoding="UTF-8"?>\n<estoque site="${xmlEsc(site.id)}" total="${carros.length}">\n${carros.map(veiculo).join('\n')}${carros.length ? '\n' : ''}</estoque>\n`, rel(feed.caminho), mud);
      estaticos.add(feed.caminho);
    }
    const usadas = [...new Set(carros.map((c) => c.lojaId))].sort();
    escreverSe(
      path.join(out, 'config.json'),
      JSON.stringify({
        nome: site.nome, motor: versao, template: nomeTpl, whatsapp: site.whatsapp, vendedores: site.vendedores || {},
        busca: site.busca !== false, filtros: site.filtros || null, ordenacao: site.ordenacao || null, total: carros.length,
        // aviso de cookies (core/ui/ui-site.js): link para a política de cookies, ou de privacidade, se o site tiver
        avisoCookies: site.avisoCookies === false ? null : {
          texto: textos.avisoCookies || AVISO_COOKIES_PADRAO,
          link: (() => { const p = paginasSite.find((x) => x.padrao === 'politica-de-cookies') || paginasSite.find((x) => x.padrao === 'politica-de-privacidade'); return p ? `${p.caminho}/` : ''; })(),
        },
        lojas: Object.fromEntries(usadas.map((id) => [id, { nome: lojas[id].nome, cidade: lojas[id].cidade, uf: lojas[id].uf, endereco: lojas[id].endereco || '', whatsapp: lojas[id].whatsapp || '' }])),
      }),
      rel('config.json'), mud
    );

    // ---- páginas fixas de filtro (/multipla/marca/toyota/...) ----
    // só para filtros que o motor do site tem (senão o JS da página não saberia filtrar) e com 2+ valores
    const filtrosMotor = (site.filtros && site.filtros.length ? site.filtros.map((x) => (typeof x === 'string' ? x : x.campo))
      : [...FILTROS_MOTOR_V1, ...(/^v\d+$/.test(versao) && Number(versao.slice(1)) < 2 ? [] : ['carroceria'])]);
    const camposPagina = (site.paginasFiltro || PAGINAS_FILTRO_PADRAO).filter((k) => {
      if (!FILTROS_PAGINA[k]) { console.warn(`  aviso: site "${site.id}": paginasFiltro "${k}" desconhecido (use: ${Object.keys(FILTROS_PAGINA).join(', ')})`); return false; }
      return filtrosMotor.includes(k);
    });
    const paginasFiltro = new Map(); // "campo|valor" → { campo, valor, caminho, total }
    for (const k of camposPagina) {
      const valores = [...new Set(carros.map((c) => c[k]).filter(Boolean))];
      if (valores.length < 2) continue; // 1 valor só: a página seria igual à /multipla (conteúdo duplicado)
      const usados = new Set();
      for (const v of valores.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))) {
        const slug = LinkCarro.parte(v).toLowerCase();
        const chave = site.formatoUrls === 'revendamais' && FILTROS_REVENDAMAIS[k] ? FILTROS_REVENDAMAIS[k](v).toLowerCase() : slug;
        if (usados.has(chave)) { console.warn(`  aviso: site "${site.id}": "${v}" tem o mesmo endereço de outro valor de ${k}; sem página própria`); continue; }
        usados.add(chave);
        const sub = site.formatoUrls === 'revendamais' && FILTROS_REVENDAMAIS[k] ? FILTROS_REVENDAMAIS[k](v) : `${FILTROS_PAGINA[k]}/${slug}`;
        if (/(^|\/)\.\.?(\/|$)|[?#\\]/.test(sub)) { console.warn(`  aviso: site "${site.id}": "${v}" não vira página de ${k} (caractere inválido em endereço)`); continue; }
        paginasFiltro.set(`${k}|${v}`, { campo: k, valor: v, caminho: `${CAMINHO_ESTOQUE}/${sub}`, total: carros.filter((c) => c[k] === v).length });
      }
    }

    // números e listas do estoque que qualquer página/bloco pode usar (menu de cidades, marcas no rodapé, "1052 veículos"...)
    const contar = (k) => { const m = new Map(); for (const c of carros) if (c[k]) m.set(c[k], (m.get(c[k]) || 0) + 1); return [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR')); };
    const estoqueInfo = (r) => {
      const raizEstoque = r + `${CAMINHO_ESTOQUE}/`;
      // link de um filtro: a página fixa, se existir; senão a /multipla com ?campo=valor
      const q = (k, v) => (paginasFiltro.has(`${k}|${v}`) ? `${r}${url(paginasFiltro.get(`${k}|${v}`).caminho)}/` : `${raizEstoque}?${k}=${encodeURIComponent(v)}`);
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
        cabecalho: resolverLinks(site.cabecalho || {}, r), rodape: resolverLinks(site.rodape || {}, r),
        // páginas com "rotulo" (as padrão têm): para o rodapé de qualquer template ({{#site.links}})
        links: paginasSite.filter((p) => p.rotulo && p.caminho).map((p) => ({ rotulo: p.rotulo, link: `${r}${p.caminho}/` })) },
      inicioUrl: r || './', estoqueUrl: r + `${CAMINHO_ESTOQUE}/`, estoque: estoqueInfo(r),
    });

    // ---- blocos (templates/<nome>/blocos/<tipo>.html) ----
    const tplBlocos = new Map();
    const tplBloco = (tipo) => {
      if (!tplBlocos.has(tipo)) {
        const arq = path.join(dirTpl, 'blocos', `${tipo}.html`);
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
            href: r + url(caminhoCarro(c)),
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
      // links SEM prefixo: renderBlocos passa tudo por resolverLinks(r) depois (prefixar aqui dobrava o "../")
      if (b.tipo === 'lojas' && !b.itens) d.itens = estoqueInfo('').lojas;
      if (Array.isArray(b.itens)) d.itens = b.itens.map((i) => (i && i.nota ? { ...i, estrelas: '★'.repeat(Math.min(5, i.nota)) } : i));
      if (Array.isArray(b.campos)) {
        d.campos = b.campos.map((c, i) => ({
          ...c, id: `campo-${i + 1}`, nome: c.rotulo || `campo ${i + 1}`,
          ...(c.opcoesDe === 'lojas' ? { opcoes: Object.values(lojas).map((l) => l.nome) } : {}),
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

    // <lastmod> do sitemap: dia em que o conteúdo de cada página mudou de verdade (guardado no estado do build)
    const datas = {};
    const datasAnt = (incremental && estadoAnt.datas) || {};
    const datar = (arqRel, escreveu) => { datas[arqRel] = escreveu || !datasAnt[arqRel] ? hoje : datasAnt[arqRel]; };

    // cards já no HTML da listagem (o Google e quem está sem JS veem os carros). Usa o próprio modelo de card do
    // template (<script type="text/html" id="tpl-card"> com [[campo]]) e os mesmos campos da ui-lista; no navegador,
    // a ui-lista redesenha por cima.
    const lojasMultiplas = new Set(carros.map((c) => c.lojaId)).size > 1;
    const dadosCard = (c, r) => {
      const nome = `${c.marca} ${c.modelo}`;
      const local = `${c.cidade}/${c.uf}`;
      const loja = lojas[c.lojaId] || {};
      return {
        id: c.id, nome, versao: c.versao, ano: c.ano, km: `${c.km.toLocaleString('pt-BR')} km`, cambio: c.cambio, cor: c.cor,
        combustivel: c.combustivel, carroceria: c.carroceria || '', preco: brl(c.preco), loja: c.loja, local,
        lojaLocal: lojasMultiplas ? `${c.loja} · ${local}` : local, href: r + url(caminhoCarro(c)),
        zap: `https://wa.me/${loja.whatsapp || site.whatsapp || ''}?text=${encodeURIComponent(`Olá! Tenho interesse no ${nome} ${c.versao} ${c.ano} (ref. ${c.id}). Ainda está disponível?`)}`,
        imgattrs: base && c.fotos
          ? `src="${esc(foto(base, c.id, 1, 400))}" srcset="${esc(foto(base, c.id, 1, 400))} 400w, ${esc(foto(base, c.id, 1, 800))} 800w" sizes="(max-width:600px) 100vw, 300px" data-fb="${esc(nome)}"`
          : `src="${ph(nome)}"`,
      };
    };
    const comCards = (html, lista, r) => {
      const modelo = (html.match(/<script type="text\/html" id="tpl-card">([\s\S]*?)<\/script>/) || [])[1];
      if (!modelo) return html;
      return html.replace(/(<div id="grade"[^>]*>)\s*(<\/div>)/, (_, abre, fecha) => {
        const n = Number((abre.match(/data-pagina="(\d+)"/) || [])[1]) || CARDS_POR_PAGINA;
        const cards = lista.slice(0, n).map((c) => {
          const d = dadosCard(c, r);
          return modelo.replace(/\[\[(\w+)\]\]/g, (m, k) => (k === 'imgattrs' ? d[k] : k in d ? esc(d[k]) : m)).trim();
        }).join('\n');
        return `${abre}\n${cards}\n${fecha}`;
      });
    };

    const geradas = []; // páginas de listagem e de conteúdo (para apagar as que deixarem de existir)
    const tplLista = pagina('index.html');
    const raizUrlSite = site.url ? site.url.replace(/\/$/, '') : '';
    // listagem: /multipla e cada página de filtro (mesmo template, com o filtro já aplicado e os carros dele no HTML)
    const listagens = [{ caminho: caminhoEstoque, filtro: null }, ...[...paginasFiltro.values()].map((p) => ({ caminho: p.caminho, filtro: p }))];
    for (const l of listagens) {
      const r = prefixo(l.caminho);
      const arqRel = `${l.caminho}/index.html`;
      geradas.push(arqRel);
      const f = l.filtro;
      const lista = f ? carros.filter((c) => c[f.campo] === f.valor) : carros;
      const h1 = !f ? 'Estoque' : f.campo === 'cidade' ? `Seminovos em ${f.valor}` : f.campo === 'marca' || f.campo === 'modelo' ? `${f.valor} seminovos` : `${f.valor} seminovos`;
      const listagem = {
        h1, total: lista.length,
        titulo: !f ? `Estoque de seminovos | ${site.nome}` : `${h1} | ${site.nome}`,
        descricao: !f ? `${carros.length} veículos à venda no ${site.nome}. ${site.slogan || ''}`.trim()
          : `${lista.length} ${lista.length === 1 ? 'veículo' : 'veículos'}: ${h1.toLowerCase()} à venda no ${site.nome}.`,
        filtro: f ? `${f.campo}=${encodeURIComponent(f.valor)}` : '', // a ui-lista aplica isto ao abrir (data-filtro no <body>)
        canon: raizUrlSite ? `<link rel="canonical" href="${esc(raizUrlSite)}/${esc(url(l.caminho))}/">` : '',
      };
      const html = render(tplLista, {
        ...ctx(r), listagem, blocosAntes: renderBlocos(cfgEstoque.blocosAntes, r), blocosDepois: renderBlocos(cfgEstoque.blocosDepois, r),
      });
      datar(arqRel, escreverHtml(arqRel, comCards(html, lista, r)));
    }
    // páginas de conteúdo
    const tplPagina = pagina('pagina.html');
    for (const p of paginasSite) {
      const r = prefixo(p.caminho);
      const arqRel = p.caminho ? `${p.caminho}/index.html` : 'index.html';
      geradas.push(arqRel);
      const canon = site.url ? `<link rel="canonical" href="${esc(site.url.replace(/\/$/, ''))}/${p.caminho ? esc(p.caminho) + '/' : ''}">` : '';
      if (p.livre) {
        // página do designer: variáveis {{ }} (se usar), links "/x" relativos, e moldura do site ou só o essencial
        let html;
        try { html = PL.linksRelativos(render(fs.readFileSync(p.livre.arquivo, 'utf8'), ctx(r)), r); }
        catch (e) { throw new Error(`Página livre ${p.livre.onde}: ${e.message}`); }
        const final = p.livre.semMoldura ? PL.completarLivre(html, r, { titulo: p.titulo, descricao: p.descricao, canon })
          : render(tplPagina, { ...ctx(r), pagina: { titulo: p.titulo, descricao: p.descricao || site.slogan || '' }, canon, conteudo: html, temListagem: false });
        for (const [k, v] of p.livre.assets) if (/\.(css|js)$/.test(k)) versoes.set(`${p.caminho}/${k}`, sha(fs.readFileSync(v)).slice(0, 8));
        datar(arqRel, escreverHtml(arqRel, final));
        for (const [k, v] of p.livre.assets) { const destino = `${p.caminho}/${k}`; copiarSe(v, path.join(out, destino), rel(destino), mud); estaticos.add(destino); }
        continue;
      }
      const nListagem = p.blocos.filter((b) => b.tipo === 'listagem').length;
      if (nListagem > 1) throw new Error(`Site "${site.id}", página "${p.caminho || '(raiz)'}": só pode ter um bloco "listagem"`);
      datar(arqRel, escreverHtml(arqRel, render(tplPagina, {
        ...ctx(r), pagina: { titulo: p.titulo || site.nome, descricao: p.descricao || site.slogan || '' }, canon, conteudo: renderBlocos(p.blocos, r),
        temListagem: nListagem > 0, // a página carrega o motor + ui-lista (ids da listagem: ver README)
      })));
    }
    // 404.html: a hospedagem devolve esta página em QUALQUER endereço que não existe (/carros/a/b/c.html, /x/y/), então
    // os links dela partem da raiz do domínio ("/css/...", "/multipla/"), não da pasta. Fica fora do sitemap (noindex).
    {
      const p = site.pagina404 || PAGINA_404_PADRAO;
      if (!Array.isArray(p.blocos)) throw new Error(`Site "${site.id}": "pagina404" precisa de "blocos" (lista)`);
      escreverHtml('404.html', render(tplPagina, {
        ...ctx('/'), pagina: { titulo: `${p.titulo || PAGINA_404_PADRAO.titulo} | ${site.nome}`, descricao: '' },
        canon: '<meta name="robots" content="noindex">', conteudo: renderBlocos(p.blocos, '/'), temListagem: false,
      }));
    }
    // arquivo copiado que não existe mais na origem (imagem tirada da página do designer, css removido do template...)
    for (const arq of (incremental && estadoAnt.estaticos) || []) {
      if (estaticos.has(arq)) continue;
      fs.rmSync(path.join(out, arq), { force: true });
      mud.removidos.push(rel(arq));
      for (let d = path.dirname(path.join(out, arq)); d.startsWith(out + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch (e) { break; } }
    }
    // página que saiu do site.json (ou listagem que mudou de lugar): apaga
    for (const arqRel of (incremental && estadoAnt.paginas) || []) {
      if (geradas.includes(arqRel)) continue;
      fs.rmSync(path.join(out, arqRel), { force: true });
      mud.removidos.push(rel(arqRel));
      // apaga as pastas que ficarem vazias, subindo (multipla/cidade/curitiba → multipla/cidade); para na primeira com conteúdo
      for (let d = path.dirname(path.join(out, arqRel)); d.startsWith(out + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch (e) { break; } }
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
      renovarMinhas(); // barato: só toca no arquivo da trava a cada 1/3 do prazo
      const titulo = `${c.marca} ${c.modelo} ${c.versao} ${c.ano}`;
      titulos[c.id] = titulo;
      const link = caminhoCarro(c);
      links[c.id] = link;
      const h = sha(baseHash + JSON.stringify(c) + (lojas[c.lojaId].endereco || ''));
      hashes[c.id] = h;
      const antes = incremental ? estadoAnt.carros[c.id] : undefined;
      const arq = path.join(out, link);
      if (!baseMudou && antes === h && fs.existsSync(arq)) { inalterados++; datar(link, false); continue; }
      if (incremental) { if (antes === undefined) novos++; else alterados++; }
      const canon = raizUrl ? `<link rel="canonical" href="${esc(raizUrl)}/${esc(url(link))}"><meta property="og:url" content="${esc(raizUrl)}/${esc(url(link))}">` : '';
      const og =
        `<meta property="og:title" content="${esc(titulo)} - ${esc(brl(c.preco))}">` +
        `<meta property="og:description" content="${esc(c.km.toLocaleString('pt-BR'))} km · ${esc(c.cambio)} · ${esc(c.cidade)}/${esc(c.uf)}">` +
        (base ? `<meta property="og:image" content="${esc(foto(base, c.id, 1, 800))}">` : '') + canon +
        `<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org', '@type': 'Car', name: titulo, brand: { '@type': 'Brand', name: c.marca }, model: c.modelo,
          vehicleModelDate: String(c.ano), mileageFromOdometer: { '@type': 'QuantitativeValue', value: c.km, unitCode: 'KMT' },
          color: c.cor, vehicleTransmission: c.cambio, fuelType: c.combustivel, itemCondition: 'https://schema.org/UsedCondition',
          ...(raizUrl ? { url: `${raizUrl}/${url(link)}` } : {}),
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
      datar(link, escreverHtml(link, render(tplCarro, { ...ctx(relDe(link)), carro, og })));
    }

    // sitemap e robots: é por aqui que o Google descobre as páginas dos carros (a listagem é montada por JS)
    if (raizUrl) {
      // <lastmod>: dia em que a página mudou de verdade (o Google revisita só o que mudou)
      const urls = [...geradas.map((g) => [`${raizUrl}/${url(g.replace(/index\.html$/, ''))}`, datas[g]]), ...carros.map((c) => [`${raizUrl}/${url(links[c.id])}`, datas[links[c.id]]])];
      escreverSe(path.join(out, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `<url><loc>${esc(u)}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`, rel('sitemap.xml'), mud);
      escreverSe(path.join(out, 'robots.txt'), Robots.textoRobots(site), rel('robots.txt'), mud);
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
      escreverHtml(v.link, render(tplVendido, { ...ctx(relDe(v.link)), carro: { id, titulo: titulos[id] } }));
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
      const para = relDe(velho) + url(destino);
      const abs = raizUrl ? `${raizUrl}/${url(destino)}` : para;
      escreverSe(path.join(out, velho),
        `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${esc(abs)}">` +
        `<meta http-equiv="refresh" content="0; url=${esc(para)}"><title>Redirecionando...</title>` +
        `<script>location.replace(${JSON.stringify(para)} + location.search + location.hash)</script>` +
        `<p>Este anúncio mudou de endereço: <a href="${esc(para)}">clique aqui</a>.</p>`, rel(velho), mud);
      redir++;
    }

    if (!efemero) {
      gravarEstado(pasta, site.id, { render: RENDER_VERSION, base: baseHash, carros: hashes, links, titulos, vendidos, redirecionados, paginas: geradas, datas, estaticos: [...estaticos].sort(), em: new Date().toISOString() });
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

  atualizarIndice(pasta);
  return { pasta, feitos };
}

// <saida>/index.html: índice só para navegar entre os sites durante o desenvolvimento (não é publicado). Refeito pelo
// build e quando um site sai (core/operacoes.js), para nunca listar site que não existe mais.
function atualizarIndice(pasta = 'dist') {
  const DIST = C.saida(pasta);
  if (!fs.existsSync(DIST)) return;
  const presentes = Sites.carregarTodos().filter((s) => fs.existsSync(path.join(DIST, s.id, 'index.html')));
  const arq = path.join(DIST, 'index.html');
  const tmp = `${arq}.${process.pid}.tmp`; // vários trabalhadores podem escrever ao mesmo tempo: troca atômica
  fs.writeFileSync(tmp,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sites</title>` +
      `<body style="font:16px system-ui;max-width:600px;margin:2rem auto;padding:0 1rem"><h1>Sites gerados</h1><ul>` +
      presentes.map((s) => `<li><a href="${esc(s.id)}/index.html">${esc(s.nome)}</a> &middot; ${esc(s.id)} &middot; template ${esc(s.template)}</li>`).join('') +
      `</ul></body>`);
  fs.renameSync(tmp, arq);
}

module.exports = { atualizarIndice, construir, render, resolverLinks, problemasProducao, registrarPendente, VERSAO_HTML };

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
