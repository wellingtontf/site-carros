// Ajudas dos testes: pasta de dados temporária, sites de mentira, leitura da saída e verificações de HTML.
// Cada arquivo de teste roda num processo próprio (node --test): chame prepararRaiz() ANTES de require('../core/...').
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJETO = path.resolve(__dirname, '..');
let RAIZ = null;

// cria uma pasta de dados vazia (sites-config/, config/) com os templates reais + o template "teste", e aponta o core para ela
function prepararRaiz() {
  RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'site-carros-teste-'));
  for (const d of ['sites-config', 'config', 'templates']) fs.mkdirSync(path.join(RAIZ, d));
  for (const t of fs.readdirSync(path.join(PROJETO, 'templates'))) fs.symlinkSync(path.join(PROJETO, 'templates', t), path.join(RAIZ, 'templates', t));
  fs.symlinkSync(path.join(__dirname, 'fixtures', 'templates', 'teste'), path.join(RAIZ, 'templates', 'teste'));
  process.env.SITE_CARROS_RAIZ = RAIZ;
  process.on('exit', () => { try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch (e) { /* tanto faz */ } });
  return RAIZ;
}
const raiz = () => RAIZ;

// apaga sites, saída e estado (entre um teste e outro)
function limpar() {
  for (const d of ['sites-config', 'sites-public', 'dist-teste', 'dist-preview', '.estado', 'config']) fs.rmSync(path.join(RAIZ, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(RAIZ, 'sites-config'));
  fs.mkdirSync(path.join(RAIZ, 'config'));
}

let seq = 0;
function carro(extra = {}) {
  seq++;
  return {
    id: `T${String(seq).padStart(4, '0')}`, marca: 'Toyota', modelo: 'Corolla', versao: 'XEi 2.0', ano: 2022,
    preco: 100000 + seq, km: 10000 + seq, cor: 'Prata', cambio: 'Automático', combustivel: 'Flex', fotos: 2,
    opcionais: ['Ar-condicionado'], descricao: 'Carro de teste.', loja: 'centro', ...extra,
  };
}
const LOJAS = {
  centro: { nome: 'Loja Centro', cidade: 'Curitiba', uf: 'PR', endereco: 'Rua A, 1 - Curitiba - PR', whatsapp: '5541999990001' },
  sul: { nome: 'Loja Sul', cidade: 'Porto Alegre', uf: 'RS', endereco: 'Rua B, 2 - Porto Alegre - RS' },
};

// páginas de um site: cada uma é um ARQUIVO em sites-config/<id>/paginas/ (index.json = home, lojas.json, a/b.json).
// Os testes descrevem as páginas como lista { caminho, ...página }; isto grava os arquivos (apagando os .json antigos).
const arqPagina = (id, caminho) => path.join(RAIZ, 'sites-config', id, 'paginas', `${String(caminho).replace(/^\/+|\/+$/g, '') || 'index'}.json`);
function gravarPaginas(id, paginas) {
  const dir = path.join(RAIZ, 'sites-config', id, 'paginas');
  for (const f of listar(dir).filter((x) => x.endsWith('.json'))) fs.rmSync(f);
  for (const { caminho, ...p } of paginas) { const f = arqPagina(id, caminho ?? ''); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(p)); }
}
// grava sites-config/<id>/site.json, estoque.json e (se vier "paginas") os arquivos de sites-config/<id>/paginas/
function criarSite(id, { site = {}, carros = [] } = {}) {
  const dir = path.join(RAIZ, 'sites-config', id);
  fs.mkdirSync(dir, { recursive: true });
  const { paginas, ...resto } = site;
  const cfg = { nome: `Site ${id}`, slogan: 'Seminovos de teste', motor: 'v2', template: 'teste', url: `https://${id}`, whatsapp: '5511999999999', fotosBase: 'https://fotos.teste/', lojas: LOJAS, ...resto };
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(cfg, null, 2));
  fs.writeFileSync(path.join(dir, 'estoque.json'), JSON.stringify({ carros }));
  if (paginas) gravarPaginas(id, paginas);
  return cfg;
}
const lerSite = (id) => JSON.parse(fs.readFileSync(path.join(RAIZ, 'sites-config', id, 'site.json'), 'utf8'));
const gravarSite = (id, cfg) => { const { paginas, ...resto } = cfg; fs.writeFileSync(path.join(RAIZ, 'sites-config', id, 'site.json'), JSON.stringify(resto, null, 2)); if (paginas) gravarPaginas(id, paginas); };
const gravarEstoque = (id, carros) => fs.writeFileSync(path.join(RAIZ, 'sites-config', id, 'estoque.json'), JSON.stringify({ carros }));

const saida = (id, arq = '', pasta = 'sites-public') => path.join(RAIZ, pasta, id, arq);
const existe = (id, arq, pasta) => fs.existsSync(saida(id, arq, pasta));
const ler = (id, arq, pasta) => fs.readFileSync(saida(id, arq, pasta), 'utf8');
const lerJSON = (id, arq, pasta) => JSON.parse(ler(id, arq, pasta));

function listar(dir) {
  const r = [];
  const andar = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) andar(p); else r.push(p); } };
  if (fs.existsSync(dir)) andar(dir);
  return r;
}

// ---------- verificações de HTML ----------
// tira o conteúdo de <script type="text/html"> (modelos de card com [[campo]], preenchidos no navegador)
// e comentários HTML (que documentam esses campos)
const semModelos = (html) => html.replace(/<script type="text\/html"[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');

// marcadores do mini-renderer que sobraram na saída = template quebrado ou campo com nome errado
function marcadoresSobrando(html) {
  return [...semModelos(html).matchAll(/\{\{[^}]*\}\}|\[\[[a-z]+\]\]/g)].map((m) => m[0]);
}

// links/arquivos locais (href/src) que não existem na pasta gerada
function linksQuebrados(raizSite, arquivoHtml, html) {
  const quebrados = [];
  for (const m of semModelos(html).matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (!u || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(u)) continue; // externo, âncora, query, data:, mailto:, tel:
    u = u.split(/[?#]/)[0];
    try { u = decodeURIComponent(u); } catch (e) { /* deixa como está */ }
    let alvo = u.startsWith('/') ? path.join(raizSite, u) : path.resolve(path.dirname(arquivoHtml), u);
    if (u === '' || u.endsWith('/') || (fs.existsSync(alvo) && fs.statSync(alvo).isDirectory())) alvo = path.join(alvo, 'index.html');
    if (!alvo.startsWith(raizSite)) { quebrados.push(`${m[1]} (sai da pasta do site)`); continue; }
    if (!fs.existsSync(alvo)) quebrados.push(m[1]);
  }
  return quebrados;
}

// confere todas as páginas de um site gerado: nada de marcador sobrando nem link local quebrado
function verificarSiteGerado(id, pasta = 'sites-public') {
  const dir = saida(id, '', pasta);
  const problemas = [];
  for (const arq of listar(dir).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(arq, 'utf8');
    const rel = path.relative(dir, arq);
    for (const x of marcadoresSobrando(html)) problemas.push(`${rel}: marcador sobrando ${x}`);
    for (const x of linksQuebrados(dir, arq, html)) problemas.push(`${rel}: link quebrado ${x}`);
  }
  return problemas;
}

// motor de uma pasta gerada, rodando em Node (como o cli testar)
function carregarMotor(dirSite) {
  const m = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(dirSite, 'motor', 'engine.js'), 'utf8'))(m, m.exports);
  const Motor = m.exports;
  const carregar = async (u) => JSON.parse(fs.readFileSync(path.join(dirSite, u), 'utf8'));
  return { Motor, criar: () => Motor.criar({ dados: 'carros.json', config: 'config.json', carregar }) };
}

// pendências de publicação de um site
const pendente = (id, pasta = 'sites-public') => require('../core/pendentes').ler(pasta, id);
// "finge que já publicou": apaga as pendências de todos os sites
const limparPendentes = (pasta = 'sites-public') => fs.rmSync(path.join(RAIZ, '.estado', pasta, 'pendentes'), { recursive: true, force: true });

// silencia console.log/warn do build durante o teste e devolve o que foi impresso
function silencioso(fn) {
  const saidas = [];
  const [log, warn] = [console.log, console.warn];
  console.log = (...a) => saidas.push(a.join(' '));
  console.warn = (...a) => saidas.push(a.join(' '));
  try { const r = fn(); return { r, saidas }; } finally { console.log = log; console.warn = warn; }
}
async function silenciosoAsync(fn) {
  const saidas = [];
  const [log, warn] = [console.log, console.warn];
  console.log = (...a) => saidas.push(a.join(' '));
  console.warn = (...a) => saidas.push(a.join(' '));
  try { const r = await fn(); return { r, saidas }; } finally { console.log = log; console.warn = warn; }
}

module.exports = {
  PROJETO, prepararRaiz, raiz, limpar, carro, LOJAS, criarSite, lerSite, gravarSite, gravarEstoque, gravarPaginas, arqPagina,
  saida, existe, ler, lerJSON, listar, marcadoresSobrando, linksQuebrados, verificarSiteGerado, carregarMotor,
  pendente, limparPendentes, silencioso, silenciosoAsync,
};
