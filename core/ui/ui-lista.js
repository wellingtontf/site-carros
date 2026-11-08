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
  // link de cada carro: o "l" do estoque.json (link vindo do estoque, ex.: o do Revenda Mais) ou a regra do link-carro.js.
  // O motor não repassa campos que não conhece, então os links são guardados aqui ao carregar o estoque.json.
  const linkDe = new Map();
  // estoque.json compacto ("formatoEstoque": "compacto"): carrega motor/formato-estoque.js na hora e desempacota para a
  // lista de sempre (o motor recebe os mesmos dados; funciona com HTML antigo, sem o tema precisar do script)
  // scripts do core que só esta página precisa: carregados na hora (o tema não precisa listar)
  const script = (arq, nome) => window[nome] ? Promise.resolve(window[nome]) : new Promise((ok, erro) => {
    const s = document.createElement('script'); s.src = `${REL}motor/${arq}`;
    s.onload = () => ok(window[nome]); s.onerror = erro; document.head.appendChild(s);
  });
  const formato = () => script('formato-estoque.js', 'FormatoEstoque');
  const lista = (j) => (Array.isArray(j) ? j : formato().then((F) => F.descompactar(j)));
  const carregar = (u) => fetch(u).then((r) => r.json()).then(lista).then((j) => { if (Array.isArray(j)) j.forEach((d) => d.l && linkDe.set(d.i, d.l)); return j; });
  const [motor, cfg, Rotas] = await Promise.all([
    Motor.criar({ dados: `${REL}estoque.json`, config: `${REL}config.json`, carregar }),
    Motor.carregarConfig(`${REL}config.json`), // para o WhatsApp de cada card ([[zap]])
    script('rotas.js', 'Rotas').catch(() => null), // core/ui/rotas.js: filtros no caminho (/multipla/marca/Toyota/cidade/A|B)
  ]);
  // ROTA: na listagem (/multipla/...), os filtros ficam no caminho, em qualquer ordem; fora dela (home com o componente
  // "estoque"), na query como sempre. A hospedagem entrega multipla/index.html para qualquer /multipla/... (site estático).
  const rota = Rotas && Rotas.separar(location.pathname);
  // valor do filtro sem diferença de maiúscula/acento/espaço/hífen (?marca=caoa-chery → "CAOA Chery"; ?cidade=Maring →
  // "Maringá" quando só uma opção começa assim): é o que chega pelo 301 dos endereços antigos do Revenda Mais
  const chave = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function ajustarQuery(texto) {
    const p = new URLSearchParams(texto);
    for (let passo = 0; passo < 4; passo++) { // cascata (estado → cidade → loja; marca → modelo): cada passo acerta um nível
      motor.aplicarQuery(p.toString());
      let mudou = false;
      for (const f of motor.filtros) {
        const v = p.get(f.campo);
        if (!v || !f.opcoes) continue;
        const ops = f.opcoes().map((o) => String(o.valor));
        const acertar = (x) => { const k = chave(x); const comeca = ops.filter((o) => chave(o).startsWith(k));
          return ops.find((o) => chave(o) === k) || (k.length >= 4 && comeca.length === 1 ? comeca[0] : x); };
        const novo = v.split('|').map(acertar).join('|'); // vários valores: cada um acertado
        if (novo !== v) { p.set(f.campo, novo); mudou = true; }
      }
      if (!mudou) break;
    }
    return p.toString();
  }
  const idLoja = Object.fromEntries(Object.entries(cfg.lojas || {}).map(([id, l]) => [l.nome, id]));
  // filtros da URL: caminho (rota) + query (?marca=Toyota, links antigos; a query vale mais). data-filtro no <body>: HTML
  // antigo das páginas fixas de filtro.
  function queryInicial() {
    if (!rota) return location.search || document.body.dataset.filtro || '';
    const p = new URLSearchParams();
    for (const [k, v] of Rotas.ler(rota.resto)) p.set(k, v);
    const daQ = Rotas.daQuery(location.search);
    for (const [k, v] of daQ.pares) p.set(k, v);
    for (const [k, v] of new URLSearchParams(daQ.resto)) p.set(k, v);
    return p.toString();
  }
  motor.aplicarQuery(ajustarQuery(queryInicial()));
  Motor.vendedor(); // guarda ?v= se existir

  // busca e ordenação
  const q = $('#q'), ord = $('#ord');
  if (q) { q.hidden = !motor.buscaAtiva; q.addEventListener('input', (e) => motor.buscar(e.target.value)); }
  if (ord) {
    ord.innerHTML = motor.ordens.map((o) => `<option value="${o.chave}">${esc(o.rotulo)}</option>`).join('');
    ord.hidden = motor.ordens.length < 2;
    ord.addEventListener('change', (e) => motor.ordenar(e.target.value));
  }

  // um select por filtro configurado no site; os campos de data-checkbox (opção "checkbox" do componente filtro) viram
  // caixas de marcar com várias escolhas (motor v3+: valores()). Motor antigo: continua select.
  const selects = {}, grupos = {};
  const caixaFiltros = $('#filtros-dinamicos');
  const comCaixas = new Set(((caixaFiltros && caixaFiltros.dataset.checkbox) || '').split(',').map((x) => x.trim()).filter(Boolean));
  const abertos = !!caixaFiltros && caixaFiltros.dataset.checkboxAberto === 'true';
  if (caixaFiltros) motor.filtros.forEach((f) => {
    if (comCaixas.has(f.campo) && f.tipo === 'lista' && f.valores) {
      const g = document.createElement('details');
      g.className = 'c-filtro__grupo';
      g.id = `f-${f.campo}`;
      g.open = abertos;
      g.innerHTML = `<summary><span>${esc(f.rotulo)}</span><span class="c-filtro__marcados"></span></summary><div class="c-filtro__opcoes" role="group" aria-label="${esc(f.rotulo)}"></div>`;
      g.addEventListener('change', () => motor.definir(f.campo, [...g.querySelectorAll('input:checked')].map((i) => i.value)));
      caixaFiltros.appendChild(g);
      grupos[f.campo] = g;
      return;
    }
    const sel = document.createElement('select');
    sel.id = `f-${f.campo}`;
    sel.setAttribute('aria-label', f.rotulo);
    sel.addEventListener('change', () => motor.definir(f.campo, sel.value));
    caixaFiltros.appendChild(sel);
    selects[f.campo] = sel;
  });

  // card: o tema define o HTML com [[campos]]
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
    try {
      if (rota) history.replaceState(null, '', urlDaRota(p));
      else history.replaceState(null, '', s ? `?${s}` : location.pathname);
    } catch (e) { /* ambientes sem histórico */ }
  }
  // /<...>/multipla/<campo>/<valor>/... na ORDEM dos filtros do site (o mesmo filtro = o mesmo endereço) + ?q=&ord=&v=
  const canonical = document.querySelector('link[rel="canonical"]');
  const canonBase = canonical && canonical.getAttribute('href');
  function urlDaRota(p) {
    const pares = motor.filtros.filter((f) => p.get(f.campo)).map((f) => [f.campo, p.get(f.campo)]);
    pares.forEach(([k]) => p.delete(k));
    const caminho = Rotas.montar(pares);
    if (canonBase) canonical.setAttribute('href', canonBase.replace(/\/?$/, '/') + caminho); // cada combinação de filtros é um endereço
    const s = p.toString();
    return rota.base + caminho + (s ? `?${s}` : '');
  }

  // FILTROS ATIVOS (componente filtros-ativos): uma etiqueta por filtro aplicado, com X; o botão limpa todos
  const ativos = $('#filtros-ativos');
  function desenharAtivos() {
    if (!ativos) return;
    const comRotulo = ativos.dataset.rotulos === 'true';
    const etiquetas = [];
    const e = motor.estado();
    if (ativos.dataset.busca !== 'false' && e.q) etiquetas.push({ campo: 'q', valor: e.q, texto: `“${e.q}”` });
    motor.filtros.forEach((f) => {
      const vs = f.valores ? f.valores() : (f.valor() ? [f.valor()] : []);
      for (const v of vs) {
        const op = f.tipo === 'lista' ? null : f.opcoes().find((o) => o.valor === v); // "até R$ 80.000", "a partir de 2020"
        const t = op ? op.rotulo : v;
        etiquetas.push({ campo: f.campo, valor: v, texto: comRotulo ? `${f.rotulo}: ${t}` : t });
      }
    });
    ativos.querySelector('.c-ativos__lista').innerHTML = etiquetas.map((x) =>
      `<button type="button" class="c-ativos__chip" data-campo="${esc(x.campo)}" data-valor="${esc(x.valor)}" aria-label="Tirar ${esc(x.texto)}">${esc(x.texto)} <span aria-hidden="true">✕</span></button>`).join('');
    ativos.hidden = !etiquetas.length;
  }
  if (ativos) ativos.addEventListener('click', (ev) => {
    if (ev.target.closest('.c-ativos__limpar')) return motor.limpar();
    const b = ev.target.closest('.c-ativos__chip');
    if (!b) return;
    const { campo, valor } = b.dataset;
    if (campo === 'q') return motor.buscar('');
    const f = motor.filtros.find((x) => x.campo === campo);
    if (f && f.valores) motor.definir(campo, f.valores().filter((v) => v !== valor)); // tira só este valor
    else motor.definir(campo, '');
  });

  function sincronizar() {
    const e = motor.estado();
    if (q && q !== document.activeElement) q.value = e.q;
    if (ord) ord.value = e.ord;
    motor.filtros.forEach((f) => {
      const g = grupos[f.campo];
      if (g) {
        // opções do estoque + o valor do link que não tem carro (fica marcado: a lista mostra "nenhum carro")
        const vs = f.valores();
        const ops = f.opcoes().map((o) => o.valor);
        const todas = [...ops, ...vs.filter((v) => !ops.includes(v))];
        const sig = todas.join('|');
        const box = g.querySelector('.c-filtro__opcoes');
        if (g.dataset.sig !== sig) {
          box.innerHTML = todas.map((v) => `<label><input type="checkbox" name="${esc(f.campo)}" value="${esc(v)}"><span>${esc(v)}</span></label>`).join('');
          g.dataset.sig = sig;
        }
        box.querySelectorAll('input').forEach((i) => { i.checked = vs.includes(i.value); });
        g.querySelector('.c-filtro__marcados').textContent = vs.length ? String(vs.length) : '';
        if (vs.length && !abertos && !g.dataset.abriu) { g.open = true; g.dataset.abriu = '1'; } // chegou pelo link já marcado: mostra
        return;
      }
      const sel = selects[f.campo];
      if (!sel) return;
      // vários valores (vindos do link: cidade/Canoas|Cascavel): uma opção a mais com o grupo escolhido
      // ...e o valor do link que não tem carro no estoque (a lista mostra "nenhum carro"; o select não fica em branco)
      const vs = f.valores ? f.valores() : [];
      const existe = vs.length === 1 && f.opcoes().some((o) => o.valor === vs[0]);
      const grupo = vs.length && !existe ? `<option value="${esc(f.valor())}">${esc(vs.slice(0, 2).join(', '))}${vs.length > 2 ? ` +${vs.length - 2}` : ''}</option>` : '';
      const html = `<option value="">${esc(f.rotulo)}</option>` + grupo + f.opcoes().map((o) => `<option value="${esc(o.valor)}">${esc(o.rotulo)}</option>`).join('');
      if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
      sel.value = f.valor();
    });
    desenharAtivos();
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
