// Template "trokey": liga os botões de WhatsApp (.js-zap), o formulário que envia por WhatsApp (.js-form-zap)
// e o placeholder das fotos da vitrine. Não tem servidor: tudo vira uma mensagem de WhatsApp.
(async () => {
  const REL = document.body.dataset.rel || '';
  const cfg = await Motor.carregarConfig(`${REL}config.json`);
  const lojaId = document.body.dataset.loja;
  const zap = (msg) => Motor.whatsapp(cfg, msg || 'Olá! Gostaria de mais informações.', lojaId);

  document.querySelectorAll('.js-zap').forEach((a) => {
    a.href = zap(a.dataset.msg);
    a.target = '_blank';
    a.rel = 'noopener';
  });

  // formulários .js-form-zap e aviso de cookies: core (motor/ui-site.js)

  // fotos da vitrine (blocos): se não carregar, placeholder
  if (window.UI) document.querySelectorAll('.b-vitrine img[data-fb]').forEach((img) => UI.fallback(img));

  // menu do celular: fecha ao escolher um item
  const abre = document.getElementById('menu-abre');
  if (abre) document.querySelectorAll('.menu a').forEach((a) => a.addEventListener('click', () => { abre.checked = false; }));
})();
