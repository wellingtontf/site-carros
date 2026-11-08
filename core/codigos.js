// Scripts de medição e de terceiros (GTM, GA4, Pixel da Meta, chat...) no cabeçalho e no rodapé de TODAS as páginas.
//
//   site.json "integracoes": { "gtm": "GTM-XXXX", "ga4": "G-XXXX", "pixelMeta": "123456789" }   (o build gera o código oficial)
//   sites-config/<dominio>/codigos/head.html  e  body.html     código livre do site (fim do <head> / fim do <body>)
//   inquilinos/<id>/codigos/head.html  e  body.html           código livre de TODOS os sites do inquilino
//
// LGPD (decisão do Wellington): nada disso roda antes do aceite de cookies. O build põe o código dentro de
// <template data-lgpd="head|body"> (o navegador não executa o que está num <template>); a core/ui/ui-site.js mostra o
// aviso com "Aceitar" e "Recusar" e só ativa os templates depois do "Aceitar" (ou na hora, se o site desligou o aviso:
// "avisoCookies": false). Site em RASCUNHO não recebe nada (não suja as estatísticas do site definitivo).
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');

const LUGARES = ['head', 'body'];
const MAX = 100e3; // por arquivo
const FORMATO = {
  gtm: [/^GTM-[A-Z0-9]{4,12}$/, 'GTM-XXXXXXX'],
  ga4: [/^G-[A-Z0-9]{4,15}$/, 'G-XXXXXXXXXX'],
  pixelMeta: [/^\d{8,20}$/, 'só números, ex.: 123456789012345'],
};

function validarIntegracoes(v) {
  if (v == null) return [];
  if (typeof v !== 'object' || Array.isArray(v)) return ['"integracoes" deve ser um objeto: { "gtm": "GTM-XXXX", "ga4": "G-XXXX", "pixelMeta": "123..." }'];
  const erros = [];
  for (const [k, val] of Object.entries(v)) {
    if (!FORMATO[k]) { erros.push(`"integracoes.${k}" não existe (use: ${Object.keys(FORMATO).join(', ')}; outro script vai em codigos/head.html ou body.html)`); continue; }
    if (val === '' || val == null) continue;
    if (!FORMATO[k][0].test(String(val))) erros.push(`"integracoes.${k}": "${val}" não tem o formato certo (${FORMATO[k][1]})`);
  }
  return erros;
}

function validarCodigo(texto) {
  const erros = [];
  if (typeof texto !== 'string') return ['o código precisa ser texto (HTML)'];
  if (Buffer.byteLength(texto) > MAX) erros.push(`código grande demais (máximo ${MAX / 1e3} KB)`);
  if (/<\/template/i.test(texto)) erros.push('o código não pode ter </template> (ele vai dentro de um <template> até o aceite de cookies)');
  if (/<\/?(html|head|body)[\s>]/i.test(texto)) erros.push('mande só o trecho (os <script>, <noscript>...), sem <html>, <head> ou <body>');
  return erros;
}

const arqSite = (dominio, lugar) => path.join(C.codigosSite(dominio), `${lugar}.html`);
const arqInquilino = (inq, lugar) => path.join(C.codigosInquilino(inq), `${lugar}.html`);
const ler = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '');

// código oficial de cada integração (os IDs já foram conferidos: não há como injetar nada por eles)
function dasIntegracoes(v = {}) {
  const head = [];
  const body = [];
  if (v.gtm) {
    head.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${v.gtm}');</script>`);
    body.push(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${v.gtm}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
  }
  if (v.ga4) {
    head.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${v.ga4}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${v.ga4}');</script>`);
  }
  if (v.pixelMeta) {
    head.push(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${v.pixelMeta}');fbq('track','PageView');</script>`);
  }
  return { head: head.join('\n'), body: body.join('\n') };
}

// o que vai em cada lugar para um site → { head, body } (texto cru; vazio = nada a pôr). Ordem: integrações, inquilino, site
function doSite(site, inquilino) {
  if (site.rascunho) return { head: '', body: '' };
  const integ = dasIntegracoes(site.integracoes || {});
  const r = {};
  for (const l of LUGARES) {
    const partes = [integ[l], inquilino ? ler(arqInquilino(inquilino, l)) : '', ler(arqSite(site.id, l))].map((x) => x.trim()).filter(Boolean);
    for (const [i, p] of partes.entries()) {
      const er = validarCodigo(p);
      if (er.length) throw new Error(`código do ${l} do site "${site.id}" (parte ${i + 1}): ${er.join('; ')}`);
    }
    r[l] = partes.join('\n');
  }
  return r;
}

// põe os códigos na página, dentro dos <template data-lgpd> (só ativam depois do aceite de cookies)
function injetar(html, cod) {
  let h = html;
  if (cod.head) h = h.replace(/<\/head>/i, `<template data-lgpd="head">\n${cod.head}\n</template>\n</head>`);
  if (cod.body) { const i = h.toLowerCase().lastIndexOf('</body>'); if (i >= 0) h = `${h.slice(0, i)}<template data-lgpd="body">\n${cod.body}\n</template>\n${h.slice(i)}`; }
  return h;
}

// código do site gravado pela API (sites-config/<dominio>/codigos/<lugar>.html)
const lerSite = (dominio, lugar) => (fs.existsSync(arqSite(dominio, lugar)) ? ler(arqSite(dominio, lugar)) : null);
function gravarSite(dominio, lugar, texto) {
  const arq = arqSite(dominio, lugar);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, texto);
  fs.renameSync(`${arq}.tmp`, arq);
}
const removerSite = (dominio, lugar) => { const arq = arqSite(dominio, lugar); if (!fs.existsSync(arq)) return false; fs.rmSync(arq); return true; };

module.exports = { LUGARES, FORMATO, validarIntegracoes, validarCodigo, dasIntegracoes, doSite, injetar, lerSite, gravarSite, removerSite };
