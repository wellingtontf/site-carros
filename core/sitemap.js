// sitemap.xml de um site: as páginas e os carros que estão no ar, com <lastmod> = o dia em que cada página mudou de
// verdade (o Google revisita só o que mudou). Fonte: o estado do build (.estado/<pasta>/<dominio>.json: páginas
// geradas, link de cada carro e datas). Fica fora: redirecionamentos, páginas de "vendido" (noindex) e a 404.
//   gerarSitemap(dominio)        reconstrói e grava <pasta>/<dominio>/sitemap.xml (e marca para publicar se mudou)
//   montarSitemap(site, estado)  só o texto (o build usa ao reconstruir o site)
// Site sem "url" não tem sitemap (os endereços precisam ser completos).
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');
const Sites = require('./sites');
const Pendentes = require('./pendentes');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const url = (caminho) => caminho.split('/').map(encodeURIComponent).join('/'); // espaço/acento codificados

// estado = { paginas: ["index.html", "paginas/lojas/index.html", ...], links: { idCarro: "carros/.../x.html" }, datas: { arquivo: "AAAA-MM-DD" } }
function montarSitemap(site, estado) {
  if (!site.url) return null;
  const raiz = String(site.url).replace(/\/$/, '');
  const datas = estado.datas || {};
  const urls = [
    ...(estado.paginas || []).map((g) => [`${raiz}/${url(g.replace(/index\.html$/, ''))}`, datas[g]]),
    ...Object.values(estado.links || {}).map((l) => [`${raiz}/${url(l)}`, datas[l]]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `<url><loc>${esc(u)}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}

function gerarSitemap(dominio, { pasta = C.PUBLICO } = {}) {
  if (!Sites.existe(dominio)) throw new Error(`site "${dominio}" não existe`);
  const arqEstado = path.join(C.ESTADO, pasta, `${dominio}.json`);
  if (!fs.existsSync(arqEstado)) throw new Error(`site "${dominio}" ainda não foi gerado (rode o build antes)`);
  const xml = montarSitemap(Sites.carregar(dominio), JSON.parse(fs.readFileSync(arqEstado, 'utf8')));
  if (!xml) return { status: 'sem_url', alterado: false, urls: 0 };
  const arq = path.join(C.saida(pasta), dominio, 'sitemap.xml');
  const urls = (xml.match(/<url>/g) || []).length;
  if (fs.existsSync(arq) && fs.readFileSync(arq, 'utf8') === xml) return { status: 'ok', alterado: false, urls };
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, xml);
  fs.renameSync(`${arq}.tmp`, arq);
  Pendentes.registrar(pasta, dominio, { escritos: [`${dominio}/sitemap.xml`], removidos: [] });
  return { status: 'ok', alterado: true, urls };
}

module.exports = { montarSitemap, gerarSitemap };
