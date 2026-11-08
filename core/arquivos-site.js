// Arquivos próprios de um site (sites-config/<dominio>/assets/: logo, favicon, banners, fontes) e páginas
// (sites-config/<dominio>/web/: index.json = home, multipla.json = listagem, paginas/ = páginas de conteúdo), gravados por quem não mexe no disco: a API. O build copia/gera como sempre.
//
// Arquivos: o tipo é conferido pelo CONTEÚDO (os primeiros bytes), não só pelo nome: um "logo.png" que é um HTML ou um
// executável é recusado. SVG passa só sem código (script, on*=, javascript:, foreignObject...): ele é servido no domínio
// da loja, e um SVG com script rodaria no navegador do visitante como se fosse o site.
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');
const Sites = require('./sites');
const PL = require('./paginas-livres');

const MAX_ARQUIVO = 10 * 1024 * 1024;
const NOME_OK = /^([a-z0-9][a-z0-9._-]*\/){0,3}[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp|gif|avif|svg|ico|woff2?)$/;
const PAGINA_OK = /^([a-z0-9][a-z0-9-]*)(\/[a-z0-9][a-z0-9-]*)*$/;
const RESERVADAS = new Set(['carro', 'carros', 'paginas', 'multipla', 'motor', 'css', 'js', 'img', 'assets']);
const ini = (b, ...bytes) => bytes.every((x, i) => b[i] === x);
const texto = (b, de, s) => b.slice(de, de + s.length).toString('latin1') === s;
const CONFERE = {
  png: (b) => ini(b, 0x89, 0x50, 0x4e, 0x47),
  jpg: (b) => ini(b, 0xff, 0xd8, 0xff),
  jpeg: (b) => ini(b, 0xff, 0xd8, 0xff),
  gif: (b) => texto(b, 0, 'GIF8'),
  webp: (b) => texto(b, 0, 'RIFF') && texto(b, 8, 'WEBP'),
  avif: (b) => texto(b, 4, 'ftyp') && /^avi[fs]$/.test(b.slice(8, 12).toString('latin1')),
  ico: (b) => ini(b, 0x00, 0x00, 0x01, 0x00),
  woff: (b) => texto(b, 0, 'wOFF'),
  woff2: (b) => texto(b, 0, 'wOF2'),
  svg: (b) => /<svg[\s>]/i.test(b.slice(0, 4096).toString('utf8')),
};

function validarArquivo(nome, buf) {
  if (!NOME_OK.test(String(nome)) || nome.includes('..')) return [`nome inválido "${nome}" (minúsculas, números, . - _ e até 3 pastas; extensões: png, jpg, webp, gif, avif, svg, ico, woff, woff2)`];
  if (!buf.length) return ['arquivo vazio'];
  if (buf.length > MAX_ARQUIVO) return ['arquivo grande demais (máx. 10 MB)'];
  const ext = nome.split('.').pop();
  if (!CONFERE[ext](buf)) return [`o conteúdo não é ${ext.toUpperCase()} (confira o arquivo)`];
  if (ext === 'svg' && /<script|\bon[a-z]+\s*=|javascript:|<foreignObject|<iframe|<embed|<object|<use[^>]+href\s*=\s*["']?https?:/i.test(buf.toString('utf8')))
    return ['SVG com código (script, eventos on*, javascript:, objetos externos) não é aceito'];
  return [];
}
const arqAsset = (d, nome) => path.join(C.assets(d), nome);
function gravarAsset(d, nome, buf) {
  const arq = arqAsset(d, nome);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, buf);
  fs.renameSync(`${arq}.tmp`, arq);
}
function removerAsset(d, nome) {
  if (!NOME_OK.test(String(nome)) || !fs.existsSync(arqAsset(d, nome))) return false;
  fs.rmSync(arqAsset(d, nome));
  for (let dir = path.dirname(arqAsset(d, nome)); dir.startsWith(C.assets(d) + path.sep); dir = path.dirname(dir)) { try { fs.rmdirSync(dir); } catch (e) { break; } }
  return true;
}
function listarAssets(d) {
  const r = [];
  const andar = (dir, pre) => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(dir, e.name); if (e.isDirectory()) andar(p, `${pre}${e.name}/`); else r.push({ nome: pre + e.name, bytes: fs.statSync(p).size }); } };
  andar(C.assets(d), '');
  return r;
}

// ---------- páginas ----------
// nome "index" = a home (só como página de seções). Formatos: "secoes" (<nome>.json) e "html" (<nome>.html)
function validarNomePagina(nome) {
  if (nome === 'index') return [];
  if (!PAGINA_OK.test(String(nome))) return [`nome de página inválido "${nome}" (minúsculas, números, hífen e /; "index" é a home)`];
  if (RESERVADAS.has(nome.split('/')[0])) return [`"${nome.split('/')[0]}" é reservado`];
  return [];
}
// "index" (a home) = web/index.json; o resto em web/paginas/
const arqPagina = (d, nome, formato) => (nome === 'index' ? (formato === 'html' ? path.join(C.web(d), 'index.html') : C.home(d))
  : path.join(C.paginasLivresSite(d), `${nome}.${formato === 'html' ? 'html' : 'json'}`));
function listarPaginas(d) {
  const raiz = C.paginasLivresSite(d);
  const json = PL.paginasJsonDoSite(C, d).map((p) => ({ nome: p.caminho || 'index', formato: 'secoes' }));
  const html = PL.lerPaginasLivres(raiz).map((p) => ({ nome: p.caminho, formato: p.assets.size || path.basename(p.arquivo) === 'index.html' ? 'html (pasta)' : 'html' }));
  return [...json, ...html].map((p) => ({ ...p, endereco: p.nome === 'index' ? '/' : `/paginas/${p.nome}/` })).sort((a, b) => a.nome.localeCompare(b.nome));
}
function lerPagina(d, nome) {
  if (fs.existsSync(arqPagina(d, nome, 'secoes'))) return { formato: 'secoes', conteudo: JSON.parse(fs.readFileSync(arqPagina(d, nome, 'secoes'), 'utf8')) };
  if (fs.existsSync(arqPagina(d, nome, 'html'))) return { formato: 'html', conteudo: fs.readFileSync(arqPagina(d, nome, 'html'), 'utf8') };
  return null;
}
// grava a página; o outro formato de mesmo nome sai (senão o build acusaria página duplicada)
function gravarPagina(d, nome, formato, conteudo) {
  if (nome === 'index' && formato === 'html') throw new Error('a home (index) é página de seções (web/index.json)');
  const pastaPagina = path.join(C.paginasLivresSite(d), nome);
  if (fs.existsSync(path.join(pastaPagina, 'index.html'))) throw Object.assign(new Error(`a página "${nome}" é uma pasta do designer (${nome}/index.html com arquivos): apague a pasta antes de gravar pela API`), { conflito: true });
  const arq = arqPagina(d, nome, formato);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, formato === 'html' ? conteudo : JSON.stringify(conteudo, null, 2) + '\n');
  fs.renameSync(`${arq}.tmp`, arq);
  fs.rmSync(arqPagina(d, nome, formato === 'html' ? 'secoes' : 'html'), { force: true });
}
function removerPagina(d, nome) {
  let saiu = false;
  for (const f of ['secoes', 'html']) if (fs.existsSync(arqPagina(d, nome, f))) { fs.rmSync(arqPagina(d, nome, f)); saiu = true; }
  return saiu;
}

// listagem do estoque (/multipla/): web/multipla.json
const lerMultipla = (d) => { const t = fs.existsSync(C.multipla(d)) ? fs.readFileSync(C.multipla(d), 'utf8').trim() : ''; return t ? JSON.parse(t) : null; }; // vazio = sem configuração
function gravarMultipla(d, conteudo) {
  fs.mkdirSync(C.web(d), { recursive: true });
  fs.writeFileSync(`${C.multipla(d)}.tmp`, JSON.stringify(conteudo, null, 2) + '\n');
  fs.renameSync(`${C.multipla(d)}.tmp`, C.multipla(d));
}
const removerMultipla = (d) => { if (!fs.existsSync(C.multipla(d))) return false; fs.rmSync(C.multipla(d)); return true; };

const Codigos = require('./codigos');
module.exports = { lerCodigo: Codigos.lerSite, gravarCodigo: Codigos.gravarSite, removerCodigo: Codigos.removerSite, validarCodigo: Codigos.validarCodigo, lerMultipla, gravarMultipla, removerMultipla, validarMultipla: Sites.validarMultipla, validarArquivo, gravarAsset, removerAsset, listarAssets, MAX_ARQUIVO, validarNomePagina, listarPaginas, lerPagina, gravarPagina, removerPagina, validarPagina: Sites.validarPagina };
