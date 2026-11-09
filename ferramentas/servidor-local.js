#!/usr/bin/env node
// Servidor local dos sites gerados, com as MESMAS regras da hospedagem (infra/cloudfront/roteador.js): rotas da listagem
// (/multipla/marca/Toyota → multipla/index.html), barra final, "//", 301 de páginas antigas para /paginas/ e 404.html do site.
// Substitui o "python3 -m http.server", que não sabe reescrever endereço (as rotas dariam 404).
//   node ferramentas/servidor-local.js [porta=8080] [pasta=sites-public]   →  http://localhost:8080/<dominio>/
const http = require('http');
const fs = require('fs');
const path = require('path');
const Roteador = require('../infra/cloudfront/roteador.js');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

function criar(pasta) {
  const raiz = path.resolve(pasta);
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://local');
    const [, dominio, ...resto] = u.pathname.split('/');
    // raiz do servidor (índice dos sites) e arquivos soltos de sites-public/
    if (!dominio || !fs.existsSync(path.join(raiz, dominio)) || !fs.statSync(path.join(raiz, dominio)).isDirectory()) {
      const f = path.join(raiz, dominio ? decodeURIComponent(u.pathname) : 'index.html');
      if (f.startsWith(raiz) && fs.existsSync(f) && fs.statSync(f).isFile()) return enviar(res, 200, f);
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404');
    }
    // o resto do endereço passa pela função de borda, como no CloudFront (cada site é a raiz do próprio domínio)
    const qs = {};
    for (const [k, v] of u.searchParams) qs[k] = { value: encodeURIComponent(v) };
    const r = Roteador.handler({ request: { uri: '/' + resto.join('/'), querystring: qs, headers: { host: { value: dominio } } } });
    if (r.statusCode) {
      const loc = r.headers && r.headers.location && r.headers.location.value;
      res.writeHead(r.statusCode, loc ? { location: `/${dominio}${loc}` } : {});
      return res.end();
    }
    let f;
    try { f = path.join(raiz, dominio, decodeURIComponent(r.uri)); } catch (e) { res.writeHead(400); return res.end(); }
    if (f.startsWith(path.join(raiz, dominio) + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return enviar(res, 200, f);
    const p404 = path.join(raiz, dominio, '404.html');
    if (fs.existsSync(p404)) return enviar(res, 404, p404);
    res.writeHead(404); res.end();
  });
}
function enviar(res, status, f) {
  res.writeHead(status, { 'content-type': TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

if (require.main === module) {
  const porta = +process.argv[2] || 8080;
  const pasta = process.argv[3] || path.join(__dirname, '..', 'sites-public');
  process.on('SIGTERM', () => process.exit(0)); // encerra limpo (Ctrl+C, kill, docker stop)
  criar(pasta).listen(porta, () => console.log(`sites em http://localhost:${porta}/<dominio>/  (pasta ${pasta}; regras de infra/cloudfront/roteador.js)`));
}
module.exports = { criar };
