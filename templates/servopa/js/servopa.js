// Template "servopa": WhatsApp (.js-zap, com a loja do carro em data-loja), total do estoque (.js-total),
// carrossel, busca da home (modelo depende da marca), formulário por WhatsApp e menu do celular.
(async () => {
  const REL = document.body.dataset.rel || '';
  const cfg = await Motor.carregarConfig(`${REL}config.json`);
  const zap = (msg, loja) => Motor.whatsapp(cfg, msg || 'Olá! Gostaria de mais informações.', loja || document.body.dataset.loja);

  document.querySelectorAll('.js-zap').forEach((a) => {
    a.href = zap(a.dataset.msg, a.dataset.loja);
    a.target = '_blank';
    a.rel = 'noopener';
  });
  // o total vem do config.json (sempre atualizado): assim as páginas de carro não precisam ser refeitas quando ele muda
  document.querySelectorAll('.js-total').forEach((el) => { el.textContent = cfg.total != null ? cfg.total : ''; });
  if (window.UI) document.querySelectorAll('img[data-fb]').forEach((img) => UI.fallback(img));

  // busca da home: o select de modelo mostra só os modelos da marca escolhida; campos vazios não vão para o link
  document.querySelectorAll('.js-busca').forEach((form) => {
    const marca = form.elements.marca, modelo = form.elements.modelo;
    const opcoes = modelo ? [...modelo.options].slice(1) : [];
    const atualizar = () => {
      opcoes.forEach((o) => { o.hidden = !!marca.value && o.dataset.marca !== marca.value; });
      if (modelo.selectedOptions[0] && modelo.selectedOptions[0].hidden) modelo.value = '';
    };
    if (marca && modelo) { marca.addEventListener('change', atualizar); atualizar(); }
    form.addEventListener('submit', () => [...form.elements].forEach((el) => { if (el.name && !el.value) el.disabled = true; }));
  });

  // formulário que envia pelo WhatsApp (contato)
  document.querySelectorAll('.js-form-zap').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const linhas = [...form.elements].filter((el) => el.name && String(el.value).trim()).map((el) => `${el.name}: ${String(el.value).trim()}`);
      window.open(zap([form.dataset.msg || 'Olá!', '', ...linhas].join('\n')), '_blank', 'noopener');
    });
  });

  // carrossel: rolagem nativa (arrasta no celular) + setas, bolinhas e troca automática
  document.querySelectorAll('.b-carrossel').forEach((c) => {
    const trilho = c.querySelector('.b-carrossel-trilho');
    const slides = [...trilho.children];
    if (slides.length < 2) { c.classList.add('unico'); return; }
    const pontos = c.querySelector('.b-pontos');
    pontos.innerHTML = slides.map((_, i) => `<button type="button" aria-label="Banner ${i + 1}"></button>`).join('');
    const atual = () => Math.round(trilho.scrollLeft / trilho.clientWidth);
    const ir = (i) => trilho.scrollTo({ left: ((i + slides.length) % slides.length) * trilho.clientWidth, behavior: 'smooth' });
    const marcar = () => [...pontos.children].forEach((b, i) => b.classList.toggle('ativo', i === atual()));
    pontos.addEventListener('click', (e) => { const i = [...pontos.children].indexOf(e.target); if (i >= 0) ir(i); });
    c.querySelector('.ant').addEventListener('click', () => ir(atual() - 1));
    c.querySelector('.prox').addEventListener('click', () => ir(atual() + 1));
    trilho.addEventListener('scroll', () => requestAnimationFrame(marcar), { passive: true });
    marcar();
    let pausa = false;
    c.addEventListener('mouseenter', () => (pausa = true));
    c.addEventListener('mouseleave', () => (pausa = false));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => { if (!pausa && !document.hidden) ir(atual() + 1); }, 6000);
  });

  const abre = document.getElementById('menu-abre');
  if (abre) document.querySelectorAll('.menu a').forEach((a) => a.addEventListener('click', () => { abre.checked = false; }));
})();
