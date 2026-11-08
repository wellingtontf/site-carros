// Rotas da API v1: o que cada endereço faz. Só traduz HTTP ↔ core: a regra de negócio (validar estoque, validar
// cadastro, gerar site, fotos) mora em core/. O contrato para quem integra está em api/README.md.
const fs = require('fs');
const AT = require('../core/atualizar');
const Ops = require('../core/operacoes');
const Sites = require('../core/sites');
const Fotos = require('../core/fotos');
const Robots = require('../core/robots');
const Inq = require('../core/inquilinos');
const C = require('../core/caminhos');
const CL = require('./clientes');
const { Erro, corpo, corpoBinario, corpoJSON, enviar } = require('./http');
const Arq = require('../core/arquivos-site');

const ID_CARRO = /^[A-Za-z0-9._-]{1,80}$/;
const LIMITE = { estoque: 100e6, lote: 200e6, carro: 1e6, site: 2e6, outro: 100e3 };

const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; } };
const comCarros = (b) => (Array.isArray(b) ? { carros: b } : b); // aceita a lista pura também

const visao = (p) => p && ({
  pedido: p.id, tipo: p.tipo, site: p.site, ...(p.carro ? { carro: p.carro } : {}), status: p.status,
  criado: p.criado, inicio: p.inicio, fim: p.fim, erros: p.erros, resultado: p.resultado, ...(p.publicacao ? { publicacao: p.publicacao } : {}),
  link: `/v1/pedidos/${p.id}`,
});
const CODIGO_FINAL = { concluido: 200, invalido: 422, recusado: 409, erro: 500 };
const segundos = (url) => Math.min(120, Math.max(0, Number(url.searchParams.get('esperar')) || 0));

// avisos do cadastro (campo que a plataforma não usa: provável erro de digitação). Vão junto na resposta, sem impedir.
const comAvisos = (cad) => { const a = Sites.avisosSite(cad); return a.length ? { avisos: a } : {}; };

function criarRotas({ fila }) {
  // um pedido: 202 (na fila) ou, com ?esperar=N, o resultado (200 concluído; 422 inválido; 409 recusado; 500 erro)
  // codigoAceito/codigoConcluido: 201 quando o pedido cria um site
  // extra: campos a mais na resposta (ex.: avisos de campo desconhecido no cadastro)
  async function responderPedido(res, url, p, codigoAceito = 202, codigoConcluido = 200, extra = {}) {
    const seg = segundos(url);
    if (!seg) return enviar(res, codigoAceito, { ...visao(p), ...extra });
    const fim = await fila.aguardar(p.id, seg * 1000);
    enviar(res, fim.status === 'concluido' ? codigoConcluido : CODIGO_FINAL[fim.status] || 202, { ...visao(fim), ...extra });
  }
  // operação em muitos sites (todos do inquilino): um pedido por site, agrupados num LOTE (os trabalhadores dividem o
  // serviço). Resposta = resumo do lote; com ?esperar, 200 se todos concluíram, 207 se algum não, 202 se não deu tempo.
  async function responderLote(res, url, ps, descricao) {
    if (!ps.length) return enviar(res, 200, { lote: null, total: 0, concluido: true, contagem: {}, problemas: [] });
    const id = fila.criarLote(ps, descricao);
    const seg = segundos(url);
    const l = seg ? await fila.aguardarLote(id, seg * 1000) : fila.lote(id);
    enviar(res, !seg || !l.concluido ? 202 : l.contagem.concluido === l.total ? 200 : 207, l);
  }
  // vários pedidos: 202; com ?esperar, 200 se todos concluíram, 207 se algum não
  async function responderVarios(res, url, ps, extra = {}) {
    const seg = segundos(url);
    const fins = seg ? await Promise.all(ps.map((p) => fila.aguardar(p.id, seg * 1000))) : ps;
    const code = !seg ? 202 : fins.every((p) => p.status === 'concluido') && !Object.keys(extra.recusados || {}).length ? 200 : 207;
    enviar(res, code, { pedidos: fins.map(visao), ...extra });
  }

  return async function rotear(req, res, url, cliente) {
    const m = req.method;
    const p = url.pathname;
    const forcar = url.searchParams.get('forcar') === '1';
    // site existente e permitido para este token
    const site = (d) => {
      if (!Sites.existe(d)) throw new Erro(404, `site "${d}" não existe`);
      if (!CL.pode(cliente, d)) throw new Erro(403, `este token não tem acesso ao site "${d}"`);
      return d;
    };
    const exigirTodos = (oque) => { if (!cliente.sites.includes('*')) throw new Erro(403, `${oque} exige um token com acesso a todos os sites ("*")`); };
    // inquilino em que a operação acontece: o do token; o admin escolhe (?inquilino= ou "inquilino" no corpo; sem isso, "padrao")
    const inquilinoAlvo = (pedido) => {
      if (!cliente.admin) { if (pedido && pedido !== cliente.inquilino) throw new Erro(403, `este token é do inquilino "${cliente.inquilino}"`); return cliente.inquilino; }
      const i = pedido || Inq.PADRAO;
      if (!Inq.existe(i)) throw new Erro(422, `inquilino "${i}" não existe`);
      return i;
    };

    // ---------- gerais ----------
    if (m === 'GET' && p === '/v1/status') return enviar(res, 200, { ...fila.estado(), cliente: cliente.nome, inquilino: cliente.inquilino });
    let lr = /^\/v1\/lotes\/([a-z0-9]+)$/.exec(p);
    if (m === 'GET' && lr) { const l = fila.lote(lr[1]); if (!l) throw new Erro(404, 'lote não encontrado'); return enviar(res, 200, l); }
    // sites que a operação "todos" alcança: os do inquilino do token (o admin escolhe com ?inquilino=, ou a plataforma toda)
    const sitesDoAlcance = () => (cliente.admin ? (url.searchParams.get('inquilino') ? Sites.listar({ inquilino: inquilinoAlvo(url.searchParams.get('inquilino')) }) : Sites.listar())
      : Sites.listar({ inquilino: cliente.inquilino }).filter((d) => CL.pode(cliente, d)));
    if (m === 'GET' && p === '/v1/sites') {
      return enviar(res, 200, { sites: Sites.resumos((d) => CL.pode(cliente, d)) });
    }

    // SITE NOVO com toda a estrutura (pasta, cadastro, estoque vazio, site gerado, infra). O resto vem de
    // config/site-modelo.json, e o que vier em "cadastro" vale mais. {"dominio": "...", "cadastro": {...}}
    // SEM "dominio": cria o próximo RASCUNHO da sequência (site1.carro57.com.br, site2...; config/rascunhos.json)
    if (m === 'POST' && p === '/v1/sites') {
      exigirTodos('criar um site novo');
      const b = await corpoJSON(req, LIMITE.site, {});
      const inq = inquilinoAlvo(b.inquilino || url.searchParams.get('inquilino'));
      if (b.dominio == null) {
        let d;
        try { d = Sites.proximoRascunho({ inquilino: inq }); } catch (e) { throw new Erro(422, e.message); }
        return criar(d, b.cadastro || {}, inq, true);
      }
      const d = b.dominio;
      if (typeof d !== 'string' || !Sites.ID_SITE.test(d)) throw new Erro(422, 'informe "dominio" válido (ex.: novaloja.com.br, só minúsculas, sem www nem https), ou nenhum para criar o próximo rascunho');
      return criar(d, b.cadastro || {}, inq);
    }

    // estoque de 1 ou N sites numa chamada: {"sites": {"a.com.br": {"carros":[...]}, "b.com.br": [...]}}
    // cada site é independente: os válidos entram, os inválidos voltam em "recusados" com o motivo
    if (m === 'POST' && p === '/v1/estoques') {
      const b = await corpoJSON(req, LIMITE.lote);
      if (!b || typeof b.sites !== 'object' || Array.isArray(b.sites) || !Object.keys(b.sites).length) throw new Erro(400, 'esperado {"sites": {"<dominio>": {"carros": [...]}, ...}}');
      const recusados = {};
      const aceitos = [];
      for (const [d, est] of Object.entries(b.sites)) {
        try {
          site(d);
          const obj = comCarros(est);
          const erros = AT.validarEstoque(obj, Sites.lojas(d));
          if (erros.length) throw new Erro(422, 'estoque inválido: nada foi gravado', { erros });
          aceitos.push([d, obj]);
        } catch (e) { if (!(e instanceof Erro)) throw e; recusados[d] = { codigo: e.code, erro: e.message, ...e.extra }; }
      }
      if (!aceitos.length) throw new Erro(422, 'nenhum site aceito', { recusados });
      const ps = aceitos.map(([d, obj]) => fila.adicionar({ tipo: 'estoque', site: d, corpo: { carros: obj.carros }, cliente: cliente.nome, forcar }));
      return responderVarios(res, url, ps, Object.keys(recusados).length ? { recusados } : {});
    }

    // refazer sites sem mudar estoque: {"sites": ["a.com.br", ...]} ou vazio / {"todos": true} = TODOS.
    // "completo": true (ou ?completo=1) regera TODAS as páginas, mantendo o histórico; sem ele, só o que mudou.
    if (m === 'POST' && p === '/v1/build') {
      const b = await corpoJSON(req, LIMITE.outro, {});
      if (b.sites != null && !(Array.isArray(b.sites) && b.sites.every((x) => typeof x === 'string'))) throw new Erro(400, '"sites" deve ser uma lista de domínios');
      const completo = b.completo === true || url.searchParams.get('completo') === '1';
      if (b.sites && b.sites.length && !b.todos) {
        const lista = [...new Set(b.sites)].map(site);
        return responderVarios(res, url, lista.map((d) => fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome, completo })));
      }
      exigirTodos('refazer todos os sites');
      return responderLote(res, url, sitesDoAlcance().map((d) => fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome, completo })), completo ? 'refazer todos os sites (todas as páginas)' : 'refazer todos os sites');
    }

    // robots.txt de TODOS os sites: um modelo com {{sitemap}} {{url}} {{dominio}}. Corpo em texto puro ou {"conteudo": "..."}.
    // Site com "robots" próprio no cadastro mantém o dele. Tirar os sites do Google (Disallow: /) exige ?forcar=1.
    // Multi-tenant: o modelo é DO INQUILINO do token (o admin escolhe com ?inquilino=) e vale para os sites dele.
    if (p === '/v1/robots') {
      const inq = inquilinoAlvo(url.searchParams.get('inquilino'));
      if (m === 'GET') {
        const modelo = Robots.lerModelo(inq);
        return enviar(res, 200, { inquilino: inq, modelo: modelo ?? Robots.PADRAO, padrao: modelo == null, marcadores: ['{{sitemap}}', '{{url}}', '{{dominio}}'] });
      }
      if (m === 'PUT' || m === 'DELETE') {
        exigirTodos('mudar o robots.txt de todos os sites');
        let texto = null;
        if (m === 'PUT') {
          const bruto = await corpo(req, LIMITE.outro);
          // JSON {"conteudo": "..."} (mesmo sem content-type: muito sistema esquece o cabeçalho) ou texto puro
          const ehJson = /json/i.test(req.headers['content-type'] || '') || /^\s*\{/.test(bruto);
          texto = ehJson ? (() => { try { return JSON.parse(bruto).conteudo; } catch (e) { throw new Erro(400, `JSON inválido: ${e.message}`); } })() : bruto;
          const { erros, perigos } = Robots.validarRobots(texto);
          if (erros.length) throw new Erro(422, 'robots.txt inválido: nada foi gravado', { erros });
          if (perigos.length && !forcar) throw new Erro(409, 'robots.txt perigoso: confirme com ?forcar=1 se é isso mesmo (vale para TODOS os sites)', { perigos });
        }
        Robots.gravarModelo(inq, texto); // DELETE: volta ao padrão
        const alvo = Sites.listar({ inquilino: inq }).filter((d) => cliente.admin || CL.pode(cliente, d));
        return responderLote(res, url, alvo.map((d) => fila.adicionar({ tipo: 'robots', site: d, cliente: cliente.nome })), `robots.txt do inquilino ${inq}`);
      }
    }

    // puxar das URLs de config/fontes.json
    if (m === 'POST' && p === '/v1/atualizar') {
      const b = await corpoJSON(req, LIMITE.outro, {});
      if (b.sites != null && !(Array.isArray(b.sites) && b.sites.every((x) => typeof x === 'string'))) throw new Erro(400, '"sites" deve ser uma lista de domínios');
      if (b.sites && b.sites.length && !b.todos) {
        const ps = b.sites.map(site).map((d) => fila.adicionar({ tipo: 'buscar', site: d, cliente: cliente.nome, forcar }));
        return ps.length === 1 ? responderPedido(res, url, ps[0]) : responderVarios(res, url, ps);
      }
      exigirTodos('atualizar todos os sites');
      const fontes = Object.keys(lerJSON(C.config('fontes.json'), {}));
      return responderLote(res, url, sitesDoAlcance().filter((d) => fontes.includes(d)).map((d) => fila.adicionar({ tipo: 'buscar', site: d, cliente: cliente.nome, forcar })), 'buscar o estoque nas fontes');
    }

    if (m === 'GET' && p === '/v1/pedidos') {
      const d = url.searchParams.get('site');
      if (d) site(d);
      return enviar(res, 200, { pedidos: fila.listar({ site: d, cliente: cliente.admin ? null : cliente.nome, limite: Math.min(200, Number(url.searchParams.get('limite')) || 20) }).map(visao) });
    }
    let r = /^\/v1\/pedidos\/([a-z0-9]+)$/.exec(p);
    if (m === 'GET' && r) {
      const ped = fila.obter(r[1]);
      if (!ped || (!cliente.admin && ped.cliente !== cliente.nome)) throw new Erro(404, 'pedido não encontrado');
      return enviar(res, 200, visao(ped));
    }

    // ---------- um site ----------
    // reservar = rascunho da sequência: o número só é gasto depois que o cadastro passou na validação
    async function criar(d, parcial, inq, reservar = false) {
      // o domínio é único na plataforma: "em uso" sem dizer de qual inquilino
      if (Sites.existe(d) || fila.pendentesDoSite(d).some((x) => x.tipo === 'criar')) throw new Erro(409, `o domínio "${d}" já está em uso`);
      if (parcial === null || typeof parcial !== 'object' || Array.isArray(parcial)) throw new Erro(422, '"cadastro" deve ser um objeto');
      if (parcial.inquilino != null && parcial.inquilino !== inq) throw new Erro(422, '"inquilino" do cadastro diferente do inquilino da chamada');
      const erros = Sites.validarSite(Sites.cadastroNovo(d, parcial, inq), d);
      if (erros.length) throw new Erro(422, 'cadastro inválido: nada foi criado', { erros });
      if (reservar && Sites.proximoRascunho({ inquilino: inq, reservar: true }) !== d) throw new Erro(409, 'outro rascunho foi criado ao mesmo tempo; tente de novo');
      return responderPedido(res, url, fila.adicionar({ tipo: 'criar', site: d, corpo: { cadastro: parcial, inquilino: inq }, cliente: cliente.nome }), 202, 201, comAvisos(parcial));
    }
    r = /^\/v1\/sites\/([^/]+)(\/.*)?$/.exec(p);
    if (!r) throw new Erro(404, 'rota inexistente (veja docs/api.md)');
    const dominio = decodeURIComponent(r[1]);
    const resto = r[2] || '';

    // cadastro do site: cria se não existe (mesmo caminho do POST /v1/sites: estrutura + infra), atualiza se existe
    if (m === 'PUT' && resto === '') {
      const existe = Sites.existe(dominio);
      if (existe && !CL.pode(cliente, dominio)) throw new Erro(403, `este token não tem acesso ao site "${dominio}"`);
      if (!existe) exigirTodos('criar um site novo');
      const cad = await corpoJSON(req, LIMITE.site);
      if (!existe) { if (!Sites.ID_SITE.test(dominio)) throw new Erro(422, 'cadastro inválido: nada foi criado', { erros: [`domínio inválido "${dominio}"`] }); return criar(dominio, cad, inquilinoAlvo((cad && cad.inquilino) || url.searchParams.get('inquilino'))); }
      // o site continua no inquilino dele: o cadastro novo não muda isso (e quem omite o campo não "perde" o inquilino)
      const atual = Inq.doSite(dominio);
      if (cad && cad.inquilino != null && cad.inquilino !== atual) throw new Erro(422, 'não dá para mudar o inquilino de um site pelo cadastro');
      if (cad && typeof cad === 'object' && atual !== Inq.PADRAO) cad.inquilino = atual;
      const erros = Sites.validarSite(cad, dominio);
      if (erros.length) throw new Erro(422, 'cadastro inválido: nada foi gravado', { erros });
      const { criado } = Sites.gravarSite(dominio, cad);
      return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: dominio, cliente: cliente.nome }), criado ? 201 : 202, 200, comAvisos(cad));
    }

    // ATUALIZAR SÓ ALGUNS CAMPOS do site.json (outro sistema que cuida de parte do cadastro: telefone, lojas, WhatsApp...)
    // sem apagar o que outros mantêm (cabeçalho, rodapé, tema do designer). JSON Merge Patch (RFC 7396):
    //   {"whatsapp": "5541...", "lojas": {"centro": {"whatsapp": "..."}}, "slogan": null}   (null apaga o campo)
    if (m === 'PATCH' && resto === '') {
      const d = site(dominio);
      const patch = await corpoJSON(req, LIMITE.site);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Erro(400, 'o corpo deve ser um objeto com os campos a mudar');
      if ('inquilino' in patch) throw new Erro(422, 'não dá para mudar o inquilino de um site pelo cadastro');
      const { id, ...atual } = Sites.carregar(d);
      const novo = Sites.mesclar(atual, patch);
      const erros = Sites.validarSite(novo, d);
      if (erros.length) throw new Erro(422, 'cadastro inválido: nada foi gravado', { erros });
      Sites.gravarSite(d, novo);
      return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome }), 202, 200, comAvisos(patch));
    }

    const d = site(dominio);
    const refazer = () => fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome });

    // PÁGINAS do site (sites-config/<dominio>/web/: index = web/index.json, o resto em web/paginas/): o que o web designer faz na pasta, um sistema faz por aqui.
    //   GET    /v1/sites/<d>/paginas              lista (nome, formato, endereço público)
    //   GET    /v1/sites/<d>/paginas/<nome>       uma (JSON de blocos ou o HTML)
    //   PUT    /v1/sites/<d>/paginas/<nome>       grava: JSON { titulo, blocos } ou HTML (content-type text/html). "index" = home
    //   DELETE /v1/sites/<d>/paginas/<nome>       tira
    if (resto === '/paginas' && m === 'GET') return enviar(res, 200, { paginas: Arq.listarPaginas(d) });
    let rp = /^\/paginas\/(.+)$/.exec(resto);
    if (rp) {
      const nome = decodeURIComponent(rp[1]).replace(/\/+$/, '');
      const errosNome = Arq.validarNomePagina(nome);
      if (errosNome.length) throw new Erro(422, errosNome[0]);
      if (m === 'GET') {
        const pg = Arq.lerPagina(d, nome);
        if (!pg) throw new Erro(404, `página "${nome}" não existe`);
        if (pg.formato === 'html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pg.conteudo); }
        return enviar(res, 200, pg.conteudo);
      }
      if (m === 'PUT') {
        const html = /text\/html/i.test(req.headers['content-type'] || '');
        if (html) {
          if (nome === 'index') throw new Erro(422, 'a home ("index") é página de blocos (JSON), não HTML');
          const t = await corpo(req, LIMITE.site);
          if (!t.trim()) throw new Erro(400, 'HTML vazio');
          try { Arq.gravarPagina(d, nome, 'html', t); } catch (e) { throw new Erro(e.conflito ? 409 : 500, e.message); }
        } else {
          const pg = await corpoJSON(req, LIMITE.site);
          const erros = Arq.validarPagina(d, nome === 'index' ? '' : nome, pg);
          if (erros.length) throw new Erro(422, 'página inválida: nada foi gravado', { erros });
          try { Arq.gravarPagina(d, nome, 'blocos', pg); } catch (e) { throw new Erro(e.conflito ? 409 : 500, e.message); }
        }
        return responderPedido(res, url, refazer(), 202, 200, { endereco: nome === 'index' ? '/' : `/paginas/${nome}/` });
      }
      if (m === 'DELETE') {
        if (!Arq.removerPagina(d, nome)) throw new Erro(404, `página "${nome}" não existe`);
        return responderPedido(res, url, refazer());
      }
    }

    // LISTAGEM do estoque (sites-config/<dominio>/web/multipla.json → /multipla/): blocos antes/depois da lista
    //   GET|PUT|DELETE /v1/sites/<d>/multipla   corpo do PUT: { "blocosAntes": [...], "blocosDepois": [...] }
    if (resto === '/multipla') {
      if (m === 'GET') return enviar(res, 200, Arq.lerMultipla(d) || {});
      if (m === 'PUT') {
        const cfg = await corpoJSON(req, LIMITE.site);
        const erros = Arq.validarMultipla(d, cfg);
        if (erros.length) throw new Erro(422, 'multipla inválida: nada foi gravado', { erros });
        Arq.gravarMultipla(d, cfg);
        return responderPedido(res, url, refazer(), 202, 200, { endereco: '/multipla/' });
      }
      if (m === 'DELETE') {
        if (!Arq.removerMultipla(d)) throw new Erro(404, 'o site não tem web/multipla.json');
        return responderPedido(res, url, refazer());
      }
    }

    // COMPONENTES do site (sites-config/<dominio>/componentes/<nome>.json): opções do componente no site inteiro
    //   GET /v1/sites/<d>/componentes  ·  GET|PUT|DELETE /v1/sites/<d>/componentes/<nome>  (corpo do PUT = as opções)
    if (resto === '/componentes' && m === 'GET') {
      const Comp = require('../core/componentes');
      return enviar(res, 200, { componentes: Comp.listar().map((n) => ({ nome: n, opcoes: Sites.componentesDoSite(d)[n] || {} })) });
    }
    rp = /^\/componentes\/([a-z0-9-]+)$/.exec(resto);
    if (rp) {
      const Comp = require('../core/componentes');
      const nome = rp[1];
      if (!Comp.existe(nome)) throw new Erro(404, `componente "${nome}" não existe (existem: ${Comp.listar().join(', ')})`);
      if (m === 'GET') return enviar(res, 200, { nome, opcoes: Sites.componentesDoSite(d)[nome] || {}, disponiveis: Comp.carregar(nome).opcoes });
      if (m === 'PUT') {
        const op = await corpoJSON(req, LIMITE.outro);
        const erros = Comp.validar(nome, op, `componentes/${nome}`);
        if (erros.length) throw new Erro(422, 'opções inválidas: nada foi gravado', { erros });
        Sites.gravarComponenteSite(d, nome, op);
        return responderPedido(res, url, refazer());
      }
      if (m === 'DELETE') {
        if (!Sites.removerComponenteSite(d, nome)) throw new Erro(404, `o site não tem opções para o componente "${nome}"`);
        return responderPedido(res, url, refazer());
      }
    }

    // ARQUIVOS do site (sites-config/<dominio>/assets/: logo, favicon, banners, fontes). No site.json, use "assets/<nome>".
    //   GET /v1/sites/<d>/assets   ·   PUT /v1/sites/<d>/assets/<nome> (corpo = o arquivo)   ·   DELETE /v1/sites/<d>/assets/<nome>
    if (resto === '/assets' && m === 'GET') return enviar(res, 200, { arquivos: Arq.listarAssets(d) });
    rp = /^\/assets\/(.+)$/.exec(resto);
    if (rp) {
      const nome = decodeURIComponent(rp[1]);
      if (m === 'PUT') {
        const buf = await corpoBinario(req, Arq.MAX_ARQUIVO + 1);
        const erros = Arq.validarArquivo(nome, buf);
        if (erros.length) throw new Erro(422, erros[0]);
        Arq.gravarAsset(d, nome, buf);
        return responderPedido(res, url, refazer(), 202, 200, { arquivo: `assets/${nome}`, bytes: buf.length });
      }
      if (m === 'DELETE') {
        if (!Arq.removerAsset(d, nome)) throw new Erro(404, `arquivo "${nome}" não existe`);
        return responderPedido(res, url, refazer());
      }
    }

    if (m === 'GET' && resto === '') {
      return enviar(res, 200, { ...Sites.resumo(d), cadastro: Sites.carregar(d), fotos: Fotos.resumo(d), pedidos: fila.listar({ site: d, limite: 5 }).map(visao) });
    }
    if (m === 'GET' && resto === '/estoque') return enviar(res, 200, Sites.estoque(d));

    // APAGAR O SITE: DELETE /v1/sites/<d>?confirmar=<d> (repetir o domínio evita apagar o site errado por engano).
    // Não destrói: os arquivos vão para .estado/removidos/ (recuperável); fotos saem do armazenamento; infra "remover".
    if (m === 'DELETE' && resto === '') {
      exigirTodos('remover um site');
      if (url.searchParams.get('confirmar') !== d) throw new Erro(422, `para remover, repita o domínio: ?confirmar=${d}`);
      const pend = fila.pendentesDoSite(d);
      if (pend.length) throw new Erro(409, `o site tem ${pend.length} pedido(s) na fila; espere terminarem para remover`, { pedidos: pend.map((x) => x.id) });
      return responderPedido(res, url, fila.adicionar({ tipo: 'remover-site', site: d, cliente: cliente.nome }));
    }

    // PROMOVER RASCUNHO A DEFINITIVO: {"dominio": "lojafinal.com.br", "url": "https://www.lojafinal.com.br"} (os dois
    // opcionais; sem domínio, só deixa de ser rascunho no próprio endereço). Volta ao Google, gerado do zero, infra "promover"
    if (m === 'POST' && resto === '/promover') {
      exigirTodos('promover um site');
      const b = await corpoJSON(req, LIMITE.outro, {});
      if (!Sites.carregar(d).rascunho) throw new Erro(409, `o site "${d}" já é definitivo (não está em rascunho)`);
      if (b.dominio != null && (typeof b.dominio !== 'string' || !Sites.ID_SITE.test(b.dominio))) throw new Erro(422, '"dominio" inválido (ex.: lojafinal.com.br, só minúsculas, sem www nem https)');
      if (Sites.ehDominioRascunho(b.dominio || d)) throw new Erro(422, `informe o domínio definitivo em "dominio" ("${b.dominio || d}" é endereço de rascunho)`);
      if (b.url != null && !(typeof b.url === 'string' && /^https:\/\/[^\s/]+\/?$/i.test(b.url))) throw new Erro(422, '"url" precisa ser https://dominio');
      if (b.dominio && b.dominio !== d && fs.existsSync(C.site(b.dominio))) throw new Erro(409, `já existe um site "${b.dominio}"`);
      const pend = fila.pendentesDoSite(d);
      if (pend.length) throw new Erro(409, `o site tem ${pend.length} pedido(s) na fila; espere terminarem para promover`, { pedidos: pend.map((x) => x.id) });
      return responderPedido(res, url, fila.adicionar({ tipo: 'promover', site: d, corpo: { dominio: b.dominio || null, url: b.url || null }, cliente: cliente.nome }));
    }

    // TROCAR O DOMÍNIO de um site JÁ NO AR (raro; para rascunho use /promover): {"novo": "novaloja.com.br"}. Leva tudo junto (cadastro, estoque, páginas, histórico de links e
    // vendidos, fotos, tokens) e roda o "renomear" da infra (hospedagem nova + 301 do domínio antigo)
    if (m === 'POST' && resto === '/dominio') {
      exigirTodos('trocar o domínio de um site');
      const b = await corpoJSON(req, LIMITE.outro);
      const novo = b && b.novo;
      if (typeof novo !== 'string' || !Sites.ID_SITE.test(novo)) throw new Erro(422, 'informe "novo" com um domínio válido (ex.: novaloja.com.br)');
      if (novo === d) throw new Erro(422, 'o domínio novo é igual ao atual');
      if (Sites.existe(novo) || fs.existsSync(C.site(novo))) throw new Erro(409, `já existe um site "${novo}"`);
      const pend = fila.pendentesDoSite(d);
      if (pend.length) throw new Erro(409, `o site tem ${pend.length} pedido(s) na fila; espere terminarem para trocar o domínio`, { pedidos: pend.map((x) => x.id) });
      return responderPedido(res, url, fila.adicionar({ tipo: 'renomear', site: d, corpo: { novo }, cliente: cliente.nome }));
    }
    // refazer o passo de infra (se falhou): {"acao": "criar"} ou {"acao": "renomear", "antigo": "..."}
    if (m === 'POST' && resto === '/infra') {
      exigirTodos('mexer na infra');
      const b = await corpoJSON(req, LIMITE.outro, {});
      const acao = b.acao || 'criar';
      if (!['criar', 'promover', 'renomear'].includes(acao)) throw new Erro(422, '"acao" deve ser "criar", "promover" ou "renomear"');
      if (acao !== 'criar' && !Sites.ID_SITE.test(String(b.antigo))) throw new Erro(422, 'informe "antigo" (o domínio anterior / de rascunho)');
      const r = await Ops.rodarInfra(acao, acao === 'criar' ? { site: d, pasta: `${C.PUBLICO}/${d}` }
        : acao === 'promover' ? { rascunho: b.antigo, site: d, pasta: `${C.PUBLICO}/${d}` } : { antigo: b.antigo, novo: d, pasta: `${C.PUBLICO}/${d}` });
      return enviar(res, r.status === 'falhou' ? 502 : 200, r);
    }
    if (m === 'PUT' && resto === '/estoque') {
      const b = comCarros(await corpoJSON(req, LIMITE.estoque));
      const erros = AT.validarEstoque(b, Sites.lojas(d));
      if (erros.length) throw new Erro(422, 'estoque inválido: nada foi gravado', { erros });
      return responderPedido(res, url, fila.adicionar({ tipo: 'estoque', site: d, corpo: { carros: b.carros }, cliente: cliente.nome, forcar }));
    }
    if (m === 'POST' && resto === '/build') {
      const b = await corpoJSON(req, LIMITE.outro, {});
      const completo = (b && b.completo === true) || url.searchParams.get('completo') === '1';
      return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome, completo }));
    }
    r = /^\/carros\/([^/]+)$/.exec(resto);
    if (r) {
      const id = decodeURIComponent(r[1]);
      if (!ID_CARRO.test(id)) throw new Erro(400, 'id do carro inválido (só letras, números, ponto, hífen e _)');
      if (m === 'GET') {
        const c = (Sites.estoque(d).carros || []).find((x) => x.id === id);
        if (!c) throw new Erro(404, `carro "${id}" não está no estoque`);
        return enviar(res, 200, c);
      }
      if (m === 'PUT') {
        const c = await corpoJSON(req, LIMITE.carro);
        if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Erro(400, 'o corpo deve ser um carro (objeto JSON)');
        if (c.id != null && c.id !== id) throw new Erro(400, `"id" do corpo (${c.id}) diferente do endereço (${id})`);
        const carro = { ...c, id };
        const erros = AT.validarEstoque({ carros: [carro] }, Sites.lojas(d));
        if (erros.length) throw new Erro(422, 'carro inválido: nada foi gravado', { erros });
        return responderPedido(res, url, fila.adicionar({ tipo: 'carro', site: d, carro: id, corpo: carro, cliente: cliente.nome, forcar }));
      }
      if (m === 'DELETE') {
        if (!(Sites.estoque(d).carros || []).some((x) => x.id === id) && !fila.carrosNaFila(d).has(id)) throw new Erro(404, `carro "${id}" não está no estoque`);
        return responderPedido(res, url, fila.adicionar({ tipo: 'remover', site: d, carro: id, cliente: cliente.nome, forcar }));
      }
    }
    throw new Erro(404, 'rota inexistente (veja docs/api.md)');
  };
}

module.exports = { criarRotas };
