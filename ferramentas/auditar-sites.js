#!/usr/bin/env node
// Auditoria dos sites gerados (sites-public/<dominio>/) contra os problemas mais conhecidos de site estático em produção.
//   node ferramentas/auditar-sites.js [pasta=sites-public]        (sai com código 1 se houver PROBLEMA)
//   require('./ferramentas/auditar-sites.js').auditar(pasta) → { resumo, resultados: [{ chave, nivel, item, detalhe }] }
// Cada verificação diz: OK, ATENÇÃO (funciona, mas tem risco) ou PROBLEMA (quebra em produção).
// O tests/sites-e-templates.test.js roda isto nos sites reais: um PROBLEMA novo derruba os testes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function auditar(pasta) {
const DIST = path.resolve(pasta);
const sites = fs.readdirSync(DIST, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const listar = (d) => { const r = []; const andar = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); e.isDirectory() ? andar(p) : r.push(p); } }; andar(d); return r; };
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const resultados = [];
const anotar = (chave, nivel, item, detalhe) => resultados.push({ chave, nivel, item, detalhe });

const total = { arquivos: 0, bytes: 0, html: 0 };
const achados = {
  semIndexDeDiretorio: 0, espacoAcento: new Set(), nfd: [], caixa: [], http: new Set(), localhost: new Set(), fontesExternas: new Set(),
  semCharset: [], semCanonical: 0, jsonLdRuim: [], assetsSemVersao: new Set(), sem404: [], refresh: 0, maiorSitemap: [0, ''], maiorCarrosJson: [0, '', 0],
  scriptsExternos: new Set(), arquivosGrandes: [],
};

for (const id of sites) {
  const dir = path.join(DIST, id);
  const arquivos = listar(dir);
  total.arquivos += arquivos.length;
  if (!fs.existsSync(path.join(dir, '404.html'))) achados.sem404.push(id);
  // colisão de maiúsculas/minúsculas (Windows/macOS e alguns servidores não diferenciam)
  const vistos = new Map();
  for (const f of arquivos) {
    const rel = path.relative(dir, f);
    const st = fs.statSync(f);
    total.bytes += st.size;
    if (st.size > 1024 * 1024) achados.arquivosGrandes.push(`${id}/${rel} (${kb(st.size)})`);
    if (rel !== rel.normalize('NFC')) achados.nfd.push(`${id}/${rel}`);
    if (/[^\x20-\x7e]|\s/.test(rel)) achados.espacoAcento.add(`${id}/${rel.split(path.sep).slice(0, 3).join('/')}`);
    const baixo = rel.toLowerCase();
    if (vistos.has(baixo) && vistos.get(baixo) !== rel) achados.caixa.push(`${id}/${rel} × ${vistos.get(baixo)}`);
    vistos.set(baixo, rel);
    if (rel.endsWith(path.sep + 'index.html')) achados.semIndexDeDiretorio++;
  }
  const sm = path.join(dir, 'sitemap.xml');
  if (fs.existsSync(sm)) {
    const n = (fs.readFileSync(sm, 'utf8').match(/<url>/g) || []).length;
    if (n > achados.maiorSitemap[0]) achados.maiorSitemap = [n, id];
  }
  const cj = path.join(dir, 'carros.json');
  if (fs.existsSync(cj)) {
    const b = fs.readFileSync(cj);
    if (b.length > achados.maiorCarrosJson[0]) achados.maiorCarrosJson = [b.length, id, zlib.gzipSync(b).length];
  }
  for (const f of arquivos.filter((x) => x.endsWith('.html'))) {
    total.html++;
    const h = fs.readFileSync(f, 'utf8');
    const rel = `${id}/${path.relative(dir, f)}`;
    if (!/<meta charset=|<meta[^>]+charset=/i.test(h)) achados.semCharset.push(rel);
    if (/http-equiv="refresh"/.test(h)) { achados.refresh++; continue; }
    if (!/rel="canonical"/.test(h) && !/noindex/.test(h)) achados.semCanonical++;
    for (const m of h.matchAll(/\b(?:src|href)="(http:\/\/[^"]+)"/g)) (/localhost|127\.0\.0\.1/.test(m[1]) ? achados.localhost : achados.http).add(`${id}: ${m[1].replace(/(\/\/[^/]+\/).*/, '$1…')}`);
    for (const m of h.matchAll(/data-base="(http:\/\/[^"]+)"/g)) (/localhost|127\.0\.0\.1/.test(m[1]) ? achados.localhost : achados.http).add(`${id}: fotosBase ${m[1]}`);
    for (const m of h.matchAll(/href="(https:\/\/fonts\.googleapis\.com[^"]*)"/g)) achados.fontesExternas.add(id);
    for (const m of h.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) achados.scriptsExternos.add(`${id}: ${m[1]}`);
    for (const m of h.matchAll(/<link rel="stylesheet" href="([^"?]+\.css)"|<script src="([^"?]+\.js)"/g)) achados.assetsSemVersao.add(path.basename(m[1] || m[2]));
    for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch (e) { achados.jsonLdRuim.push(rel); } }
  }
}

// ---------- veredito ----------
anotar('404', achados.sem404.length ? 'PROBLEMA' : 'OK', 'Página 404 própria',
  achados.sem404.length ? `nenhum site tem 404.html (${achados.sem404.length}/${sites.length}): link quebrado mostra o erro cru da hospedagem, sem menu nem estoque` : 'todos têm 404.html');
anotar('indice', 'ATENÇÃO', 'Índice de pasta (/pasta/ → /pasta/index.html)',
  `${achados.semIndexDeDiretorio} páginas dependem disso. S3 via API (CloudFront padrão) NÃO faz: precisa de CloudFront Function/S3 website endpoint/Cloudflare Pages. Também servir sem a barra final.`);
anotar('cache', achados.assetsSemVersao.size ? 'PROBLEMA' : 'OK', 'Cache de CSS/JS (cache busting)',
  achados.assetsSemVersao.size ? `${achados.assetsSemVersao.size} arquivos sem versão no nome/URL (${[...achados.assetsSemVersao].slice(0, 6).join(', ')}…): com cache longo na CDN, depois de publicar o HTML novo o navegador usa o CSS/JS velho e a página quebra; com cache curto, toda visita baixa de novo` : 'CSS/JS com versão');
anotar('localhost', achados.localhost.size ? 'PROBLEMA' : 'OK', 'Endereços de localhost no site', achados.localhost.size ? [...achados.localhost].join(' | ') : 'nenhum');
anotar('http', achados.http.size ? 'PROBLEMA' : 'OK', 'Conteúdo misto (http:// em site https)', achados.http.size ? [...achados.http].slice(0, 5).join(' | ') : 'nenhum');
anotar('fontes', achados.fontesExternas.size ? 'ATENÇÃO' : 'OK', 'Google Fonts (LGPD e desempenho)',
  achados.fontesExternas.size ? `${achados.fontesExternas.size} site(s) carregam fontes do Google: o IP do visitante vai para o Google antes do consentimento (já gerou multa na Europa) e é 1 requisição a mais que bloqueia a renderização. Melhor servir a fonte junto com o site.` : 'nenhum');
anotar('acento', achados.espacoAcento.size ? 'ATENÇÃO' : 'OK', 'Arquivos com espaço/acento no nome',
  achados.espacoAcento.size ? `${achados.espacoAcento.size} caminhos (ex.: ${[...achados.espacoAcento][0]}). Funciona no S3/Cloudflare, mas exige codificação certa no upload (aws s3 sync ok; alguns FTP/rsync não)` : 'nenhum');
anotar('nfc', achados.nfd.length ? 'PROBLEMA' : 'OK', 'Unicode normalizado (NFC)', achados.nfd.length ? `${achados.nfd.length} nomes em NFD (gerados no macOS?): a URL com acento não bate` : 'todos NFC');
anotar('caixa', achados.caixa.length ? 'ATENÇÃO' : 'OK', 'Colisão maiúscula/minúscula', achados.caixa.length ? achados.caixa.slice(0, 3).join(' | ') : 'nenhuma (seguro em Windows/macOS)');
anotar('charset', achados.semCharset.length ? 'PROBLEMA' : 'OK', 'charset declarado', achados.semCharset.length ? `${achados.semCharset.length} páginas sem <meta charset> (acentos podem quebrar)` : `todas as ${total.html} páginas`);
anotar('jsonld', achados.jsonLdRuim.length ? 'PROBLEMA' : 'OK', 'JSON-LD válido', achados.jsonLdRuim.length ? achados.jsonLdRuim.slice(0, 3).join(' | ') : 'todos válidos');
anotar('canonical', achados.semCanonical ? 'ATENÇÃO' : 'OK', 'Canonical', achados.semCanonical ? `${achados.semCanonical} páginas indexáveis sem canonical` : 'todas as indexáveis têm');
anotar('redirecionamento', achados.refresh ? 'ATENÇÃO' : 'OK', 'Redirecionamentos', achados.refresh ? `${achados.refresh} feitos com meta refresh (o Google aceita, mas 301 no servidor é melhor e mais rápido)` : 'nenhum');
anotar('sitemap', achados.maiorSitemap[0] > 45000 ? 'PROBLEMA' : 'OK', 'Tamanho do sitemap', `maior: ${achados.maiorSitemap[0]} URLs (${achados.maiorSitemap[1]}); limite do Google 50.000 por arquivo`);
anotar('carros-json', achados.maiorCarrosJson[0] > 2 * 1024 * 1024 ? 'ATENÇÃO' : 'OK', 'Tamanho do carros.json (busca no navegador)',
  `maior: ${kb(achados.maiorCarrosJson[0])}, ${kb(achados.maiorCarrosJson[2])} com gzip (${achados.maiorCarrosJson[1]}). Precisa da compressão ligada na hospedagem; acima de ~5 mil carros vale paginar`);
anotar('terceiros', achados.scriptsExternos.size ? 'ATENÇÃO' : 'OK', 'Scripts de terceiros', achados.scriptsExternos.size ? [...achados.scriptsExternos].slice(0, 3).join(' | ') : 'nenhum (bom para desempenho e LGPD)');
anotar('grandes', achados.arquivosGrandes.length ? 'ATENÇÃO' : 'OK', 'Arquivos grandes (>1 MB)', achados.arquivosGrandes.length ? achados.arquivosGrandes.slice(0, 3).join(' | ') : 'nenhum');

const ordem = { PROBLEMA: 0, 'ATENÇÃO': 1, OK: 2 };
return { resumo: { pasta: DIST, sites: sites.length, ...total }, resultados: resultados.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]) };
}

module.exports = { auditar };

if (require.main === module) {
const { resumo: total, resultados } = auditar(process.argv[2] || 'sites-public');
const DIST = total.pasta, sites = { length: total.sites };
console.log(`Auditoria de ${DIST}: ${sites.length} sites, ${total.arquivos} arquivos, ${(total.bytes / 1024 / 1024).toFixed(1)} MB, ${total.html} páginas HTML\n`);
for (const r of resultados) console.log(`${r.nivel.padEnd(9)} ${r.item}\n          ${r.detalhe}\n`);
process.exitCode = resultados.some((r) => r.nivel === 'PROBLEMA') ? 1 : 0;
}
