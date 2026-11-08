// Liga a página de listagem ao motor. O HTML (e o formato do card, em #tpl-card) vem do template.
// Ids esperados na página: q, filtros-dinamicos, ord, contagem, grade, mais, limpar, copiar, tpl-card.
// Precisa de motor/link-carro.js carregado antes (link da página de cada carro).
(async () => {
  const $ = (s) => document.querySelector(s);
  const { brl, num, esc, foto, placeholder } = Motor.util;
  const BASE = document.body.dataset.base || '';
  const REL = document.body.dataset.rel || ''; // a listagem pode ficar numa subpasta (ex.: /estoque/): REL leva à raiz do site
  const [motor, cfg] = await Promise.all([
    Motor.criar({ dados: `${REL}carros.json`, config: `${REL}config.json` }),
    Motor.carregarConfig(`${REL}config.json`), // para o WhatsApp de cada card ([[zap]])
  ]);
  const idLoja = Object.fromEntries(Object.entries(cfg.lojas || {}).map(([id, l]) => [l.nome, id]));
  // página fixa de filtro (/multipla/marca/toyota/): o <body data-filtro="marca=Toyota"> vale quando a URL não traz outro
  motor.aplicarQuery(location.search || document.body.dataset.filtro || '');
  Motor.vendedor(); // guarda ?v= se existir

  // busca e ordenação
  $('#q').hidden = !motor.buscaAtiva;
  $('#ord').innerHTML = motor.ordens.map((o) => `<option value="${o.chave}">${esc(o.rotulo)}</option>`).join('');
  $('#ord').hidden = motor.ordens.length < 2;
  $('#q').addEventListener('input', (e) => motor.buscar(e.target.value));
  $('#ord').addEventListener('change', (e) => motor.ordenar(e.target.value));

  // um select por filtro configurado no site
  const selects = {};
  motor.filtros.forEach((f) => {
    const sel = document.createElement('select');
    sel.id = `f-${f.campo}`;
    sel.setAttribute('aria-label', f.rotulo);
    sel.addEventListener('change', () => motor.definir(f.campo, sel.value));
    $('#filtros-dinamicos').appendChild(sel);
    selects[f.campo] = sel;
  });

  // card: o template define o HTML com [[campos]]
  const tplCard = $('#tpl-card').textContent;
  const preencher = (tpl, o) => tpl.replace(/\[\[(\w+)\]\]/g, (_, k) => (k === 'imgattrs' ? o[k] : esc(o[k] ?? ''))); // [[zap]] = link do WhatsApp do carro
  function dadosCard(d) {
    const nome = `${d.marca} ${d.modelo}`;
    const local = `${d.cidade}/${d.uf}`;
    const imgattrs = BASE
      ? `src="${esc(foto(BASE, d.id, 1, 400))}" srcset="${esc(foto(BASE, d.id, 1, 400))} 400w, ${esc(foto(BASE, d.id, 1, 800))} 800w" sizes="(max-width:600px) 100vw, 300px" data-fb="${esc(nome)}"`
      : `src="${placeholder(nome)}"`;
    const titulo = `${nome} ${d.versao} ${d.ano}`;
    return {
      id: d.id, carroceria: d.carroceria || '',
      zap: Motor.whatsapp(cfg, `Olá! Tenho interesse no ${titulo} (ref. ${d.id}). Ainda está disponível?`, idLoja[d.loja]),
      href: REL + LinkCarro.caminho(d), nome, versao: d.versao, ano: d.ano, km: `${num(d.km)} km`, cambio: d.cambio,
      cor: d.cor, combustivel: d.combustivel, preco: brl(d.preco), loja: d.loja, local,
      lojaLocal: motor.lojasMultiplas ? `${d.loja} · ${local}` : local, imgattrs,
    };
  }

  const PAG = Number($('#grade').dataset.pagina) || 24; // <div id="grade" data-pagina="8"> muda quantos cards aparecem por vez
  let mostrados = 0;
  function desenhar(reiniciar) {
    const grade = $('#grade');
    const lista = motor.resultado();
    if (reiniciar) { grade.innerHTML = ''; mostrados = 0; }
    const fatia = lista.slice(mostrados, mostrados + PAG);
    const antes = grade.children.length;
    grade.insertAdjacentHTML('beforeend', fatia.map((d) => preencher(tplCard, dadosCard(d))).join(''));
    [...grade.children].slice(antes).forEach((a) => { const i = a.querySelector('img[data-fb]'); if (i) UI.fallback(i); });
    mostrados += fatia.length;
    $('#mais').hidden = mostrados >= lista.length;
    const dica = motor.dica() ? ` · mostrando resultados para “${motor.dica()}”` : '';
    $('#contagem').textContent = lista.length ? `${num(lista.length)} carro${lista.length > 1 ? 's' : ''}${dica}` : 'Nenhum carro encontrado';
  }

  function salvarURL() {
    const p = new URLSearchParams(motor.query());
    const v = new URLSearchParams(location.search).get('v');
    if (v) p.set('v', v);
    const s = p.toString();
    try { history.replaceState(null, '', s ? `?${s}` : location.pathname); } catch (e) { /* ambientes sem histórico */ }
  }

  function sincronizar() {
    const e = motor.estado();
    if ($('#q') !== document.activeElement) $('#q').value = e.q;
    $('#ord').value = e.ord;
    motor.filtros.forEach((f) => {
      const sel = selects[f.campo];
      const html = `<option value="">${esc(f.rotulo)}</option>` + f.opcoes().map((o) => `<option value="${esc(o.valor)}">${esc(o.rotulo)}</option>`).join('');
      if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
      sel.value = f.valor();
    });
    desenhar(true);
    salvarURL();
  }

  $('#filtros').addEventListener('submit', (e) => e.preventDefault());
  $('#mais').addEventListener('click', () => desenhar(false));
  $('#limpar').addEventListener('click', () => motor.limpar());
  $('#copiar').addEventListener('click', (e) => UI.copiar(location.href, e.target));
  motor.aoMudar(sincronizar);
  sincronizar();
})();
