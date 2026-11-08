// Páginas livres dos web designers: HTML normal, sem JSON, sem mexer no core.
//
//   sites/<dominio>/paginas/            páginas SÓ deste site
//   templates/<nome>/paginas-extras/    páginas de TODOS os sites do template
//
// Formatos (o designer escolhe):
//   feirao.html                         → /feirao/
//   feirao/index.html + imagens, css…   → /feirao/ (os arquivos da pasta vão junto: dá para abrir o index.html direto
//                                          no navegador e ver igual ao site)
//   promocoes/feirao/index.html         → /promocoes/feirao/
//
// O que o build faz sozinho:
//   - só o conteúdo (sem <html>)  → entra no cabeçalho/rodapé do site (paginas/pagina.html do template)
//   - documento completo (<html>) → página livre; o build só acrescenta o essencial (viewport, aviso de cookies)
//   - links começando com "/" (href="/multipla/") viram relativos: funciona em qualquer hospedagem e no teste local
//   - título: <title>, senão o primeiro <h1>, senão o nome do arquivo. Descrição: <meta name="description">
//   - {{site.nome}}, {{estoque.total}}, {{#estoque.marcas}}… funcionam, se o designer quiser usar
// Comentários opcionais no começo do arquivo:
//   <!-- titulo: Feirão de Novembro -->  <!-- descricao: ... -->  <!-- rotulo: Feirão -->  (rotulo = link no rodapé)
//   <!-- moldura: nenhuma -->  (força página livre mesmo sem <html>)   <!-- moldura: site --> (força cabeçalho/rodapé)
const fs = require('fs');
const path = require('path');

const ehPagina = (n) => n.endsWith('.html');

// lê uma pasta de páginas livres → [{ caminho, arquivo, assets: Map(rel → absoluto) }]
function lerPaginasLivres(raiz) {
  const paginas = [];
  if (!fs.existsSync(raiz)) return paginas;
  const andar = (dir, prefixo) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isFile() && ehPagina(e.name) && e.name !== 'index.html') {
        paginas.push({ caminho: prefixo + e.name.replace(/\.html$/, ''), arquivo: abs, assets: new Map() });
      } else if (e.isDirectory()) {
        const caminho = prefixo + e.name;
        if (fs.existsSync(path.join(abs, 'index.html'))) {
          paginas.push({ caminho, arquivo: path.join(abs, 'index.html'), assets: arquivosDaPasta(abs) });
        }
        andar(abs, `${caminho}/`); // subpastas podem ter outras páginas (promocoes/feirao/)
      }
    }
  };
  andar(raiz, '');
  return paginas;
}

// arquivos de uma página-pasta (menos o index.html e menos subpastas que são outras páginas)
function arquivosDaPasta(dir, prefixo = '', m = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!fs.existsSync(path.join(abs, 'index.html'))) arquivosDaPasta(abs, `${prefixo}${e.name}/`, m); }
    else if (!(prefixo === '' && e.name === 'index.html') && !(prefixo === '' && ehPagina(e.name))) m.set(prefixo + e.name, abs);
  }
  return m;
}

const semTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const desfazer = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const humanizar = (caminho) => { const n = caminho.split('/').pop().replace(/-/g, ' '); return n.charAt(0).toUpperCase() + n.slice(1); };

// metadados: comentários opcionais > <title>/<meta>/<h1> > nome do arquivo
function metadados(html, caminho) {
  const com = (k) => { const m = html.match(new RegExp(`<!--\\s*${k}\\s*:\\s*([\\s\\S]*?)\\s*-->`, 'i')); return m ? m[1].trim() : ''; };
  const completo = /<html[\s>]/i.test(html);
  const moldura = com('moldura').toLowerCase();
  return {
    titulo: com('titulo') || desfazer(semTags((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')) || desfazer(semTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')) || humanizar(caminho),
    descricao: com('descricao') || desfazer((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1] || ''),
    rotulo: com('rotulo'),
    livre: moldura ? moldura === 'nenhuma' : completo, // sem comentário: documento completo = livre; só conteúdo = com moldura
  };
}

// href="/multipla/" → href="../multipla/" (relativo à página), também src= e srcset=
function linksRelativos(html, rel) {
  const ajusta = (u) => (u.startsWith('/') && !u.startsWith('//') ? (rel || './') + u.slice(1) : u);
  return html
    .replace(/\b(href|src|action|poster)=(["'])(\/[^"']*)\2/gi, (_, a, q, u) => `${a}=${q}${ajusta(u)}${q}`)
    .replace(/\bsrcset=(["'])([^"']*)\1/gi, (_, q, v) => `srcset=${q}${v.split(',').map((p) => p.trim().replace(/^\S+/, ajusta)).join(', ')}${q}`);
}

// página livre: só acrescenta o que falta e é essencial. Se o designer mandou só um pedaço de HTML com
// "moldura: nenhuma", monta um documento mínimo em volta (sem isso a página sairia sem charset, título e aviso de cookies)
function completarLivre(html, rel, { titulo = '', descricao = '' } = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let h = /<html[\s>]/i.test(html) ? html
    : `<!doctype html>\n<html lang="pt-BR">\n<head>\n<title>${esc(titulo)}</title>${descricao ? `\n<meta name="description" content="${esc(descricao)}">` : ''}\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
  if (!/<head[\s>]/i.test(h)) h = h.replace(/<html[^>]*>/i, (m) => `${m}\n<head></head>`);
  if (!/<body[\s>]/i.test(h)) h = h.replace(/<\/head>/i, '</head>\n<body>').replace(/<\/html>/i, '</body>\n</html>');
  if (!/<meta[^>]+charset/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => `${m}\n<meta charset="utf-8">`);
  if (!/<meta[^>]+name="viewport"/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => `${m}\n<meta name="viewport" content="width=device-width,initial-scale=1">`);
  if (!/<html[^>]*\blang=/i.test(h)) h = h.replace(/<html/i, '<html lang="pt-BR"');
  if (!/<body[^>]*data-rel=/i.test(h)) h = h.replace(/<body([^>]*)>/i, `<body$1 data-rel="${rel}">`);
  if (!/motor\/ui-site\.js/.test(h)) h = h.replace(/<\/body>/i, `<script src="${rel}motor/ui-site.js"></script>\n</body>`); // aviso de cookies (LGPD)
  return h;
}

module.exports = { lerPaginasLivres, metadados, linksRelativos, completarLivre };
