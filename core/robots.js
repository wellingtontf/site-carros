// robots.txt dos sites. Um modelo para TODOS (config/robots.txt, trocado pela API: PUT /v1/robots); o site que precisa
// de um diferente põe "robots" no site.json (vale mais que o modelo). Sem nenhum dos dois, o padrão abaixo.
// Marcadores: {{sitemap}} = https://<site>/sitemap.xml   {{url}} = https://<site>   {{dominio}} = <site>
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');

const PADRAO = 'User-agent: *\nAllow: /\nSitemap: {{sitemap}}\n';
const MARCADORES = ['sitemap', 'url', 'dominio'];
const MAX = 100 * 1024; // o Google lê até 500 KB; robots de revenda não chega perto disso

const lerModelo = () => { try { return fs.readFileSync(C.robots(), 'utf8'); } catch (e) { return null; } };
// modelo global novo (null = volta ao padrão); guarda o anterior em .estado/robots-anterior.txt
function gravarModelo(texto) {
  const atual = lerModelo();
  if (atual != null) { fs.mkdirSync(C.ESTADO, { recursive: true }); fs.writeFileSync(path.join(C.ESTADO, 'robots-anterior.txt'), atual); }
  if (texto == null) { fs.rmSync(C.robots(), { force: true }); return; }
  fs.mkdirSync(path.dirname(C.robots()), { recursive: true });
  fs.writeFileSync(`${C.robots()}.tmp`, normalizar(texto));
  fs.renameSync(`${C.robots()}.tmp`, C.robots());
}
const normalizar = (t) => String(t).replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');

// texto final do robots.txt de um site (o site precisa de "url")
function textoRobots(site) {
  const modelo = typeof site.robots === 'string' ? site.robots : lerModelo() ?? PADRAO;
  const raiz = String(site.url).replace(/\/$/, '');
  return normalizar(modelo.replace(/\{\{\s*sitemap\s*\}\}/g, `${raiz}/sitemap.xml`).replace(/\{\{\s*url\s*\}\}/g, raiz).replace(/\{\{\s*dominio\s*\}\}/g, site.id));
}

// { erros, perigos }: erros impedem gravar; perigos (tirar os sites do Google) exigem confirmação explícita
function validarRobots(texto) {
  const erros = [], perigos = [];
  if (typeof texto !== 'string' || !texto.trim()) return { erros: ['o robots.txt veio vazio'], perigos };
  if (Buffer.byteLength(texto) > MAX) erros.push('robots.txt grande demais (máx. 100 KB)');
  if (/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(texto)) erros.push('caractere de controle no texto');
  for (const m of texto.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) if (!MARCADORES.includes(m[1])) erros.push(`marcador desconhecido {{${m[1]}}} (use: ${MARCADORES.map((x) => `{{${x}}}`).join(', ')})`);
  // grupos "User-agent: ..." seguidos das regras; Disallow: / para * ou Googlebot = sites fora do Google
  let agentes = [], emRegras = false;
  for (const linha of normalizar(texto).split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
    const [k, ...v] = linha.split(':');
    const chave = k.trim().toLowerCase(), valor = v.join(':').trim();
    if (chave === 'user-agent') { if (emRegras) { agentes = []; emRegras = false; } agentes.push(valor.toLowerCase()); continue; }
    emRegras = true;
    if (chave === 'disallow' && valor === '/' && agentes.some((a) => a === '*' || a === 'googlebot')) perigos.push(`"Disallow: /" para ${agentes.join(', ')}: tira os sites do Google`);
  }
  if (!/^\s*sitemap\s*:/im.test(texto)) perigos.push('sem a linha "Sitemap:" (use Sitemap: {{sitemap}}): o Google demora mais para achar os carros');
  return { erros, perigos };
}

module.exports = { PADRAO, lerModelo, gravarModelo, textoRobots, validarRobots };
