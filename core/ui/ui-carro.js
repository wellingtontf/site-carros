// Liga a página de um carro: botão de WhatsApp, copiar link e galeria de fotos.
(async () => {
  const $ = (s) => document.querySelector(s);
  const d = document.body.dataset;
  const BASE = d.base || '';
  const { foto } = Motor.util;
  const cfg = await Motor.carregarConfig(`${d.rel || ''}config.json`); // a página do carro fica em carros/<Marca>/<Modelo>/<Versao>/

  $('#zap').href = Motor.whatsapp(cfg, `Olá! Tenho interesse no ${d.titulo} (ref. ${d.id}). Ainda está disponível?`, d.loja);
  $('#copiar').addEventListener('click', (e) => UI.copiar(location.href.split('#')[0], e.target));

  const principal = $('#foto-principal');
  UI.fallback(principal);
  document.querySelectorAll('.mini').forEach((btn) => {
    const img = btn.querySelector('img');
    if (img.dataset.fb) UI.fallback(img);
    btn.addEventListener('click', () => {
      if (!BASE) return;
      const n = btn.dataset.n;
      principal.dataset.fb = `foto ${n}`;
      principal.srcset = `${foto(BASE, d.id, n, 800)} 800w, ${foto(BASE, d.id, n, 1600)} 1600w`;
      principal.src = foto(BASE, d.id, n, 800);
      UI.fallback(principal);
    });
  });
})();
