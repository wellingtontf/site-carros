// Navegador de verdade (Chrome headless): a parte que roda no cliente — listagem montada por JS, filtros pela URL,
// botão de WhatsApp, página do carro — em TODOS os templates. Pula sozinho se não houver Chrome/Chromium instalado.
const A = require('./ajuda');
const raiz = A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const { construir } = require('../core/build.js');
const L = require('../core/ui/link-carro.js');

const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', process.env.CHROME].filter(Boolean)
  .find((c) => { try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch (e) { return false; } });
const pular = process.env.SEM_NAVEGADOR ? 'SEM_NAVEGADOR definido (npm run test:rapido)' : !CHROME && 'Chrome/Chromium não encontrado (defina CHROME=/caminho)';
const templates = fs.readdirSync(path.join(A.PROJETO, 'templates'));
const TOTAL = 30;

let srv, base;
before(async () => {
  if (pular) return;
  for (const t of templates) {
    const carros = Array.from({ length: TOTAL }, (_, i) => A.carro({ marca: i % 3 ? 'Toyota' : 'Honda', modelo: i % 3 ? 'Corolla' : 'Civic', loja: i % 2 ? 'sul' : 'centro', ordem: TOTAL - i }));
    A.criarSite(`${t}.teste.com.br`, { carros, site: { template: t, fotosBase: '' } });
  }
  A.silencioso(() => construir({}));
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
  srv = http.createServer((req, res) => {
    let p = path.join(raiz, 'dist', decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(path.join(raiz, 'dist')) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': tipos[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  }).listen(0);
  await new Promise((ok) => srv.on('listening', ok));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv && srv.close());

// abre a página, espera o JS rodar e devolve o DOM final + erros de JS do console.
// Assíncrono de propósito: o servidor de arquivos roda neste mesmo processo (spawnSync travaria os dois).
let perfil = 0;
function abrir(url) {
  return new Promise((ok, falha) => {
    const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--virtual-time-budget=5000',
      '--enable-logging=stderr', '--v=0', `--user-data-dir=${path.join(raiz, `perfil-${perfil++}`)}`, '--dump-dom', url]);
    let dom = '', err = '';
    p.stdout.on('data', (d) => (dom += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => { p.kill('SIGKILL'); falha(new Error(`Chrome demorou demais em ${url}`)); }, 45000);
    p.on('close', () => { clearTimeout(t); ok({ dom, erros: err.split('\n').filter((l) => /CONSOLE.*(Uncaught|Error)|Uncaught/.test(l)) }); });
  });
}
const cards = (dom) => (semModelo(dom).match(/class="card[" ]/g) || []).length;
const semModelo = (dom) => dom.replace(/<script type="text\/html"[\s\S]*?<\/script>/g, '');

for (const t of templates) {
  const id = `${t}.teste.com.br`;

  test(`[${t}] /multipla: o JS monta os cards, conta e não dá erro`, { skip: pular }, async () => {
    const { dom, erros } = await abrir(`${base}/${id}/multipla/`);
    assert.deepEqual(erros, [], 'erros de JavaScript no console');
    assert.equal(cards(dom), Math.min(24, TOTAL), 'primeira página de cards');
    assert.match(dom, new RegExp(`${TOTAL} carros`), 'contagem');
    assert.match(dom, /<select id="f-marca"/, 'filtro de marca montado');
    const href = semModelo(dom).match(/class="card[^"]*" href="([^"]+)"|<a class="card-foto" href="([^"]+)"/);
    assert.ok(href, 'card com link');
    const alvo = (href[1] || href[2]).replace(/^\.\.\//, '');
    assert.ok(fs.existsSync(path.join(raiz, 'dist', id, alvo)), `link do card aponta para página que existe: ${alvo}`);
  });

  test(`[${t}] /multipla?marca=Honda: filtro vindo do link é aplicado`, { skip: pular }, async () => {
    const { dom } = await abrir(`${base}/${id}/multipla/?marca=Honda`);
    assert.match(dom, /10 carros/);
    assert.equal(cards(dom), 10);
  });

  test(`[${t}] página fixa /multipla/marca/honda/: depois do JS continua só com a marca dela`, { skip: pular }, async () => {
    const { dom, erros } = await abrir(`${base}/${id}/multipla/marca/honda/`);
    assert.deepEqual(erros, []);
    assert.match(dom, /10 carros/);
    assert.equal(cards(dom), 10);
  });

  test(`[${t}] página do carro: botão de WhatsApp com o número da loja e a referência do carro`, { skip: pular }, async () => {
    const c = JSON.parse(fs.readFileSync(path.join(raiz, 'sites', id, 'estoque.json'), 'utf8')).carros[0];
    const loja = A.LOJAS[c.loja];
    const { dom, erros } = await abrir(`${base}/${id}/${L.caminho({ ...c, cidade: loja.cidade, uf: loja.uf })}`);
    assert.deepEqual(erros, []);
    const zap = dom.match(/id="zap"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*id="zap"/);
    assert.ok(zap, 'botão #zap');
    const u = zap[1] || zap[2];
    assert.match(u, new RegExp(`^https://wa\\.me/${loja.whatsapp || '5511999999999'}\\?text=`));
    assert.ok(decodeURIComponent(u).includes(c.id), 'mensagem cita a referência do carro');
  });

  test(`[${t}] aviso de cookies aparece (com link para a política) e o contato tem o formulário`, { skip: pular }, async () => {
    const { dom, erros } = await abrir(`${base}/${id}/contato/`);
    assert.deepEqual(erros, []);
    assert.match(dom, /class="aviso-cookies"/, 'aviso de cookies');
    assert.match(dom, /href="\.\.\/politica-de-cookies\/"[^>]*>Saiba mais/);
    assert.match(dom, /class="b-form-campos js-form-zap"/);
  });

  test(`[${t}] home: abre sem erro de JS`, { skip: pular }, async () => {
    const { erros, dom } = await abrir(`${base}/${id}/`);
    assert.deepEqual(erros, []);
    assert.ok(cards(dom) >= 1, 'vitrine da home com carros');
  });
}
