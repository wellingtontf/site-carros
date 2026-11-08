// Trabalhador: processa a fila (api/fila.js). Rode quantos quiser (pods no Kubernetes): cada um "reserva" um site por
// vez (trava fila-<site>), então sites diferentes são processados em paralelo e o mesmo site nunca por dois ao mesmo tempo.
//
// Por site, a cada giro: espera "atraso" ms sem pedido novo (junta rajadas; no máximo 10x isso), aplica os pedidos NA
// ORDEM de chegada, valida o estoque depois de cada um (um carro inválido é recusado sozinho), grava e refaz o site UMA
// vez. Fotos por URL vão para o canal "fotos" (download não segura estoque); quando ficam prontas, pedem o build do site.
// Trabalhador que morre no meio: a trava expira (core/trava.js) e outro pega o site de novo; nenhum pedido se perde.
const Sites = require('../core/sites');
const AT = require('../core/atualizar');
const Ops = require('../core/operacoes');
const Fotos = require('../core/fotos');
const Inq = require('../core/inquilinos');
const { comTrava } = require('../core/trava');

function criarTrabalhador({ fila, atraso = 3000, publicar = false, log = console.log, aoRenomear = () => {}, aoRemover = () => {}, intervalo = Math.min(1000, atraso) } = {}) {
  let parado = false, girando = false, timer = null, ultimoLimpar = 0, ultimo = null;
  const ativos = new Set(); // chaves sendo processadas por este trabalhador

  const maduro = (c) => c.idadeMaisNova >= atraso || c.idadeMaisVelha >= atraso * 10;
  // fotos: pede (uma vez) o processamento das fotos pendentes do site
  function pedirFotos(site) {
    if (Fotos.temTrabalho(site) && !fila.pendentesDoSite(site, 'fotos').length) fila.adicionar({ tipo: 'fotos', site, cliente: 'sistema' });
  }

  async function processarPrincipal(site, ps) {
    const fins = { concluido: [], outros: [] };
    // 0) remover o site: o resto dos pedidos dele perde o sentido
    const rem = ps.find((x) => x.tipo === 'remover-site');
    if (rem) {
      try {
        const r = await Ops.removerSite(site, { log });
        if (r.status === 'ocupado') { fila.voltar(ps); return fins; }
        if (r.status !== 'ok') fila.terminar(rem, 'invalido', r.erros || [r.status]);
        else {
          aoRemover(site);
          const infraOk = r.infra.status !== 'falhou';
          fila.terminar(rem, infraOk ? 'concluido' : 'erro', infraOk ? [] : [`site removido, mas a infra falhou: ${r.infra.mensagem}`], r);
        }
      } catch (e) { fila.terminar(rem, 'erro', [e.message]); }
      ps.filter((p) => p !== rem && p.status === 'processando').forEach((p) => fila.terminar(p, 'erro', [`o site "${site}" foi removido`]));
      return fins;
    }
    // 1) criar / promover / renomear: antes de tudo (e o que vier depois para o domínio antigo não tem mais site)
    for (const p of ps.filter((x) => ['criar', 'promover', 'renomear'].includes(x.tipo))) {
      try {
        const corpo = fila.lerCorpo(p.id) || {};
        const r = p.tipo === 'criar' ? await Ops.criarSite(site, corpo.cadastro || {}, { inquilino: corpo.inquilino || Inq.PADRAO, log })
          : p.tipo === 'promover' ? await Ops.promoverSite(site, { final: corpo.dominio, url: corpo.url, log })
          : await Ops.renomearSite(site, corpo.novo, { log });
        if (r.status === 'ocupado') { fila.voltar([p]); continue; }
        if (r.status !== 'ok') { fila.terminar(p, r.status === 'recusado' ? 'recusado' : 'invalido', r.erros || [r.status]); continue; }
        const novo = p.tipo === 'renomear' ? corpo.novo : p.tipo === 'promover' ? r.site : null;
        if (novo && novo !== site) { aoRenomear(site, novo); pedirFotos(novo); }
        const infraOk = r.infra.status !== 'falhou';
        fila.terminar(p, infraOk ? 'concluido' : 'erro', infraOk ? [] : [`site ${{ criar: 'criado', promover: 'promovido', renomear: 'renomeado' }[p.tipo]} e gerado, mas a infra falhou: ${r.infra.mensagem} (refaça com POST /v1/sites/<dominio>/infra)`], r);
        (infraOk ? fins.concluido : fins.outros).push(p);
      } catch (e) { fila.terminar(p, 'erro', [e.message]); }
    }
    const resto = ps.filter((x) => !['criar', 'promover', 'renomear'].includes(x.tipo) && x.status === 'processando');
    if (!resto.length) return fins;
    if (!Sites.existe(site)) { resto.forEach((p) => fila.terminar(p, 'erro', [`site "${site}" não existe (foi renomeado ou removido?)`])); return fins; }

    // 2) puxar das fontes (config/fontes.json)
    for (const p of resto.filter((x) => x.tipo === 'buscar')) {
      try {
        const r = await AT.atualizar({ sites: [site], forcar: p.forcar, log });
        if (r.status === 'ocupado') { fila.voltar([p]); continue; }
        const est = r.estoques[0] || { status: 'erro', erros: ['sem resultado'] };
        if (['atualizado', 'igual'].includes(est.status)) { fila.terminar(p, 'concluido', [], { estoques: r.estoques }); fins.concluido.push(p); pedirFotos(site); }
        else fila.terminar(p, est.status, est.erros || []);
      } catch (e) { fila.terminar(p, 'erro', [e.message]); }
    }

    // 3) estoque / carro / remover / build / robots: aplica na ordem, valida um a um, grava e refaz UMA vez
    const ops = resto.filter((x) => ['estoque', 'carro', 'remover'].includes(x.tipo));
    const builds = resto.filter((x) => x.tipo === 'build');
    const robots = resto.filter((x) => x.tipo === 'robots');
    if (!ops.length && !builds.length && !robots.length) return fins;
    try {
      const lojas = Sites.lojas(site);
      let carros = Sites.estoque(site).carros || [];
      const aplicados = [];
      for (const p of ops) {
        const corpo = fila.lerCorpo(p.id);
        let novo;
        if (p.tipo === 'estoque') novo = corpo && corpo.carros;
        else if (p.tipo === 'carro') { const i = carros.findIndex((c) => c.id === p.carro); novo = i >= 0 ? carros.map((c, k) => (k === i ? corpo : c)) : [...carros, corpo]; }
        else { if (!carros.some((c) => c.id === p.carro)) { fila.terminar(p, 'erro', [`carro "${p.carro}" não está no estoque`]); continue; } novo = carros.filter((c) => c.id !== p.carro); }
        if (p.tipo !== 'remover' && corpo === undefined) { fila.terminar(p, 'erro', ['corpo do pedido perdido']); continue; }
        const erros = AT.validarEstoque({ carros: novo }, lojas);
        if (erros.length) { fila.terminar(p, 'invalido', erros); continue; }
        carros = novo;
        aplicados.push(p);
      }
      if (aplicados.length || builds.length) {
        const r = await AT.atualizar({ recebidos: aplicados.length ? { [site]: { carros } } : {}, refazer: builds.length ? [site] : [], forcar: resto.some((x) => x.forcar), log });
        if (r.status === 'ocupado') { fila.voltar([...aplicados, ...builds, ...robots]); return fins; }
        const est = r.estoques[0];
        for (const p of aplicados) {
          if (['atualizado', 'igual'].includes(est.status)) { fila.terminar(p, 'concluido', [], { estoque: est.status, carros: est.total, antes: est.antes ?? est.total }); fins.concluido.push(p); }
          else fila.terminar(p, est.status, est.erros || []);
        }
        for (const p of builds) { fila.terminar(p, 'concluido', [], { build: true, carros: carros.length }); fins.concluido.push(p); }
        if (aplicados.length) pedirFotos(site);
      }
      if (robots.length) {
        const r = await AT.reescreverRobots({ sites: [site] });
        if (r.status === 'ocupado') fila.voltar(robots);
        else robots.forEach((p) => { fila.terminar(p, 'concluido', [], { alterado: r.alterados.includes(site), robotsProprio: r.comRobotsProprio.includes(site), semUrl: r.semUrl.includes(site) }); fins.concluido.push(p); });
      }
    } catch (e) {
      log(`${site}: erro ${e.message}`);
      resto.filter((p) => p.status === 'processando').forEach((p) => fila.terminar(p, 'erro', [e.message]));
    }
    return fins;
  }

  async function processarFotos(site, ps) {
    const fins = { concluido: [], outros: [] };
    try {
      const r = Sites.existe(site) ? await Fotos.processarSite(site, { log }) : { processados: [], erros: 0, falhas: [] };
      ps.forEach((p) => { fila.terminar(p, 'concluido', [], { processados: r.processados.length, comErro: r.erros, falhas: r.falhas }); fins.concluido.push(p); });
      if (r.processados.length) fila.adicionar({ tipo: 'build', site, cliente: 'fotos' }); // fotos prontas: a página dos carros muda
    } catch (e) { ps.forEach((p) => fila.terminar(p, 'erro', [e.message])); }
    return fins;
  }

  // um site de um canal: reserva, processa o lote dele, publica (se ligado), solta
  async function atender(canal, chave) {
    const marcaAtivo = `${canal}:${chave}`;
    ativos.add(marcaAtivo);
    try {
      const r = await comTrava(`fila-${canal}-${chave}`, async () => {
        const ps = fila.pedidosDaChave(canal, chave).filter((p) => !fila.FINAIS.has(p.status));
        if (!ps.length) return { status: 'ok' };
        fila.marcarProcessando(ps);
        const fins = canal === 'fotos' ? await processarFotos(chave, ps) : await processarPrincipal(chave, ps);
        if (publicar && fins.concluido.length) {
          const alvo = Sites.existe(chave) ? chave : (fins.concluido.find((p) => p.resultado && p.resultado.site) || {}).resultado?.site;
          if (alvo) {
            try {
              const pub = await AT.publicarPendentes({ sites: [alvo], log });
              fins.concluido.forEach((p) => fila.anotar(p, { publicacao: pub.publicados.includes(alvo) ? 'publicado' : pub.falhas.includes(alvo) ? 'falhou' : 'nada a publicar' }));
            } catch (e) { fins.concluido.forEach((p) => fila.anotar(p, { publicacao: `falhou: ${e.message}` })); }
          }
        }
        ultimo = { em: new Date().toISOString(), site: chave, canal, pedidos: ps.length };
        return { status: 'ok' };
      });
      return r.status;
    } finally { ativos.delete(marcaAtivo); }
  }

  // um giro: pega os sites maduros dos dois canais e atende em paralelo (até "paralelo" por trabalhador)
  async function girar({ paralelo = 1 } = {}) {
    if (girando || parado) return;
    girando = true;
    try {
      const tarefas = [...fila.chavesComTrabalho('principal').filter(maduro).map((c) => ['principal', c.chave]),
        ...fila.chavesComTrabalho('fotos').map((c) => ['fotos', c.chave])].filter(([cn, ch]) => !ativos.has(`${cn}:${ch}`));
      const filaLocal = [...tarefas];
      await Promise.all(Array.from({ length: Math.max(1, paralelo) }, async () => {
        while (filaLocal.length && !parado) { const [cn, ch] = filaLocal.shift(); try { await atender(cn, ch); } catch (e) { log(`erro em ${cn}/${ch}: ${e.stack || e.message}`); } }
      }));
      if (Date.now() - ultimoLimpar > 3600000) { ultimoLimpar = Date.now(); try { fila.limparAntigos(); } catch (e) { /* tenta na próxima */ } }
    } finally { girando = false; }
  }

  return {
    iniciar({ paralelo = 1 } = {}) {
      for (const s of Sites.listar()) pedirFotos(s); // o que ficou pendente (pod caiu no meio das fotos)
      const loop = async () => { if (parado) return; await girar({ paralelo }); timer = setTimeout(loop, intervalo); };
      loop();
    },
    parar() { parado = true; clearTimeout(timer); },
    ocupado: () => girando || ativos.size > 0,
    girar,
    estado: () => ({ ativos: [...ativos], ultimo }),
  };
}

module.exports = { criarTrabalhador };
