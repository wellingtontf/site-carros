// Rotas da API v1: o que cada endereço faz. Só traduz HTTP ↔ core: a regra de negócio (validar estoque, validar
// cadastro, gerar site, fotos) mora em core/. O contrato para quem integra está em api/README.md.
const fs = require('fs');
const { idsSites, ID_SITE } = require('../core/build');
const AT = require('../core/atualizar');
const Sites = require('../core/sites');
const Fotos = require('../core/fotos');
const C = require('../core/caminhos');
const CL = require('./clientes');
const { Erro, corpo, corpoJSON, enviar } = require('./http');

const ID_CARRO = /^[A-Za-z0-9._-]{1,80}$/;
const LIMITE = { estoque: 100e6, lote: 200e6, carro: 1e6, site: 2e6, outro: 100e3 };

const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; } };
const lerEstoque = (d) => lerJSON(C.estoque(d), { carros: [] });
const lojasDe = (d) => Object.keys(lerJSON(C.siteJson(d), {}).lojas || {});
const comCarros = (b) => (Array.isArray(b) ? { carros: b } : b); // aceita a lista pura também

const visao = (p) => p && ({
  pedido: p.id, tipo: p.tipo, site: p.site, ...(p.carro ? { carro: p.carro } : {}), status: p.status,
  criado: p.criado, inicio: p.inicio, fim: p.fim, erros: p.erros, resultado: p.resultado, ...(p.publicacao ? { publicacao: p.publicacao } : {}),
  link: `/v1/pedidos/${p.id}`,
});
const CODIGO_FINAL = { concluido: 200, invalido: 422, recusado: 409, erro: 500 };
const segundos = (url) => Math.min(120, Math.max(0, Number(url.searchParams.get('esperar')) || 0));

function criarRotas({ fila }) {
  // um pedido: 202 (na fila) ou, com ?esperar=N, o resultado (200 concluído; 422 inválido; 409 recusado; 500 erro)
  async function responderPedido(res, url, p, codigoAceito = 202) {
    const seg = segundos(url);
    if (!seg) return enviar(res, codigoAceito, visao(p));
    const fim = await fila.aguardar(p.id, seg * 1000);
    enviar(res, CODIGO_FINAL[fim.status] || 202, visao(fim));
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
      if (!ID_SITE.test(d) || !idsSites().includes(d)) throw new Erro(404, `site "${d}" não existe`);
      if (!CL.pode(cliente, d)) throw new Erro(403, `este token não tem acesso ao site "${d}"`);
      return d;
    };
    const exigirTodos = (oque) => { if (!cliente.sites.includes('*')) throw new Erro(403, `${oque} exige um token com acesso a todos os sites ("*")`); };

    // ---------- gerais ----------
    if (m === 'GET' && p === '/v1/status') return enviar(res, 200, { ...fila.estado(), cliente: cliente.nome });
    if (m === 'GET' && p === '/v1/sites') {
      return enviar(res, 200, { sites: idsSites().filter((d) => CL.pode(cliente, d)).map((d) => { const e = lerEstoque(d); return { site: d, carros: (e.carros || []).length, atualizado: e.atualizado || null }; }) });
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
          const erros = AT.validarEstoque(obj, lojasDe(d));
          if (erros.length) throw new Erro(422, 'estoque inválido: nada foi gravado', { erros });
          aceitos.push([d, obj]);
        } catch (e) { if (!(e instanceof Erro)) throw e; recusados[d] = { codigo: e.code, erro: e.message, ...e.extra }; }
      }
      if (!aceitos.length) throw new Erro(422, 'nenhum site aceito', { recusados });
      const ps = aceitos.map(([d, obj]) => fila.adicionar({ tipo: 'estoque', site: d, corpo: { carros: obj.carros }, cliente: cliente.nome, forcar }));
      return responderVarios(res, url, ps, Object.keys(recusados).length ? { recusados } : {});
    }

    // refazer sites sem mudar estoque: {"sites": ["a.com.br", ...]} ou vazio / {"todos": true} = TODOS
    if (m === 'POST' && p === '/v1/build') {
      const b = await corpoJSON(req, LIMITE.outro, {});
      if (b.sites != null && !(Array.isArray(b.sites) && b.sites.every((x) => typeof x === 'string'))) throw new Erro(400, '"sites" deve ser uma lista de domínios');
      if (b.sites && b.sites.length && !b.todos) {
        const lista = [...new Set(b.sites)].map(site);
        return responderVarios(res, url, lista.map((d) => fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome })));
      }
      exigirTodos('refazer todos os sites');
      return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: null, cliente: cliente.nome }));
    }

    // puxar das URLs de config/fontes.json
    if (m === 'POST' && p === '/v1/atualizar') {
      const b = await corpoJSON(req, LIMITE.outro, {});
      if (b.sites != null && !(Array.isArray(b.sites) && b.sites.every((x) => typeof x === 'string'))) throw new Erro(400, '"sites" deve ser uma lista de domínios');
      const lista = b.sites && b.sites.length && !b.todos ? b.sites.map(site) : null;
      if (!lista) exigirTodos('atualizar todos os sites');
      const ps = (lista || [null]).map((d) => fila.adicionar({ tipo: 'buscar', site: d, cliente: cliente.nome, forcar }));
      return ps.length === 1 ? responderPedido(res, url, ps[0]) : responderVarios(res, url, ps);
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
    r = /^\/v1\/sites\/([^/]+)(\/.*)?$/.exec(p);
    if (!r) throw new Erro(404, 'rota inexistente (veja api/README.md)');
    const dominio = decodeURIComponent(r[1]);
    const resto = r[2] || '';

    // cadastro do site: cria se não existe, atualiza se existe; depois refaz o site
    if (m === 'PUT' && resto === '') {
      const existe = ID_SITE.test(dominio) && idsSites().includes(dominio);
      if (existe && !CL.pode(cliente, dominio)) throw new Erro(403, `este token não tem acesso ao site "${dominio}"`);
      if (!existe) exigirTodos('criar um site novo');
      const cad = await corpoJSON(req, LIMITE.site);
      const erros = Sites.validarSite(cad, dominio);
      if (erros.length) throw new Erro(422, 'cadastro inválido: nada foi gravado', { erros });
      const { criado } = Sites.gravarSite(dominio, cad);
      return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: dominio, cliente: cliente.nome }), criado ? 201 : 202);
    }

    const d = site(dominio);
    if (m === 'GET' && resto === '') {
      const e = lerEstoque(d);
      return enviar(res, 200, { site: d, carros: (e.carros || []).length, atualizado: e.atualizado || null, cadastro: lerJSON(C.siteJson(d), null), fotos: Fotos.resumo(d), pedidos: fila.listar({ site: d, limite: 5 }).map(visao) });
    }
    if (m === 'GET' && resto === '/estoque') return enviar(res, 200, lerEstoque(d));
    if (m === 'PUT' && resto === '/estoque') {
      const b = comCarros(await corpoJSON(req, LIMITE.estoque));
      const erros = AT.validarEstoque(b, lojasDe(d));
      if (erros.length) throw new Erro(422, 'estoque inválido: nada foi gravado', { erros });
      return responderPedido(res, url, fila.adicionar({ tipo: 'estoque', site: d, corpo: { carros: b.carros }, cliente: cliente.nome, forcar }));
    }
    if (m === 'POST' && resto === '/build') {
      await corpo(req, LIMITE.outro);
      return responderPedido(res, url, fila.adicionar({ tipo: 'build', site: d, cliente: cliente.nome }));
    }
    r = /^\/carros\/([^/]+)$/.exec(resto);
    if (r) {
      const id = decodeURIComponent(r[1]);
      if (!ID_CARRO.test(id)) throw new Erro(400, 'id do carro inválido (só letras, números, ponto, hífen e _)');
      if (m === 'GET') {
        const c = (lerEstoque(d).carros || []).find((x) => x.id === id);
        if (!c) throw new Erro(404, `carro "${id}" não está no estoque`);
        return enviar(res, 200, c);
      }
      if (m === 'PUT') {
        const c = await corpoJSON(req, LIMITE.carro);
        if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Erro(400, 'o corpo deve ser um carro (objeto JSON)');
        if (c.id != null && c.id !== id) throw new Erro(400, `"id" do corpo (${c.id}) diferente do endereço (${id})`);
        const carro = { ...c, id };
        const erros = AT.validarEstoque({ carros: [carro] }, lojasDe(d));
        if (erros.length) throw new Erro(422, 'carro inválido: nada foi gravado', { erros });
        return responderPedido(res, url, fila.adicionar({ tipo: 'carro', site: d, carro: id, corpo: carro, cliente: cliente.nome, forcar }));
      }
      if (m === 'DELETE') {
        if (!(lerEstoque(d).carros || []).some((x) => x.id === id) && !fila.carrosNaFila(d).has(id)) throw new Erro(404, `carro "${id}" não está no estoque`);
        return responderPedido(res, url, fila.adicionar({ tipo: 'remover', site: d, carro: id, cliente: cliente.nome, forcar }));
      }
    }
    throw new Erro(404, 'rota inexistente (veja api/README.md)');
  };
}

module.exports = { criarRotas };
