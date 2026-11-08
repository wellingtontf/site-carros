// Comportamento comum a TODAS as páginas de TODOS os sites (o core garante; o tema só precisa carregar este arquivo):
//   - aviso de cookies (LGPD): aparece até a pessoa clicar em "Entendi"; texto e link vêm do config.json. Se a página tem
//     scripts de terceiros (<template data-lgpd>, postos pelo build: GTM, GA4, Pixel, códigos do site), o aviso pede
//     "Aceitar" ou "Recusar", e esses scripts SÓ rodam depois do "Aceitar" (core/codigos.js)
//   - formulários .js-form-zap: juntam "Rótulo: valor" dos campos preenchidos e abrem o WhatsApp (site estático, sem servidor)
// O visual do aviso pode ser trocado no CSS do tema (classes .aviso-cookies, .aviso-cookies-ok).
(async () => {
  const REL = document.body.dataset.rel || '';
  let cfg = {};
  try { cfg = await (await fetch(`${REL}config.json`)).json(); } catch (e) { /* sem config: segue com o padrão */ }

  // WhatsApp: usa o do motor (respeita ?v=vendedor e a loja), se a página carregou o motor
  const zap = (texto) => (window.Motor ? Motor.whatsapp(cfg, texto, document.body.dataset.loja)
    : `https://wa.me/${cfg.whatsapp || ''}?text=${encodeURIComponent(texto)}`);

  document.querySelectorAll('.js-form-zap').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const linhas = [...form.elements].filter((el) => el.name && String(el.value).trim()).map((el) => `${el.name}: ${String(el.value).trim()}`);
      window.open(zap([form.dataset.msg || 'Olá!', '', ...linhas].join('\n')), '_blank', 'noopener');
    });
  });

  // scripts de terceiros esperando o aceite: o conteúdo do <template> entra na página e cada <script> é recriado (script
  // vindo de <template> não roda sozinho)
  const terceiros = document.querySelectorAll('template[data-lgpd]');
  const ativar = () => terceiros.forEach((t) => {
    const frag = t.content.cloneNode(true);
    frag.querySelectorAll('script').forEach((s) => {
      const n = document.createElement('script');
      for (const a of s.attributes) n.setAttribute(a.name, a.value);
      n.text = s.text;
      s.replaceWith(n);
    });
    if (t.dataset.lgpd === 'head') document.head.appendChild(frag); else t.after(frag);
    t.remove();
  });

  // aviso de cookies: "1" = aceitou, "0" = recusou (só existe quando a página tem scripts de terceiros)
  const aviso = cfg.avisoCookies;
  let escolha = null;
  try { escolha = localStorage.getItem('cookies-ok'); } catch (e) { /* navegador sem localStorage */ }
  if (!aviso || escolha === '1') ativar(); // sem aviso (o site desligou) ou já aceitou
  if (!aviso || escolha === '1' || (escolha === '0' && terceiros.length) || document.querySelector('.aviso-cookies')) return;
  const div = document.createElement('div');
  div.className = 'aviso-cookies';
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-label', 'Aviso de cookies');
  div.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:760px;margin:0 auto;background:#1c1c1c;color:#fff;'
    + 'border-radius:10px;padding:14px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)';
  const p = document.createElement('p');
  p.style.cssText = 'margin:0;flex:1 1 260px';
  p.textContent = `${aviso.texto} `;
  if (aviso.link) {
    const a = document.createElement('a');
    a.href = REL + aviso.link;
    a.textContent = 'Saiba mais';
    a.style.cssText = 'color:inherit;text-decoration:underline';
    p.appendChild(a);
  }
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'aviso-cookies-ok';
  ok.textContent = terceiros.length ? 'Aceitar' : 'Entendi';
  ok.style.cssText = 'border:0;border-radius:6px;padding:9px 18px;font-weight:700;cursor:pointer;background:var(--cor,#0b5fff);color:#fff';
  const escolher = (v) => { try { localStorage.setItem('cookies-ok', v); } catch (e) { /* tanto faz */ } div.remove(); if (v === '1') ativar(); };
  ok.addEventListener('click', () => escolher('1'));
  div.append(p, ok);
  if (terceiros.length) {
    const nao = document.createElement('button');
    nao.type = 'button';
    nao.className = 'aviso-cookies-recusar';
    nao.textContent = 'Recusar';
    nao.style.cssText = 'border:1px solid currentColor;border-radius:6px;padding:8px 16px;cursor:pointer;background:transparent;color:inherit';
    nao.addEventListener('click', () => escolher('0'));
    div.append(nao);
  }
  document.body.appendChild(div);
})();
