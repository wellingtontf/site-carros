/* Motor de busca e filtros, versão __VERSAO__.
   Não mexe em tela: roda no navegador e no Node (testes). Os templates cuidam só da aparência.
   Uso (navegador):  const motor = await Motor.criar({ dados: 'estoque.json', config: 'config.json' });
   Uso (testes):     const Motor = require('./engine.js'); passando `carregar` para ler os arquivos. */
(function (raiz) {
  'use strict';
  const VERSAO = '__VERSAO__';

  // ---------- utilidades ----------
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('pt-BR');
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const foto = (base, id, n, w) => `${base}carros/${id}/${n}-${w}.webp`;
  const placeholder = (t) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e8ecf1"/><text x="200" y="158" font-family="sans-serif" font-size="20" fill="#7b8794" text-anchor="middle">${esc(t)}</text></svg>`
    );

  // Distância de edição (inserir, apagar, trocar, inverter letras vizinhas). Para na hora se passar de `max`.
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let min = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < min) min = v;
      }
      if (min > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  // ---------- campos que podem virar filtro (cada site escolhe quais usar) ----------
  // k = campo do carro; dep = filtro "pai": a lista só mostra o que existe nos pais escolhidos
  const CAMPOS = {
    estado: { k: 'uf', rotulo: 'Estado' },
    cidade: { k: 'cidade', rotulo: 'Cidade', dep: 'estado' },
    loja: { k: 'loja', rotulo: 'Loja', dep: 'cidade' },
    marca: { k: 'marca', rotulo: 'Marca' },
    modelo: { k: 'modelo', rotulo: 'Modelo', dep: 'marca' },
    ano: { k: 'ano', rotulo: 'Ano', tipo: 'minimo', opcoes: [2024, 2022, 2020, 2018, 2016, 2014], fmt: (v) => `a partir de ${v}` },
    preco: { k: 'preco', rotulo: 'Preço', tipo: 'maximo', opcoes: [40000, 60000, 80000, 100000, 150000, 200000, 300000], fmt: (v) => `até ${brl(v)}` },
    km: { k: 'km', rotulo: 'Km', tipo: 'maximo', opcoes: [20000, 50000, 80000, 120000], fmt: (v) => `até ${num(v)} km` },
    cambio: { k: 'cambio', rotulo: 'Câmbio' },
    combustivel: { k: 'combustivel', rotulo: 'Combustível' },
    cor: { k: 'cor', rotulo: 'Cor' },
    carroceria: { k: 'carroceria', rotulo: 'Carroceria' },
  };
  const PADRAO = ['estado', 'cidade', 'loja', 'marca', 'modelo', 'carroceria', 'ano', 'preco', 'km', 'cambio', 'combustivel', 'cor'];
  // a primeira ordem da lista do site é a padrão. "destaque" = a ordem em que os carros vêm no estoque (campo "ordem")
  const ORDENS = {
    destaque: ['Destaques', (a, b) => a.ordem - b.ordem],
    recentes: ['Mais novos', (a, b) => b.ano - a.ano || a.preco - b.preco],
    menor: ['Menor preço', (a, b) => a.preco - b.preco],
    maior: ['Maior preço', (a, b) => b.preco - a.preco],
    km: ['Menor km', (a, b) => a.km - b.km],
  };

  async function criar(opts) {
    const carregar = opts.carregar || ((u) => fetch(u).then((r) => r.json()));
    const [brutos, cfg] = await Promise.all([
      carregar(opts.dados),
      opts.config ? Promise.resolve(carregar(opts.config)).catch(() => ({})) : Promise.resolve({}),
    ]);

    // estoque.json (o gerado em sites-public) usa chaves curtas; aqui viram nomes completos
    const palavras = (s) => norm(s).split(/[^a-z0-9.]+/).filter(Boolean);
    const dados = brutos.map((d, i) => {
      const c = { id: d.i, marca: d.m, modelo: d.o, versao: d.v, ano: d.a, preco: d.p, km: d.k, cor: d.c, cambio: d.b, combustivel: d.f, fotos: d.n, loja: d.u, cidade: d.cd, uf: d.uf,
        carroceria: d.cr || '', ordem: typeof d.r === 'number' ? d.r : i };
      const texto = `${c.marca} ${c.modelo} ${c.versao} ${c.ano} ${c.cor} ${c.cambio} ${c.combustivel} ${c.carroceria} ${c.loja} ${c.cidade} ${c.uf}`;
      c._s = norm(texto);
      c._k = [...new Set(palavras(texto))];
      return c;
    });
    const unicos = (k, lst = dados) => [...new Set(lst.map((d) => d[k]))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

    // ---------- filtros deste site ----------
    const defs = (cfg.filtros && cfg.filtros.length ? cfg.filtros : PADRAO)
      .map((x) => (typeof x === 'string' ? { campo: x } : x))
      .filter((x) => CAMPOS[x.campo])
      .map((x) => {
        const b = CAMPOS[x.campo];
        return { ...b, ...x, tipo: x.tipo || b.tipo || 'lista', rotulo: x.rotulo || b.rotulo, opcoes: x.opcoes || b.opcoes, valor: '' };
      })
      // lista com 0 ou 1 valor não ajuda ninguém (ex.: site de uma cidade só); "sempre": true força
      .filter((f) => f.tipo !== 'lista' || f.sempre || unicos(f.k).filter((v) => v !== '' && v != null).length > 1);
    defs.forEach((f) => (f.pai = (f.dep && defs.find((p) => p.campo === f.dep)) || null));
    const ancestrais = (f) => (f.pai ? [f.pai, ...ancestrais(f.pai)] : []);
    const descendentes = (f) => defs.filter((c) => ancestrais(c).includes(f));
    const porProfundidade = [...defs].sort((a, b) => ancestrais(a).length - ancestrais(b).length);

    const opcoesDe = (f) => {
      if (f.tipo !== 'lista') return f.opcoes.map((v) => ({ valor: String(v), rotulo: f.fmt(v) }));
      const pais = ancestrais(f).filter((p) => p.valor);
      const base = pais.length ? dados.filter((d) => pais.every((p) => String(d[p.k]) === p.valor)) : dados;
      return unicos(f.k, base).filter((v) => v !== '' && v != null).map((v) => ({ valor: String(v), rotulo: String(v) })); // campo vazio não vira opção
    };
    const validar = () => porProfundidade.forEach((f) => { if (f.valor && !opcoesDe(f).some((o) => o.valor === f.valor)) f.valor = ''; });

    const ordens = (cfg.ordenacao && cfg.ordenacao.length ? cfg.ordenacao : Object.keys(ORDENS)).filter((k) => ORDENS[k]);
    const estado = { q: '', ord: ordens[0] };
    const buscaAtiva = cfg.busca !== false;

    // ---------- busca aproximada ----------
    const vocab = [...new Set(dados.flatMap((d) => d._k))].filter((k) => !/^[0-9.]+$/.test(k));
    const cacheExato = new Map();
    const cacheAprox = new Map();
    const existeExato = (t) => {
      if (!cacheExato.has(t)) cacheExato.set(t, dados.some((d) => d._s.includes(t)));
      return cacheExato.get(t);
    };
    // Só roda quando NENHUM carro tem o termo exato: acha as palavras parecidas ("civc" → civic).
    // Termos com menos de 4 letras e números (ano, versão) nunca são aproximados.
    function aproximar(termo) {
      if (cacheAprox.has(termo)) return cacheAprox.get(termo);
      const t = termo.replace(/[^a-z0-9.]/g, '');
      let res = null;
      if (t.length >= 4 && !/^[0-9.]+$/.test(t)) {
        const tol = t.length >= 7 ? 2 : 1;
        const achadas = [];
        for (const k of vocab) {
          let dd = dist(t, k, tol);
          if (dd > tol && k.length > t.length) dd = dist(t, k.slice(0, t.length), tol); // digitando e errando
          if (dd <= tol) achadas.push([k, dd]);
        }
        if (achadas.length) {
          // fica só com as mais parecidas; se empatar (preta → prata ou preto), vale todas
          const md = Math.min(...achadas.map((x) => x[1]));
          const melhores = achadas.filter((x) => x[1] === md).map((x) => x[0]).sort();
          res = { ok: new Set(melhores), melhor: melhores.join(' ou ') };
        }
      }
      cacheAprox.set(termo, res);
      return res;
    }

    // ---------- resultado ----------
    let resultado = [];
    let corrigidos = [];
    function calcular() {
      const termos = buscaAtiva ? norm(estado.q).split(/\s+/).filter(Boolean) : [];
      const ativos = defs.filter((f) => f.valor);
      corrigidos = [];
      const casam = termos.map((t) => {
        if (existeExato(t)) return (d) => d._s.includes(t);
        const a = aproximar(t);
        if (!a) return () => false;
        corrigidos.push(a.melhor);
        return (d) => d._k.some((k) => a.ok.has(k));
      });
      resultado = dados
        .filter((d) =>
          ativos.every((f) => {
            if (f.tipo === 'minimo') return d[f.k] >= +f.valor;
            if (f.tipo === 'maximo') return d[f.k] <= +f.valor;
            return String(d[f.k]) === f.valor;
          }) && casam.every((m) => m(d))
        )
        .sort(ORDENS[estado.ord][1]);
    }

    const ouvintes = [];
    const mudou = () => { calcular(); ouvintes.forEach((fn) => fn(api)); };

    const api = {
      versao: VERSAO,
      config: cfg,
      total: dados.length,
      buscaAtiva,
      lojasMultiplas: unicos('loja').length > 1,
      ordens: ordens.map((k) => ({ chave: k, rotulo: ORDENS[k][0] })),
      filtros: defs.map((f) => ({ campo: f.campo, rotulo: f.rotulo, tipo: f.tipo, valor: () => f.valor, opcoes: () => opcoesDe(f) })),
      estado: () => ({ q: estado.q, ord: estado.ord, valores: Object.fromEntries(defs.map((f) => [f.campo, f.valor])) }),
      resultado: () => resultado,
      // palavras em que a busca aproximada trocou o que foi digitado ("" quando não houve troca)
      dica: () => (corrigidos.length && resultado.length ? corrigidos.join(' ') : ''),
      definir(campo, valor) {
        const f = defs.find((x) => x.campo === campo);
        if (!f) return;
        f.valor = String(valor || '');
        validar(); // trocar o estado limpa a cidade/loja que não existem mais
        mudou();
      },
      buscar(q) { estado.q = String(q || ''); mudou(); },
      ordenar(chave) { if (ORDENS[chave] && ordens.includes(chave)) { estado.ord = chave; mudou(); } },
      limpar() { estado.q = ''; estado.ord = ordens[0]; defs.forEach((f) => (f.valor = '')); mudou(); },
      // Estado ↔ link: "estado=SP&cidade=Campinas&q=civic&ord=menor"
      query() {
        const p = new URLSearchParams();
        if (estado.q) p.set('q', estado.q);
        defs.forEach((f) => f.valor && p.set(f.campo, f.valor));
        if (estado.ord !== ordens[0]) p.set('ord', estado.ord);
        return p.toString();
      },
      aplicarQuery(texto) {
        const p = new URLSearchParams(texto);
        estado.q = buscaAtiva ? p.get('q') || '' : '';
        porProfundidade.forEach((f) => { const v = p.get(f.campo); f.valor = v && opcoesDe(f).some((o) => o.valor === v) ? v : ''; });
        estado.ord = ordens.includes(p.get('ord')) ? p.get('ord') : ordens[0];
        mudou();
      },
      aoMudar(fn) { ouvintes.push(fn); },
    };
    calcular();
    return api;
  }

  // ---------- WhatsApp e vendedor ----------
  // ?v=joao no link manda o WhatsApp para o vendedor certo (lembrado entre páginas).
  function vendedor() {
    if (typeof location === 'undefined') return null;
    const q = new URLSearchParams(location.search).get('v');
    try { if (q) localStorage.setItem('vend', q); return q || localStorage.getItem('vend'); } catch (e) { return q; }
  }
  // Sem vendedor: WhatsApp da loja do carro; se a loja não tiver, o do site.
  function whatsapp(cfg, texto, lojaId) {
    const v = vendedor();
    const loja = (cfg.lojas && cfg.lojas[lojaId]) || {};
    const numero = (v && cfg.vendedores && cfg.vendedores[v]) || loja.whatsapp || cfg.whatsapp || '';
    return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
  }
  async function carregarConfig(url) {
    try { return await (await fetch(url)).json(); } catch (e) { return {}; }
  }

  const Motor = { versao: VERSAO, criar, vendedor, whatsapp, carregarConfig, util: { norm, esc, num, brl, foto, placeholder } };
  raiz.Motor = Motor;
  if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
})(typeof globalThis !== 'undefined' ? globalThis : this);
