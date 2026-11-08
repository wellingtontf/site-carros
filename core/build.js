#!/usr/bin/env node
// Gera os sites. Cada site = sites-config/<dominio>/ (site.json + estoque.json + assets/) + um tema + uma versão do motor.
// É INCREMENTAL: guarda o que gerou em .estado/ e, na próxima vez, só reescreve o que mudou.
//   node core/build.js                                          todos os sites, com o motor que cada um usa (sites-public/)
//   node core/build.js --sites trokey.com.br,outro.com.br        só esses sites
//   node core/build.js --sites trokey.com.br --motor rascunho    testa o motor em rascunho num site (vai para dist-preview/)
//   --completo                                                  ignora o que já foi gerado e refaz tudo
//   --saida <pasta>                                             muda a pasta de saída
// Entradas:  sites-config/<dominio>/  temas/<nome>/  core/motor/<versao>/engine.js  core/ui/
// Saídas:    <saida>/<dominio>/...   e   .estado/<saida>/pendentes/<dominio>.json (o que mudou e ainda não foi publicado)
//
// O que vai para cada site gerado:
//   motor/engine.js + motor/ui-*.js      ← core (motor da versão do site + ui)
// Tema (temas/<nome>/, estrutura do Shopify): config/settings_schema.json, layout/tema.html (moldura única),
// templates/ (um por tipo de página), secoes/, snippets/ ({{> nome}}), assets/, paginas-padrao/, paginas-extras/.
//   css/ js/ img/ ...                    ← temas/<nome>/assets/ (na raiz do site)
//   assets/                              ← sites-config/<dominio>/assets/
//   index.html                           ← a HOME: temas/<nome>/templates/home.html + sites-config/<dominio>/web/index.json (sem ela, HOME_PADRAO)
//   multipla/index.html                  ← temas/<nome>/templates/multipla.html (a listagem do estoque; sempre em /multipla)
//   carros/<Marca>/<Modelo>/<Versao>/<...>-<id>.html ← temas/<nome>/templates/carro.html (e vendido.html); regra em core/ui/link-carro.js
//   paginas/<caminho>/index.html         ← temas/<nome>/templates/pagina.html + secoes/<tipo>.html (sites-config/<dominio>/web/paginas/<caminho>.json)
//   NADA de arquivo depois de /multipla/: os filtros são ROTAS (/multipla/marca/toyota) que a hospedagem entrega com o
//   mesmo multipla/index.html (infra/cloudfront/roteador.js)
//   estoque.json (os carros que o motor lê; era carros.json), config.json, sitemap.xml (com <lastmod> = quando cada página
//   mudou de verdade), robots.txt (core/robots.js)
//
// sites-config/<dominio>/web/ é o ESPELHO do site público: cada arquivo é um endereço.
//   web/index.json → /  (home)          web/multipla.json → /multipla/  ({ "secoesAntes": [...], "secoesDepois": [...] })
//   web/paginas/lojas.json, web/paginas/sobre/nos.json → /paginas/lojas/ ... { "titulo": "...", "secoes": [ { "tipo": "banner", ... } ] }
//   web/paginas/feirao.html, web/paginas/feirao/index.html → HTML livre do designer (core/paginas-livres.js)
// Cada tipo de seção é um HTML do tema (temas/<nome>/secoes/<tipo>.html). O site.json NÃO tem lista de páginas.
// Páginas que TODO site ganha (contato, privacidade, cookies, LGPD...) vêm do TEMA do site:
// temas/<nome>/paginas-padrao/<nome>.json (cada tema é autocontido; o texto legal muda num lugar só por tema), com
// {{site.nome}}, {{site.dominio}}, {{empresa.cnpj}}, {{rel}}... preenchidos por site. O site substitui uma delas com uma
// página de mesmo nome em sites-config/<dominio>/web/paginas/ (ex.: contato.json), ou desliga com "paginasPadrao": { "<nome>": false }. Campos de link/imagem com caminho
// relativo (link, imagem, foto, logo...) recebem o prefixo certo para a página onde aparecem.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./caminhos');
const LinkCarro = require('./ui/link-carro.js'); // regra do link da página do carro (a mesma usada no navegador)
const Rotas = require('./ui/rotas.js'); // filtros no caminho da listagem (o mesmo arquivo roda no navegador)
const FormatoEstoque = require('./ui/formato-estoque.js'); // "formatoEstoque": "compacto" no site.json (mesmo arquivo desempacota no navegador)
const PL = require('./paginas-livres'); // páginas livres dos web designers (HTML normal)
const Fotos = require('./fotos'); // fotos por URL: quantas já estão prontas
const Robots = require('./robots');
const Sitemap = require('./sitemap');
const Comp = require('./componentes'); // componentes (componentes/<nome>/): {{componente x}} nos templates, bloco "componente" nas páginas // sitemap.xml: páginas + carros no ar (core/sitemap.js; gerarSitemap(dominio) também roda sozinho)
const Inq = require('./inquilinos'); // inquilino do site: tema próprio dele, se houver
const Temas = require('./temas');
const Codigos = require('./codigos'); // GTM, GA4, Pixel e código livre (site e inquilino), só depois do aceite de cookies // o que o tema declara (config/settings_schema.json) e os textos padrão dele (locales/pt-BR.json)
const Sites = require('./sites'); // repositório de sites: o único que lê a pasta sites-config/
const Pendentes = require('./pendentes'); // o que falta publicar, um arquivo por site
const { renovarMinhas } = require('./trava'); // build longo: mantém as travas do trabalhador vivas // modelo do robots.txt (um para todos os sites; o site pode ter o seu)

const ROOT = C.ROOT;
const ESTADO = C.ESTADO;
const CAMPOS_FILTRO = ['estado', 'cidade', 'loja', 'marca', 'modelo', 'carroceria', 'ano', 'preco', 'km', 'cambio', 'combustivel', 'cor'];
// último recurso para tema que não declara (o padrão de verdade vem do tema: settings_schema.json e locales/pt-BR.json)
const TEXTOS_PADRAO = { botaoWhatsapp: 'Tenho interesse (WhatsApp)', busca: 'Buscar: marca, modelo, cidade, cor...', voltar: 'Voltar ao estoque', rodape: '' };
const CONFIGURACOES_PADRAO = { cor: '#0b5fff', fundo: '#f5f6f8', texto: '#1b2430', raio: 12, colunas: 250, fonte: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' };
// templates que todo tema tem (temas/<nome>/templates/, padrão Shopify), um por tipo de página do site:
//   home.html      página principal (/)                     multipla.html  listagem do estoque (/multipla/ e filtros)
//   carro.html     página de cada carro                     vendido.html   carro que saiu ("não está mais disponível")
//   pagina.html    moldura das páginas de conteúdo (/paginas/...) e da 404
const PAGINAS = ['home.html', 'multipla.html', 'carro.html', 'vendido.html', 'pagina.html'];
// seções que todo tema precisa ter: home padrão (banner, vitrine) e páginas padrão (titulo, texto, formulario, lojas)
const SECOES_OBRIGATORIAS = ['banner', 'vitrine', 'titulo', 'texto', 'formulario', 'lojas'];
const AVISO_COOKIES_PADRAO = 'Usamos cookies para melhorar sua experiência e, se ativadas, ferramentas de medição. Ao continuar, você concorda.';
const CAMINHO_ESTOQUE = 'multipla'; // a listagem do estoque fica SEMPRE em /multipla; a raiz é a home institucional
// páginas de conteúdo (todas menos a home) ficam em /paginas/<nome>/ no site publicado: lojas, contato, lgpd, feirão...
const PASTA_PAGINAS = 'paginas';
const endPagina = (caminho) => (caminho ? `${PASTA_PAGINAS}/${caminho}` : ''); // pasta da página no site gerado
// página de redirecionamento (meta refresh + JS; noindex com canonical para o destino)
const htmlRedirecionamento = (para, abs, texto) =>
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${esc(abs)}">` +
  `<meta http-equiv="refresh" content="0; url=${esc(para)}"><title>Redirecionando...</title>` +
  `<script>location.replace(${JSON.stringify(para)} + location.search + location.hash)</script>` +
  `<p>${esc(texto)}: <a href="${esc(para)}">clique aqui</a>.</p>`;
// link de filtro escrito à mão ou de outro sistema vira a ROTA canônica (core/ui/rotas.js), com os nomes do motor:
//   "multipla/?carroceria=Moto" → "multipla/carroceria/Moto"; "multipla/revenda_cidade_nome/Curitiba" → "multipla/cidade/Curitiba"
// (q, ord e v continuam na query). Nenhum arquivo existe depois de /multipla/: a hospedagem entrega a listagem.
function paraFiltro(v) {
  const m = new RegExp(`^${CAMINHO_ESTOQUE}/([^?#]*)(?:\\?([^#]*))?(#.*)?$`).exec(String(v));
  if (!m || /\.[a-z0-9]+$/i.test(m[1])) return v; // não é a listagem, ou é arquivo (multipla/index.html)
  const daQ = Rotas.daQuery(m[2] || '');
  const pares = [...Rotas.ler(m[1]), ...daQ.pares];
  return `${CAMINHO_ESTOQUE}/${Rotas.montar(pares)}${daQ.resto ? `?${daQ.resto}` : ''}${m[3] || ''}`;
}
// ROTAS da listagem (core/ui/rotas.js): /multipla/marca/Toyota/cidade/A|B entrega o MESMO multipla/index.html (a
// hospedagem reescreve). Os caminhos da página são relativos a /multipla/: este script, o 1º do <head>, põe um <base> na
// pasta da listagem quando o endereço é mais fundo, e css, js, estoque.json e links continuam certos em qualquer rota.
const BASE_DA_ROTA = `<script>(function(){var p=location.pathname,i=p.indexOf('/${CAMINHO_ESTOQUE}/'),b=i<0?'':p.slice(0,i+${CAMINHO_ESTOQUE.length + 2});` +
  `if(b&&p!==b&&p!==b+'index.html')document.write('<base href="'+b+'">')})()</script>`;
const comBaseDaRota = (html) => html.replace(/<head[^>]*>/i, (m) => `${m}\n${BASE_DA_ROTA}`);
const CARDS_POR_PAGINA = 24; // padrão da ui-lista (data-pagina no #grade muda)
// link do carro: o "link" que vem no estoque (o do Revenda Mais, idêntico ao já indexado) ou a regra de core/ui/link-carro.js
const normalizarLink = (l) => String(l).replace(/^\/+/, '').replace(/\/{2,}/g, '/');
const caminhoCarro = (c) => c.link || LinkCarro.caminho(c);
// caminho com espaço/acento (páginas no formato revendamais) precisa ir codificado no href e no sitemap
const url = (caminho) => caminho.split('/').map(encodeURIComponent).join('/');
// 404.html de quem não configurou uma ("pagina404" no site.json, mesmo formato de uma página de "paginas")
const PAGINA_404_PADRAO = {
  titulo: 'Página não encontrada',
  secoes: [
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
// home de quem não configurou uma (o tema precisa ter as seções "banner" e "vitrine")
const HOME_PADRAO = (site) => [
  { tipo: 'banner', titulo: site.nome, subtitulo: site.slogan || '' },
  { tipo: 'vitrine', titulo: 'Destaques', quantidade: 8, botao: 'Ver estoque completo' },
];
// arquivo com os carros que o motor lê (core/ui/ui-lista.js busca este nome)
const ARQ_ESTOQUE = 'estoque.json';
const RESERVADOS = new Set(['carro', 'paginas', LinkCarro.PASTA, CAMINHO_ESTOQUE, 'motor', 'css', 'js', 'img', 'assets', ARQ_ESTOQUE, 'config.json', 'sitemap.xml', 'robots.txt']);
const CAMINHO_OK = /^([a-z0-9][a-z0-9-]*)(\/[a-z0-9][a-z0-9-]*)*$/;
const CHAVES_LINK = new Set(['link', 'imagem', 'foto', 'logo', 'logoRodape', 'banner', 'favicon']);
const RETENCAO_PADRAO_DIAS = 30; // quanto tempo a página de um carro que saiu continua mostrando "indisponível"
const REDIRECIONAMENTO_PADRAO_DIAS = 180; // quanto tempo um link antigo de carro (que mudou de endereço) continua redirecionando

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
// HTML sem os modelos de card (<script type="text/html">) e comentários: para contar ids sem pegar os [[campos]] dos modelos
const A_semModelos = (html) => html.replace(/<script type="text\/html"[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
// arquivos que versões anteriores do build geravam e não existem mais: saem da saída (e são despublicados)
const OBSOLETOS = ['carros.json', 'estoque.xml'];
// VERSAO_HTML: aumente quando uma mudança NESTE arquivo alterar o HTML/JSON gerado. Mudar a versão refaz as páginas de
// TODOS os sites (com 2500 sites, ~1 milhão de arquivos para publicar), então não amarramos isso ao arquivo inteiro:
// um comentário ou refatoração não deve refazer nada. O teste tests/snapshot-html.test.js avisa se a saída mudou e a
// versão não (e vice-versa). Templates, tema, textos e dados do site já entram no hash de cada site por conta própria.
const VERSAO_HTML = 12; // 12: estoque.json com a data de publicação (dp, ordenação do motor v4), config.json com "tema" (era "template"); 11: rotas da listagem (/multipla/marca/toyota, minúsculas), <base> da rota; 10: sem páginas de filtro (/multipla/marca/x/...): filtro só por parâmetro; 9: estoque.json (era carros.json), sem estoque.xml; 8: componentes (filtro, estoque) nos templates; 7: páginas de conteúdo em /paginas/<nome>/ (endereço antigo redireciona); 6: estoque.xml; 2: cards no HTML, filtros, <lastmod>; 3: páginas padrão; 4: link do estoque, URLs codificadas, formato revendamais; 5: 404.html, ?v= nos css/js, canonical nas páginas livres
const RENDER_VERSION = `html-${VERSAO_HTML}`;

const lerJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lerJSONSeExiste = (p, padrao) => { try { return lerJSON(p); } catch (e) { return padrao; } };
// sites-config/<dominio>/site.json → o id é sempre o nome da pasta
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
// "configuracoes" do site.json (cores, fonte, logo...; no Shopify, o settings_data.json) sobre o padrão do TEMA
// (settings_schema.json); CONFIGURACOES_PADRAO só cobre o que o tema não declara (as variáveis CSS sempre existem)
const semVazios = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== null && v !== ''));
function configuracoesDoSite(site, tema) {
  const t = { ...CONFIGURACOES_PADRAO, ...Temas.padroes(tema, 'configuracoes'), ...(site.cor ? { cor: site.cor } : {}), ...semVazios(site.configuracoes) };
  if (t.fonteGoogle) t.fonte = `"${t.fonteGoogle}",${CONFIGURACOES_PADRAO.fonte}`;
  return t;
}
const temaCss = (t) => `:root{--cor:${limpaCss(t.cor)};--fundo:${limpaCss(t.fundo)};--texto:${limpaCss(t.texto)};--raio:${Number(t.raio)}px;--colunas:${Number(t.colunas)}px;--fonte:${limpaCss(t.fonte)}}`;
// imagens das configurações (logo, banner...): caminho relativo aponta para os arquivos do site (ex.: "assets/logo.png")
// e ganha o prefixo certo para cada página; URL absoluta fica como está
const IMAGEM = /\.(png|jpe?g|webp|avif|gif|svg|ico)$/i;
const configuracoesDaPagina = (t, rel) => Object.fromEntries(Object.entries(t).map(([k, v]) =>
  [k, typeof v === 'string' && IMAGEM.test(v) && !/^([a-z]+:)?\/\//i.test(v) && !v.startsWith('/') ? rel + v : v]));
// links/imagens relativos dentro de cabeçalho, rodapé e seções ganham o prefixo da página
const relativo = (v) => typeof v === 'string' && v !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(v);
// mapa: ajusta o link antes do prefixo (ex.: "contato/" → "paginas/contato/", ver paraPagina no construir)
function resolverLinks(o, rel, mapa = (x) => x) {
  if (Array.isArray(o)) return o.map((x) => resolverLinks(x, rel, mapa));
  if (!o || typeof o !== 'object') return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, CHAVES_LINK.has(k) && relativo(v) ? rel + mapa(v) : resolverLinks(v, rel, mapa)]));
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

// carros do site: sites-config/<dominio>/estoque.json; cada carro diz sua loja ("loja": "<id>" de site.lojas).
// Site com uma loja só: o campo "loja" do carro é opcional.
function juntar(site) {
  const lojas = site.lojas || {};
  const ids = Object.keys(lojas);
  if (!fs.existsSync(C.estoque(site.id))) console.warn(`  aviso: site "${site.id}" sem sites-config/${site.id}/estoque.json`);
  const estoque = Sites.estoque(site.id);
  // site recém-criado ainda sem lojas: sobe sem estoque (carro só entra depois que a loja dele existir)
  if (!ids.length) { if ((estoque.carros || []).length) throw new Error(`Site "${site.id}" tem carros mas nenhuma loja em sites-config/${site.id}/site.json`); return []; }
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
// <tema>/paginas-padrao/*.json (as páginas padrão do tema; lidas uma vez por tema a cada build)
function lerPaginasPadrao(dirTpl) {
  const dir = path.join(dirTpl, C.TEMA.paginasPadrao);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const p = lerJSON(path.join(dir, f));
    if (p.blocos !== undefined) throw new Error(`${path.relative(ROOT, path.join(dir, f))}: "blocos" agora se chama "secoes" (node ferramentas/migrar-temas.js)`);
    if (!p.caminho || !Array.isArray(p.secoes)) throw new Error(`${path.relative(ROOT, path.join(dir, f))}: precisa de "caminho" e "secoes"`);
    return { ...p, nome: f.replace(/\.json$/, '') };
  });
}
// herança de templates (Mustache): {{$nome}}conteúdo{{/nome}}. O conteúdo vale exatamente como está escrito (quebras de
// linha inclusive), então o designer decide o espaçamento. Texto fora dos blocos no template = erro (ele sumiria).
const BLOCO_LAYOUT = /\{\{\$([a-z][a-zA-Z0-9-]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
function comLayout(tpl, dirTpl, onde) {
  if (!/\{\{\$[a-z]/.test(tpl)) return tpl; // documento inteiro: sem layout
  const arq = path.join(dirTpl, C.TEMA.layout);
  if (!fs.existsSync(arq)) throw new Error(`${onde} usa o layout ({{$...}}), mas o tema não tem layout/tema.html`);
  const blocos = new Map();
  const fora = tpl.replace(BLOCO_LAYOUT, (_, n, conteudo) => {
    if (blocos.has(n)) throw new Error(`${onde}: o bloco {{$${n}}} aparece duas vezes`);
    blocos.set(n, conteudo); return '';
  });
  if (fora.trim()) throw new Error(`${onde}: texto fora dos blocos {{$...}}{{/...}} (com layout, tudo do template fica dentro de um bloco): "${fora.trim().slice(0, 60)}"`);
  const layout = fs.readFileSync(arq, 'utf8');
  const doLayout = new Set();
  const html = layout.replace(BLOCO_LAYOUT, (_, n, padrao) => { doLayout.add(n); return blocos.has(n) ? blocos.get(n) : padrao; });
  const sobra = [...blocos.keys()].filter((n) => !doLayout.has(n));
  if (sobra.length) throw new Error(`${onde}: o layout/tema.html não tem o bloco ${sobra.map((n) => `{{$${n}}}`).join(', ')} (tem: ${[...doLayout].join(', ') || 'nenhum'})`);
  return html;
}
// preenche {{site.nome}}, {{rel}}... em todos os textos de uma página padrão
const preencherTextos = (o, ctx) => (typeof o === 'string' ? render(o, ctx) : Array.isArray(o) ? o.map((x) => preencherTextos(x, ctx))
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, preencherTextos(v, ctx)])) : o);

// completo = do zero, DESCARTANDO o histórico (vendidos, redirecionamentos): só antes de publicar.
// todasPaginas = regera todas as páginas do site MANTENDO o histórico (o "rebuild" seguro para site no ar).
function construir({ sites = null, motor = null, saida = null, completo = false, todasPaginas = false, efemero = false, hoje: hojeParam = null } = {}) {
  const pasta = saida || (motor ? 'dist-preview' : C.PUBLICO);
  const DIST = C.saida(pasta);
  const todos = Sites.carregarTodos();
  const alvo = sites
    ? sites.map((id) => todos.find((s) => s.id === id) || (() => { throw new Error(`Site inexistente: "${id}"`); })())
    : todos;
  fs.mkdirSync(DIST, { recursive: true });
  const hashTpl = new Map();
  // paginas-extras e paginas-padrao ficam de fora: editar o texto de uma página (LGPD, feirão...) não deve refazer as
  // páginas de carro de todos os sites (as páginas de conteúdo são refeitas sempre; os rótulos entram no hash do site)
  Comp.limparCache();
  Temas.limparCache();
  // mudou um componente: refaz as páginas. Só as pastas dos componentes contam (o README.md da raiz de componentes/ não)
  const hashComponentes = fs.existsSync(C.COMPONENTES) ? sha(hashDir(C.COMPONENTES, (r) => !r.includes(path.sep))) : '';
  const tplHash = (dir) => { if (!hashTpl.has(dir)) hashTpl.set(dir, sha(hashDir(dir, (r) => r === C.TEMA.paginasExtras || r === C.TEMA.paginasPadrao))); return hashTpl.get(dir); };
  const hoje = hojeParam || process.env.SITE_CARROS_HOJE || new Date().toISOString().slice(0, 10);
  const feitos = [];
  // páginas padrão por tema (cache) e aviso de texto provisório uma vez por tema
  const padraoDe = new Map();
  const paginasPadraoDo = (dirTpl) => {
    if (!padraoDe.has(dirTpl)) {
      const lista = lerPaginasPadrao(dirTpl);
      const prov = lista.filter((p) => p.provisorio).map((p) => `${p.nome}.json`);
      if (prov.length) console.warn(`  aviso: ${path.relative(ROOT, path.join(dirTpl, C.TEMA.paginasPadrao))}: TEXTO PROVISÓRIO (falta o texto do jurídico) em ${prov.join(', ')}`);
      padraoDe.set(dirTpl, lista);
    }
    return padraoDe.get(dirTpl);
  };

  for (const site of alvo) {
    if (!Sites.ID_SITE.test(String(site.id))) throw new Error(`Pasta de site inválida: "sites-config/${site.id}" (o nome da pasta é o domínio, ex.: sites-config/minhaloja.com.br)`);
    const versao = motor || site.motor;
    if (!versao) throw new Error(`Site "${site.id}" sem "motor" (ex.: "motor": "v1") em sites-config/${site.id}/site.json`);
    const arqMotor = path.join(C.motor(versao), 'engine.js');
    if (!fs.existsSync(arqMotor)) throw new Error(`Site "${site.id}": motor "${versao}" não existe (core/motor/${versao}/engine.js)`);
    // padrão Shopify (2026-11-08): "tema" = nome do tema; o objeto antigo "tema" (cores, logo) virou "configuracoes"
    if (site.template !== undefined || (site.tema && typeof site.tema === 'object')) throw new Error(`Site "${site.id}": "template" agora se chama "tema" e as cores/logo vão em "configuracoes". Para migrar: node ferramentas/migrar-temas.js`);
    const nomeTpl = site.tema;
    // tema próprio do inquilino (inquilinos/<id>/temas/<nome>, sem deploy) ou o da imagem (temas/<nome>)
    const dirTpl = nomeTpl ? Inq.dirTema(Inq.doSite(site), nomeTpl) : null;
    if (!nomeTpl || !fs.existsSync(dirTpl)) throw new Error(`Site "${site.id}": tema "${nomeTpl}" não existe (temas/${nomeTpl}/)`);
    const antigos = C.TEMA_ANTIGO.filter((x) => fs.existsSync(path.join(dirTpl, x)));
    if (antigos.length) throw new Error(`Tema "${nomeTpl}" com a estrutura antiga (${antigos.join(', ')}): agora é config/settings_schema.json, templates/, secoes/, snippets/ e assets/. Para migrar: node ferramentas/migrar-temas.js`);
    const faltam = [[path.join(dirTpl, C.TEMA.schema), C.TEMA.schema.split(path.sep).join('/')], ...PAGINAS.map((p) => [path.join(dirTpl, C.TEMA.templates, p), `templates/${p}`]), ...SECOES_OBRIGATORIAS.map((b) => [path.join(dirTpl, C.TEMA.secoes, `${b}.html`), `secoes/${b}.html`])]
      .filter(([arq]) => !fs.existsSync(arq)).map(([, nome]) => nome);
    if (faltam.length) throw new Error(`Tema "${nomeTpl}" incompleto: falta ${faltam.join(', ')}`);
    // o site contra o que o tema declara: tipo errado para o build; chave que o tema não usa só avisa
    const tema = Temas.carregar(dirTpl);
    const conf = Temas.validarSite(site, tema);
    if (conf.erros.length) throw new Error(`Site "${site.id}" (tema "${nomeTpl}"): ${conf.erros.join('; ')}`);
    for (const a of conf.avisos) console.warn(`  aviso: site "${site.id}": ${a}`);

    // páginas de conteúdo; a home ("") é obrigatória: sem ela no site.json, o core usa HOME_PADRAO
    // a listagem (/multipla/) é configurada em sites-config/<dominio>/web/multipla.json: { "secoesAntes": [...], "secoesDepois": [...] }
    if (site.estoque != null) throw new Error(`Site "${site.id}": "estoque" não fica mais no site.json: a listagem é configurada em sites-config/${site.id}/web/multipla.json ({ "secoesAntes", "secoesDepois" }). Para mover: node ferramentas/mover-paginas.js ${site.id}`);
    let cfgEstoque = {};
    // arquivo vazio = sem configuração (o designer apaga o conteúdo para tirar o banner, por exemplo)
    if (fs.existsSync(C.multipla(site.id)) && fs.readFileSync(C.multipla(site.id), 'utf8').trim() !== '') {
      try { cfgEstoque = lerJSON(C.multipla(site.id)); } catch (e) { throw new Error(`sites-config/${site.id}/web/multipla.json: JSON inválido (${e.message})`); }
      if (!cfgEstoque || typeof cfgEstoque !== 'object' || Array.isArray(cfgEstoque)) throw new Error(`sites-config/${site.id}/web/multipla.json: precisa ser um objeto { "secoesAntes": [...], "secoesDepois": [...] }`);
      const erros = Sites.validarMultipla(site.id, cfgEstoque);
      if (erros.length) throw new Error(`sites-config/${site.id}/web/multipla.json: ${erros.join('; ')}`);
    }
    const caminhoEstoque = CAMINHO_ESTOQUE;
    // páginas do site: ARQUIVOS em sites-config/<dominio>/web/ (espelho do site público): web/index.json = home,
    // web/paginas/lojas.json, web/paginas/feirao.html... O designer cria uma página nova criando um arquivo, sem mexer no cadastro.
    if (site.paginas != null) throw new Error(`Site "${site.id}": "paginas" não fica mais no site.json: cada página é um arquivo em sites-config/${site.id}/web/paginas/ (a home em web/index.json). Para mover: node ferramentas/mover-paginas.js`);
    const dirWeb = C.web(site.id);
    const paginasSite = PL.paginasJsonDoSite(C, site.id).map((p) => {
      const onde = `sites-config/${site.id}/web/${path.relative(dirWeb, p.arquivo)}`;
      let j;
      try { j = lerJSON(p.arquivo); } catch (e) { throw new Error(`${onde}: JSON inválido (${e.message})`); }
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${onde}: precisa ser um objeto { "titulo", "secoes": [...] }`);
      if (j.blocos !== undefined) throw new Error(`${onde}: "blocos" agora se chama "secoes" (node ferramentas/migrar-temas.js)`);
      const { caminho, ...resto } = j; // o caminho é o nome do arquivo
      return { ...resto, caminho: p.caminho, arquivo: onde };
    });
    const desligadas = site.paginasPadrao || {};
    // páginas livres dos designers (HTML normal). Prioridade de quem tem o mesmo caminho:
    //   sites-config/<dominio>/web/paginas/ > temas/<nome>/paginas-extras/ > temas/<nome>/paginas-padrao/
    const livres = [
      ...PL.lerPaginasLivres(C.paginasLivresSite(site.id)).map((p) => ({ ...p, origem: `sites-config/${site.id}/web/paginas` })),
      ...PL.lerPaginasLivres(path.join(dirTpl, C.TEMA.paginasExtras)).map((p) => ({ ...p, origem: `temas/${nomeTpl}/${C.TEMA.paginasExtras}`, doTemplate: true })),
    ];
    const vistosLivres = new Map();
    for (const p of livres) {
      const onde = `${p.origem}/${path.relative(p.origem.startsWith('sites-config') ? C.paginasLivresSite(site.id) : path.join(dirTpl, C.TEMA.paginasExtras), p.arquivo)}`;
      if (vistosLivres.get(p.caminho) === p.origem) throw new Error(`Página "${p.caminho}" duplicada em ${p.origem} (existe ${p.caminho}.html e ${p.caminho}/index.html)`);
      const json = paginasSite.find((x) => x.caminho === p.caminho && !x.livre);
      if (json && !p.doTemplate) throw new Error(`Página "${p.caminho}" duplicada em ${p.origem} (existe ${json.arquivo} e a página HTML ${onde}): fique com uma só`);
      if (json || vistosLivres.has(p.caminho)) continue; // a do site vale mais que a do tema
      if (p.doTemplate && desligadas[p.caminho] === false) continue;
      if (!CAMINHO_OK.test(p.caminho)) throw new Error(`Página livre ${onde}: nome inválido "${p.caminho}" (use letras minúsculas, números e hífen: ex. feirao-novembro.html)`);
      vistosLivres.set(p.caminho, p.origem);
      const html = fs.readFileSync(p.arquivo, 'utf8');
      const m = PL.metadados(html, p.caminho);
      paginasSite.push({ caminho: p.caminho, titulo: m.titulo, descricao: m.descricao, ...(m.rotulo ? { rotulo: m.rotulo } : {}), secoes: [],
        livre: { arquivo: p.arquivo, assets: p.assets, semMoldura: m.livre, onde } });
    }
    // páginas padrão (contato, privacidade, cookies, LGPD): entram se o site não tem uma de mesmo caminho nem desligou
    const PADRAO = paginasPadraoDo(dirTpl);
    const extrasTpl = PL.lerPaginasLivres(path.join(dirTpl, C.TEMA.paginasExtras)).map((p) => p.caminho);
    for (const n of Object.keys(desligadas)) if (!PADRAO.some((p) => p.nome === n) && !extrasTpl.includes(n)) console.warn(`  aviso: site "${site.id}": paginasPadrao "${n}" não existe em temas/${nomeTpl}/paginas-padrao/ nem em temas/${nomeTpl}/paginas-extras/`);
    for (const p of PADRAO) {
      const caminho = limparCaminho(p.caminho);
      if (desligadas[p.nome] === false || paginasSite.some((x) => x.caminho === caminho)) continue;
      const { nome, provisorio, ...resto } = p;
      paginasSite.push({ ...preencherTextos(resto, {
        site: { nome: site.nome, url: site.url || '', dominio: site.id, whatsapp: site.whatsapp || '' }, empresa: site.empresa || {}, rel: prefixo(endPagina(caminho)),
      }), caminho, padrao: nome });
    }
    if (!paginasSite.some((p) => p.caminho === '')) paginasSite.unshift({ caminho: '', titulo: site.nome, descricao: site.slogan || '', secoes: HOME_PADRAO(site) });
    const usados = new Set();
    for (const p of paginasSite) {
      const onde = `Site "${site.id}", página "${p.caminho || '(raiz)'}"`;
      if (p.caminho && !CAMINHO_OK.test(p.caminho)) throw new Error(`${onde}: caminho inválido (use letras minúsculas, números, hífen e /)`);
      if (RESERVADOS.has(p.caminho.split('/')[0])) throw new Error(`${onde}: "${p.caminho.split('/')[0]}" é reservado`);
      if (usados.has(p.caminho)) throw new Error(`${onde}: caminho repetido${p.arquivo ? ` (${p.arquivo} e outro arquivo viram o mesmo endereço)` : ''}`);
      usados.add(p.caminho);
      if (!Array.isArray(p.secoes)) throw new Error(`${onde}: falta "secoes" (lista)`);
    }
    // link para uma página do site escrito do jeito simples ("contato/", "lojas", "/sobre/nos/" no HTML do designer) vai
    // para /paginas/<nome>/. Assim cadastro, seções e HTML livre não precisam saber que as páginas moram em /paginas/.
    const caminhosPag = new Set(paginasSite.map((p) => p.caminho).filter(Boolean));
    const paraPagina = (v) => {
      const f = paraFiltro(v);
      if (f !== v) return f;
      const m = /^([^?#]*?)(\/?)([?#].*)?$/.exec(v);
      return m && caminhosPag.has(m[1]) ? `${PASTA_PAGINAS}/${m[1]}/${m[3] || ''}` : v;
    };
    for (const f of site.filtros || []) {
      const campo = typeof f === 'string' ? f : f.campo;
      if (!CAMPOS_FILTRO.includes(campo)) console.warn(`  aviso: site "${site.id}" tem filtro desconhecido "${campo}" (use: ${CAMPOS_FILTRO.join(', ')})`);
    }

    for (const x of problemasProducao(site)) console.warn(`  aviso: site "${site.id}": ${x} (a publicação vai recusar este site)`);
    const carros = juntar(site);
    const lojas = site.lojas || {};
    const out = path.join(DIST, site.id);
    const base = site.fotosBase || '';
    const configuracoes = configuracoesDoSite(site, tema);
    const textos = { ...TEXTOS_PADRAO, ...tema.textos, ...(site.textos || {}) };
    const cabecalho = { ...Temas.padroes(tema, 'cabecalho'), ...semVazios(site.cabecalho) };
    const rodape = { ...Temas.padroes(tema, 'rodape'), ...semVazios(site.rodape) };

    // Só as páginas dependem disto (a versão do motor e os filtros ficam de fora de propósito:
    // trocar o motor ou os filtros não refaz nenhuma página).
    // nomes (não as contagens) de cidades/marcas/carrocerias entram: menus e rodapés podem listá-los em todas as páginas.
    // Contagens ("1052 veículos") mudam a toda hora: use-as só na listagem e nas páginas de conteúdo (sempre refeitas).
    const nomesEstoque = ['cidade', 'marca', 'carroceria', 'combustivel'].map((k) => [...new Set(carros.map((c) => c[k]))].sort().join('|'));
    // opções dos componentes no site inteiro: sites-config/<dominio>/componentes/<nome>.json (conferidas aqui, mesmo as de
    // componente que nenhuma página usa: erro de digitação não pode ficar escondido)
    if (site.componentes != null) throw new Error(`Site "${site.id}": "componentes" não fica mais no site.json: cada componente é um arquivo em sites-config/${site.id}/componentes/<nome>.json (ex.: estoque.json). Para mover: node ferramentas/mover-paginas.js`);
    const opcoesSite = Sites.componentesDoSite(site.id);
    // scripts (integracoes + codigos/ do inquilino e do site): entram no hash, então mudar um refaz as páginas
    { const e = Codigos.validarIntegracoes(site.integracoes); if (e.length) throw new Error(`Site "${site.id}": ${e.join('; ')}`); }
    const codigos = Codigos.doSite(site, Inq.doSite(site) !== Inq.PADRAO ? Inq.doSite(site) : null);
    for (const [n, op] of Object.entries(opcoesSite)) { const er = Comp.validar(n, op, `sites-config/${site.id}/componentes/${n}.json`); if (er.length) throw new Error(er.join('; ')); }
    const baseHash = sha(JSON.stringify([RENDER_VERSION, tplHash(dirTpl), hashComponentes, opcoesSite, codigos, site.nome, site.slogan, site.url, site.cor, site.configuracoes, site.textos, site.fotosBase, site.cabecalho, site.rodape, site.lojas, nomesEstoque,
      paginasSite.filter((p) => p.rotulo).map((p) => [p.rotulo, p.caminho]), // links legais aparecem no rodapé das páginas de carro
      ...(site.rascunho ? ['rascunho'] : [])])); // só entra quando é rascunho: os sites definitivos não refazem nada por causa disso
    const estadoAnt = completo || efemero ? null : lerEstado(pasta, site.id);
    const incremental = !!estadoAnt && fs.existsSync(path.join(out, 'index.html'));
    if (!incremental) fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, LinkCarro.PASTA), { recursive: true });
    const baseMudou = !incremental || estadoAnt.base !== baseHash || todasPaginas;
    const mud = { escritos: [], removidos: [] };
    const rel = (p) => `${site.id}/${p}`;

    // core → motor/ (engine da versão do site + ui); tema → assets/ do tema na RAIZ (css/ js/ img/...); site → assets/
    const engine = fs.readFileSync(arqMotor, 'utf8').replace(/__VERSAO__/g, versao);
    escreverSe(path.join(out, 'motor', 'engine.js'), engine, rel('motor/engine.js'), mud);
    const arquivos = new Map();
    for (const [k, v] of listarArvore(C.UI)) arquivos.set(`motor/${k}`, v);
    for (const [k, v] of listarArvore(path.join(dirTpl, C.TEMA.assets), (r) => ['motor', 'assets', 'componentes'].includes(r))) arquivos.set(k, v);
    for (const [k, v] of listarArvore(C.assets(site.id))) arquivos.set(`assets/${k}`, v);
    for (const n of Comp.listar()) for (const ext of ['css', 'js']) { const f = path.join(C.COMPONENTES, n, `${n}.${ext}`); if (fs.existsSync(f)) arquivos.set(`componentes/${n}.${ext}`, f); }
    for (const [k, v] of arquivos) copiarSe(v, path.join(out, k), rel(k), mud);
    const estaticos = new Set(arquivos.keys()); // arquivos copiados (tema, assets, páginas livres): o que sumir da origem é apagado
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
    const escreverHtml = (arqRel, html) => escreverSe(path.join(out, arqRel), rascunho(versionar(Codigos.injetar(html, codigos), arqRel)), rel(arqRel), mud);
    // {{> nome}} inclui temas/<nome>/snippets/<nome>.html (cabeçalho, rodapé... escritos uma vez só)
    const parciais = (txt, nivel = 0) => txt.replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/g, (_, n) => {
      const arq = path.join(dirTpl, C.TEMA.snippets, `${n}.html`);
      if (!fs.existsSync(arq)) throw new Error(`Tema "${nomeTpl}": snippet "${n}" não existe (temas/${nomeTpl}/snippets/${n}.html)`);
      if (nivel > 5) throw new Error(`Tema "${nomeTpl}": snippets aninhados demais (${n})`);
      return parciais(fs.readFileSync(arq, 'utf8'), nivel + 1);
    });
    // LAYOUT (temas/<nome>/layout/tema.html; no Shopify, layout/theme.liquid): a moldura comum a todas as páginas.
    // Herança de templates do Mustache: o layout marca espaços com padrão ({{$head}}{{/head}}, {{$scripts}}...{{/scripts}})
    // e o template preenche só os que precisa. Template sem nenhum {{$...}} é o documento inteiro (sem layout).
    const pagina = (arquivo) => parciais(comLayout(fs.readFileSync(path.join(dirTpl, C.TEMA.templates, arquivo), 'utf8'), dirTpl, `temas/${nomeTpl}/templates/${arquivo}`));

    // DATA DE PUBLICAÇÃO de cada carro (ordenação "Data de publicação" do motor v4): a que veio no estoque ("publicado"),
    // ou o dia em que o carro apareceu no site pela primeira vez (guardado no estado; vale mesmo num build "completo")
    const entradasAnt = (lerEstado(pasta, site.id) || {}).entradas || {};
    const entradas = Object.fromEntries(carros.map((c) => [c.id, c.publicado ? String(c.publicado).slice(0, 16) : entradasAnt[c.id] || hoje]));

    // dados que o motor lê
    escreverSe(
      path.join(out, ARQ_ESTOQUE),
      // r = posição na ordem de exibição (ordenação "destaque" do motor); cr = carroceria
      // "formatoEstoque": "compacto" → dicionário + colunas (core/ui/formato-estoque.js; ~4x menor sem gzip); o navegador
      // desempacota para exatamente esta mesma lista antes de entregar ao motor (busca e filtros iguais)
      ((lista) => JSON.stringify(site.formatoEstoque === 'compacto' ? FormatoEstoque.compactar(lista) : lista))(
        carros.map((c, r) => ({ i: c.id, m: c.marca, o: c.modelo, v: c.versao, a: c.ano, p: c.preco, k: c.km, c: c.cor, b: c.cambio, f: c.combustivel, n: c.fotos, u: c.loja, cd: c.cidade, uf: c.uf, r, ...(c.carroceria ? { cr: c.carroceria } : {}), ...(c.link ? { l: c.link } : {}), dp: entradas[c.id] }))), // l = link vindo do estoque; dp = data de publicação
      rel(ARQ_ESTOQUE), mud
    );
    // nomes antigos (carros.json; estoque.xml, o feed XML que saiu da plataforma): apaga e despublica
    for (const velho of OBSOLETOS) if (fs.existsSync(path.join(out, velho))) { fs.rmSync(path.join(out, velho)); mud.removidos.push(rel(velho)); }
    const usadas = [...new Set(carros.map((c) => c.lojaId))].sort();
    escreverSe(
      path.join(out, 'config.json'),
      JSON.stringify({
        nome: site.nome, motor: versao, tema: nomeTpl, whatsapp: site.whatsapp, vendedores: site.vendedores || {},
        busca: site.busca !== false, filtros: site.filtros || null, ordenacao: site.ordenacao || null, total: carros.length,
        // aviso de cookies (core/ui/ui-site.js): link para a política de cookies, ou de privacidade, se o site tiver
        avisoCookies: site.avisoCookies === false ? null : {
          texto: textos.avisoCookies || AVISO_COOKIES_PADRAO,
          link: (() => { const p = paginasSite.find((x) => x.padrao === 'politica-de-cookies') || paginasSite.find((x) => x.padrao === 'politica-de-privacidade'); return p ? `${endPagina(p.caminho)}/` : ''; })(),
        },
        lojas: Object.fromEntries(usadas.map((id) => [id, { nome: lojas[id].nome, cidade: lojas[id].cidade, uf: lojas[id].uf, endereco: lojas[id].endereco || '', whatsapp: lojas[id].whatsapp || '' }])),
      }),
      rel('config.json'), mud
    );

    // números e listas do estoque que qualquer página/bloco pode usar (menu de cidades, marcas no rodapé, "1052 veículos"...)
    const contar = (k) => { const m = new Map(); for (const c of carros) if (c[k]) m.set(c[k], (m.get(c[k]) || 0) + 1); return [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR')); };
    const estoqueInfo = (r) => {
      const raizEstoque = r + `${CAMINHO_ESTOQUE}/`;
      // link de um filtro: a rota da listagem (/multipla/marca/Toyota; core/ui/rotas.js)
      const q = (k, v) => `${raizEstoque}${Rotas.montar([[k, v]])}`;
      return {
        total: carros.length, destaques: carros.filter((c) => c.destaque).length,
        // chave = valor sem acento/espaço, em minúsculas (para classes CSS: ic-utilitario, ic-suv...)
        ...Object.fromEntries([['marcas', 'marca'], ['cidades', 'cidade'], ['carrocerias', 'carroceria'], ['combustiveis', 'combustivel']].map(([nome, k]) =>
          [nome, contar(k).map(([v, n]) => ({ valor: v, total: n, link: q(k, v), chave: LinkCarro.parte(v).toLowerCase() }))])),
        lojas: Object.entries(lojas).map(([id, l]) => ({ id, ...l, total: carros.filter((c) => c.lojaId === id).length, link: q('loja', l.nome) })),
      };
    };
    const ctxSite = { base, temaCss: temaCss(configuracoes), fonteLink: fonteLink(configuracoes), motor: versao };
    // contexto de cada página: r = prefixo até a raiz do site ("", "../", "../../")
    const ctx = (r) => ({
      ...ctxSite, rel: r, configuracoes: configuracoesDaPagina(configuracoes, r),
      site: { nome: site.nome, slogan: site.slogan || '', url: site.url || '', textos,
        cabecalho: resolverLinks(cabecalho, r, paraPagina), rodape: resolverLinks(rodape, r, paraPagina),
        // páginas com "rotulo" (as padrão têm): para o rodapé de qualquer tema ({{#site.links}})
        links: paginasSite.filter((p) => p.rotulo && p.caminho).map((p) => ({ rotulo: p.rotulo, link: `${r}${endPagina(p.caminho)}/` })) },
      inicioUrl: r || './', estoqueUrl: r + `${CAMINHO_ESTOQUE}/`, estoque: estoqueInfo(r),
    });

    // ---- seções (temas/<nome>/secoes/<tipo>.html) ----
    const tplSecoes = new Map();
    const tplSecao = (tipo) => {
      if (!tplSecoes.has(tipo)) {
        const arq = path.join(dirTpl, C.TEMA.secoes, `${tipo}.html`);
        if (!/^[a-z0-9-]+$/.test(String(tipo)) || !fs.existsSync(arq)) throw new Error(`Site "${site.id}": seção "${tipo}" não existe no tema "${nomeTpl}" (temas/${nomeTpl}/secoes/${tipo}.html)`);
        tplSecoes.set(tipo, parciais(fs.readFileSync(arq, 'utf8')));
      }
      return tplSecoes.get(tipo);
    };
    const marcas = [...new Set(carros.map((c) => c.marca))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((m) => ({ valor: m }));
    // opções de preço/ano para formulários de busca: as mesmas configuradas nos filtros do site (precisam bater com o motor)
    const opcoesFiltro = (campo, fmt) => {
      const f = (site.filtros || []).find((x) => typeof x === 'object' && x.campo === campo && Array.isArray(x.opcoes));
      return f ? f.opcoes.map((v) => ({ valor: v, rotulo: fmt(v) })) : [];
    };
    // dados que o build acrescenta a alguns tipos de seção
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
    // usados: os componentes da página (para o build pôr o css/js deles); seção "componente" chama um componente
    const renderSecoes = (lista, r, usados = new Set(), onde = `Site "${site.id}"`) => (lista || []).map((b) => {
      if (b.tipo === 'componente') {
        usados.add(b.nome);
        return Comp.renderizar(b.nome, [{ origem: `sites-config/${site.id}/componentes/${b.nome}.json`, opcoes: opcoesSite[b.nome] }, { origem: `${onde}, seção componente`, opcoes: b.opcoes }], ctx(r), render, onde);
      }
      const d = resolverLinks(enriquecer(b, r), r, paraPagina);
      return render(tplSecao(b.tipo), { ...ctx(r), ...d, secao: d });
    }).join('\n');
    // página inteira: expande {{componente x}} do tema, renderiza, põe o css/js dos componentes usados e confere que
    // os ids que o motor usa não se repetem (ex.: dois componentes "estoque" na mesma página)
    const IDS_UNICOS = ['filtros', 'filtros-ativos', 'q', 'filtros-dinamicos', 'ord', 'contagem', 'grade', 'mais', 'limpar', 'copiar', 'tpl-card'];
    const renderPagina = (tpl, c, onde, usados = new Set(), pagina = {}) => {
      const { texto, usados: doTemplate } = Comp.expandir(tpl, c, render, { opcoesSite, onde, opcoesPagina: pagina.opcoes || {}, ondePagina: pagina.onde });
      doTemplate.forEach((x) => usados.add(x));
      let html = render(texto, c);
      if (usados.size) {
        const { css, js } = Comp.arquivosDe(usados);
        const links = css.map((f) => `<link rel="stylesheet" href="${c.rel}${f}">`).join('\n');
        const scripts = js.filter((f) => !html.includes(`${f}"`)).map((f) => `<script src="${c.rel}${f}"></script>`).join('\n');
        if (links) html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${links}\n</head>`) : `${links}\n${html}`;
        if (scripts) html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${scripts}\n</body>`) : `${html}\n${scripts}`;
      }
      for (const id of IDS_UNICOS) {
        const n = ((id === 'tpl-card' ? html : A_semModelos(html)).match(new RegExp(`\\bid="${id}"`, 'g')) || []).length;
        if (n > 1) throw new Error(`${onde}: o id "${id}" aparece ${n} vezes na página (dois componentes "estoque" ou "filtro" juntos, ou o tema já tem esse elemento além do componente)`);
      }
      return html;
    };

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
    const tplLista = pagina('multipla.html');
    const raizUrlSite = site.url ? site.url.replace(/\/$/, '') : '';
    // listagem: só /multipla/ (os filtros são parâmetros: ?marca=Toyota)
    const listagens = [{ caminho: caminhoEstoque, filtro: null }];
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
      const usados = new Set();
      const ondeL = `Site "${site.id}", temas/${nomeTpl}/templates/multipla.html`;
      const html = renderPagina(tplLista, {
        ...ctx(r), listagem, secoesAntes: renderSecoes(cfgEstoque.secoesAntes, r, usados, ondeL), secoesDepois: renderSecoes(cfgEstoque.secoesDepois, r, usados, ondeL),
      }, ondeL, usados, { opcoes: cfgEstoque.componentes, onde: `sites-config/${site.id}/web/multipla.json` });
      datar(arqRel, escreverHtml(arqRel, comCards(comBaseDaRota(html), lista, r)));
    }
    // páginas de conteúdo
    const tplPagina = pagina('pagina.html');
    const tplHome = pagina('home.html'); // a página principal tem moldura própria
    for (const p of paginasSite) {
      const dirP = endPagina(p.caminho); // '' (home) ou paginas/<caminho>
      const r = prefixo(dirP);
      const arqRel = dirP ? `${dirP}/index.html` : 'index.html';
      geradas.push(arqRel);
      const canon = site.url ? `<link rel="canonical" href="${esc(site.url.replace(/\/$/, ''))}/${dirP ? esc(url(dirP)) + '/' : ''}">` : '';
      if (p.livre) {
        // página do designer: variáveis {{ }} (se usar), links "/x" relativos, e moldura do site ou só o essencial
        let html;
        try { html = PL.linksRelativos(render(fs.readFileSync(p.livre.arquivo, 'utf8'), ctx(r)), r, paraPagina); }
        catch (e) { throw new Error(`Página livre ${p.livre.onde}: ${e.message}`); }
        const final = p.livre.semMoldura ? PL.completarLivre(html, r, { titulo: p.titulo, descricao: p.descricao, canon })
          : renderPagina(tplPagina, { ...ctx(r), pagina: { titulo: p.titulo, descricao: p.descricao || site.slogan || '' }, canon, conteudo: html, temListagem: false }, `Página livre ${p.livre.onde}`);
        for (const [k, v] of p.livre.assets) if (/\.(css|js)$/.test(k)) versoes.set(`${dirP}/${k}`, sha(fs.readFileSync(v)).slice(0, 8));
        datar(arqRel, escreverHtml(arqRel, final));
        for (const [k, v] of p.livre.assets) { const destino = `${dirP}/${k}`; copiarSe(v, path.join(out, destino), rel(destino), mud); estaticos.add(destino); }
        continue;
      }
      const nListagem = p.secoes.filter((b) => b.tipo === 'listagem').length;
      if (nListagem > 1) throw new Error(`Site "${site.id}", página "${p.caminho || '(raiz)'}": só pode ter uma seção "listagem"`);
      const usados = new Set();
      const ondeP = `Site "${site.id}", página "${p.caminho || '(home)'}"`;
      const conteudo = renderSecoes(p.secoes, r, usados, ondeP);
      const htmlP = renderPagina(p.caminho ? tplPagina : tplHome, {
        ...ctx(r), pagina: { titulo: p.titulo || site.nome, descricao: p.descricao || site.slogan || '' }, canon, conteudo,
        temListagem: nListagem > 0, // seção "listagem" do tema: o tema carrega o motor (componentes trazem o deles)
      }, ondeP, usados);
      // componente "estoque" na página: os primeiros cards já saem no HTML (Google e quem está sem JS)
      datar(arqRel, escreverHtml(arqRel, usados.has('estoque') ? comCards(htmlP, carros, r) : htmlP));
    }
    // 404.html: a hospedagem devolve esta página em QUALQUER endereço que não existe (/carros/a/b/c.html, /x/y/), então
    // os links dela partem da raiz do domínio ("/css/...", "/multipla/"), não da pasta. Fica fora do sitemap (noindex).
    {
      const p = site.pagina404 || PAGINA_404_PADRAO;
      if (p.blocos !== undefined) throw new Error(`Site "${site.id}": "pagina404": "blocos" agora se chama "secoes" (node ferramentas/migrar-temas.js)`);
      if (!Array.isArray(p.secoes)) throw new Error(`Site "${site.id}": "pagina404" precisa de "secoes" (lista)`);
      const usados = new Set();
      escreverHtml('404.html', renderPagina(tplPagina, {
        ...ctx('/'), pagina: { titulo: `${p.titulo || PAGINA_404_PADRAO.titulo} | ${site.nome}`, descricao: '' },
        canon: '<meta name="robots" content="noindex">', conteudo: renderSecoes(p.secoes, '/', usados, `Site "${site.id}", 404`), temListagem: false,
      }, `Site "${site.id}", 404`, usados));
    }
    // arquivo copiado que não existe mais na origem (imagem tirada da página do designer, css removido do template...)
    for (const arq of (incremental && estadoAnt.estaticos) || []) {
      if (estaticos.has(arq)) continue;
      fs.rmSync(path.join(out, arq), { force: true });
      mud.removidos.push(rel(arq));
      for (let d = path.dirname(path.join(out, arq)); d.startsWith(out + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch (e) { break; } }
    }
    // página que saiu do site.json (ou listagem que mudou de lugar): apaga
    // Páginas de conteúdo SÓ existem em /paginas/: o build nunca gera nada delas fora dali (decisão do Wellington).
    // Endereço antigo de página (/contato/, /lojas, /sobre/nos/ — de antes da mudança para /paginas/ ou do site antigo
    // do Revenda Mais) é redirecionado com 301 pela HOSPEDAGEM (infra/cloudfront/roteador.js), sem arquivo no site.
    // Limpeza: os redirecionamentos em HTML que versões anteriores do build deixaram na raiz saem (e são despublicados).
    for (const velho of Object.keys((incremental && estadoAnt.paginasMovidas) || {})) {
      if (geradas.includes(velho) || !fs.existsSync(path.join(out, velho))) continue;
      fs.rmSync(path.join(out, velho), { force: true });
      mud.removidos.push(rel(velho));
      for (let d = path.dirname(path.join(out, velho)); d.startsWith(out + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch (e) { break; } }
    }
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
      datar(link, escreverHtml(link, renderPagina(tplCarro, { ...ctx(relDe(link)), carro, og }, `Site "${site.id}", temas/${nomeTpl}/templates/carro.html`)));
    }

    // sitemap e robots: é por aqui que o Google descobre as páginas dos carros (a listagem é montada por JS)
    if (raizUrl) {
      // reconstrói o sitemap com as páginas e os carros desta reconstrução (a mesma função de gerarSitemap(dominio))
      escreverSe(path.join(out, 'sitemap.xml'), Sitemap.montarSitemap(site, { paginas: geradas, links, datas }), rel('sitemap.xml'), mud);
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
      escreverHtml(v.link, renderPagina(tplVendido, { ...ctx(relDe(v.link)), carro: { id, titulo: titulos[id] } }, `Site "${site.id}", temas/${nomeTpl}/templates/vendido.html`));
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
      escreverSe(path.join(out, velho), htmlRedirecionamento(para, abs, 'Este anúncio mudou de endereço'), rel(velho), mud);
      redir++;
    }

    if (!efemero) {
      gravarEstado(pasta, site.id, { render: RENDER_VERSION, base: baseHash, carros: hashes, entradas, links, titulos, vendidos, redirecionados, paginas: geradas, datas, estaticos: [...estaticos].sort(), em: new Date().toISOString() });
      registrarPendente(pasta, site.id, mud, !incremental);
    }

    const resumo = { novos, alterados, saiu, inalterados, escritos: mud.escritos.length, removidos: mud.removidos.length, completo: !incremental, base: incremental && baseMudou };
    const kb = (fs.statSync(path.join(out, ARQ_ESTOQUE)).size / 1024).toFixed(0);
    const detalhe = !incremental ? 'gerado do zero'
      : resumo.base ? `visual/config mudou: ${carros.length} páginas refeitas`
      : mud.escritos.length || mud.removidos.length ? `+${novos} novos ~${alterados} alterados -${saiu} saíram${redir ? ` · ${redir} link(s) antigo(s) redirecionando` : ''} · ${mud.escritos.length} arquivo(s) escrito(s)`
      : 'sem mudanças';
    console.log(`${site.id}: ${carros.length} carros · ${detalhe} · tema ${nomeTpl} · motor ${versao} · ${ARQ_ESTOQUE} ${kb} KB`);
    feitos.push({ site, total: carros.length, motor: versao, tema: nomeTpl, resumo });
  }

  atualizarIndice(pasta);
  // sites-config é a base: pasta na saída sem site na fonte é sobra (cópia manual, site antigo) e não deve ir para o ar
  if (!sites) for (const o of sobrasNaSaida(pasta)) console.warn(`  aviso: ${pasta}/${o}/ não tem site em sites-config/ (sobra). Para apagar: node core/cli.js limpar-public --aplicar`);
  return { pasta, feitos };
}

// <saida>/index.html: índice só para navegar entre os sites durante o desenvolvimento (não é publicado). Refeito pelo
// build e quando um site sai (core/operacoes.js), para nunca listar site que não existe mais.
function atualizarIndice(pasta = C.PUBLICO) {
  const DIST = C.saida(pasta);
  if (!fs.existsSync(DIST)) return;
  const presentes = Sites.carregarTodos().filter((s) => fs.existsSync(path.join(DIST, s.id, 'index.html')));
  const arq = path.join(DIST, 'index.html');
  const tmp = `${arq}.${process.pid}.tmp`; // vários trabalhadores podem escrever ao mesmo tempo: troca atômica
  fs.writeFileSync(tmp,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sites</title>` +
      `<body style="font:16px system-ui;max-width:600px;margin:2rem auto;padding:0 1rem"><h1>Sites gerados</h1><ul>` +
      presentes.map((s) => `<li><a href="${esc(s.id)}/index.html">${esc(s.nome)}</a> &middot; ${esc(s.id)} &middot; tema ${esc(s.tema)}</li>`).join('') +
      `</ul></body>`);
  fs.renameSync(tmp, arq);
}

// pastas da saída que não correspondem a nenhum site de sites-config (sites-config é a base de tudo que é gerado)
function sobrasNaSaida(pasta = C.PUBLICO) {
  const DIST = C.saida(pasta);
  if (!fs.existsSync(DIST)) return [];
  const sitesFonte = new Set(Sites.listar());
  return fs.readdirSync(DIST, { withFileTypes: true }).filter((e) => e.isDirectory() && !sitesFonte.has(e.name)).map((e) => e.name).sort();
}

module.exports = { ARQ_ESTOQUE, paraFiltro, sobrasNaSaida, atualizarIndice, construir, render, resolverLinks, problemasProducao, registrarPendente, VERSAO_HTML };

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
