// Liga a página de listagem ao motor. O HTML (e o formato do card, em #tpl-card) vem do template ou dos componentes
// (componentes/filtro, componentes/estoque). Ids: q, filtros-dinamicos, ord, contagem, grade, mais, limpar, copiar, tpl-card.
// Só #grade e #tpl-card são obrigatórios: sem o resto (ex.: componente "estoque" na home, sem o "filtro"), a peça que
// falta simplesmente não aparece. HTML antigo (com todos os ids) continua funcionando igual.
// Precisa de motor/link-carro.js carregado antes (link da página de cada carro).
(async () => {
  const $ = (s) => document.querySelector(s);
  const { brl, num, esc, foto, placeholder } = Motor.util;
  const BASE = document.body.dataset.base || '';
  const REL = document.body.dataset.rel || ''; // a listagem pode ficar numa subpasta (ex.: /estoque/): REL leva à raiz do site
  // link de cada carro: o "l" do carros.json (link vindo do estoque, ex.: o do Revenda Mais) ou a regra do link-carro.js.
  // O motor não repassa campos que não conhece, então os links são guardados aqui ao carregar o carros.json.
  const linkDe = new Map();
  const carregar = (u) => fetch(u).then((r) => r.json()).then((j) => { if (Array.isArray(j)) j.forEach((d) => d.l && linkDe.set(d.i, d.l)); return j; });
  const [motor, cfg] = await Promise.all([
    Motor.criar({ dados: `${REL}carros.json`, config: `${REL}config.json`, carregar }),
    Motor.carregarConfig(`${REL}config.json`), // para o WhatsApp de cada card ([[zap]])
  ]);
  const idLoja = Object.fromEntries(Object.entries(cfg.lojas || {}).map(([id, l]) => [l.nome, id]));
  // página fixa de filtro (/multipla/marca/toyota/): o <body data-filtro="marca=Toyota"> vale quando a URL não traz outro
  motor.aplicarQuery(location.search || document.body.dataset.filtro || '');
  Motor.vendedor(); // guarda ?v= se existir

  // busca e ordenação
  const q = $('#q'), ord = $('#ord');
  if (q) { q.hidden = !motor.buscaAtiva; q.addEventListener('input', (e) => motor.buscar(e.target.value)); }
  if (ord) {
    ord.innerHTML = motor.ordens.map((o) => `<option value="${o.chave}">${esc(o.rotulo)}</option>`).join('');
    ord.hidden = motor.ordens.length < 2;
    ord.addEventListener('change', (e) => motor.ordenar(e.target.value));
  }

  // um select por filtro configurado no site
  const selects = {};
  const caixaFiltros = $('#filtros-dinamicos');
  if (caixaFiltros) motor.filtros.forEach((f) => {
    const sel = document.createElement('select');
    sel.id = `f-${f.campo}`;
    sel.setAttribute('aria-label', f.rotulo);
    sel.addEventListener('change', () => motor.definir(f.campo, sel.value));
    caixaFiltros.appendChild(sel);
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
      href: REL + (linkDe.get(d.id) || LinkCarro.caminho(d)).split('/').map(encodeURIComponent).join('/'), nome, versao: d.versao, ano: d.ano, km: `${num(d.km)} km`, cambio: d.cambio,
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
    if ($('#mais')) $('#mais').hidden = mostrados >= lista.length;
    const dica = motor.dica() ? ` · mostrando resultados para “${motor.dica()}”` : '';
    if ($('#contagem')) $('#contagem').textContent = lista.length ? `${num(lista.length)} carro${lista.length > 1 ? 's' : ''}${dica}` : 'Nenhum carro encontrado';
  }

  // na página fixa de filtro (/multipla/cidade/ponta-grossa/), o filtro dela não vai para a URL: a própria página já é
  // a cidade (senão o link compartilhado fica /cidade/ponta-grossa/?cidade=Ponta+Grossa). Só o que a pessoa mudar entra.
  const filtroPagina = new URLSearchParams(document.body.dataset.filtro || '');
  function salvarURL() {
    const p = new URLSearchParams(motor.query());
    for (const [k, val] of filtroPagina) if (p.get(k) === val) p.delete(k);
    const v = new URLSearchParams(location.search).get('v');
    if (v) p.set('v', v);
    const s = p.toString();
    try { history.replaceState(null, '', s ? `?${s}` : location.pathname); } catch (e) { /* ambientes sem histórico */ }
  }

  function sincronizar() {
    const e = motor.estado();
    if (q && q !== document.activeElement) q.value = e.q;
    if (ord) ord.value = e.ord;
    motor.filtros.forEach((f) => {
      const sel = selects[f.campo];
      if (!sel) return;
      const html = `<option value="">${esc(f.rotulo)}</option>` + f.opcoes().map((o) => `<option value="${esc(o.valor)}">${esc(o.rotulo)}</option>`).join('');
      if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
      sel.value = f.valor();
    });
    desenhar(true);
    salvarURL();
  }

  const liga = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  liga('#filtros', 'submit', (e) => e.preventDefault());
  liga('#mais', 'click', () => desenhar(false));
  liga('#limpar', 'click', () => motor.limpar());
  liga('#copiar', 'click', (e) => UI.copiar(location.href, e.target));
  motor.aoMudar(sincronizar);
  sincronizar();
})();
