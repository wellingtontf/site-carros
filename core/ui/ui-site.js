// Comportamento comum a TODAS as páginas de TODOS os sites (o core garante; o template só precisa carregar este arquivo):
//   - aviso de cookies (LGPD): aparece até a pessoa clicar em "Entendi"; texto e link vêm do config.json
//   - formulários .js-form-zap: juntam "Rótulo: valor" dos campos preenchidos e abrem o WhatsApp (site estático, sem servidor)
// O visual do aviso pode ser trocado no CSS do template (classes .aviso-cookies, .aviso-cookies-ok).
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

  // aviso de cookies
  const aviso = cfg.avisoCookies;
  let aceito = false;
  try { aceito = localStorage.getItem('cookies-ok') === '1'; } catch (e) { /* navegador sem localStorage */ }
  if (!aviso || aceito || document.querySelector('.aviso-cookies')) return;
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
  ok.textContent = 'Entendi';
  ok.style.cssText = 'border:0;border-radius:6px;padding:9px 18px;font-weight:700;cursor:pointer;background:var(--cor,#0b5fff);color:#fff';
  ok.addEventListener('click', () => { try { localStorage.setItem('cookies-ok', '1'); } catch (e) { /* tanto faz */ } div.remove(); });
  div.append(p, ok);
  document.body.appendChild(div);
})();
