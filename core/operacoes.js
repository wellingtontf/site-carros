// Operações de infraestrutura de um site, de ponta a ponta (usadas pela API e por quem mais precisar):
//   criarSite(dominio, parcial)    estrutura nova (sites/<dominio>/...) → gera o site → comando "criar" da infra
//   renomearSite(antigo, novo)     troca o domínio em tudo (core/sites.js) → refaz o site → comando "renomear" da infra
//   rodarInfra(acao, valores)      roda um comando de config/infra.json
// Tudo com a trava de execução (core/trava.js): não roda ao mesmo tempo que um build.
//
// config/infra.json (veja config/infra.exemplo.json) é o que liga a plataforma à hospedagem, sem amarrar a nenhuma:
//   criar      {site} {pasta}            ex.: criar bucket/distribuição na CDN, certificado e DNS do domínio novo
//   renomear   {antigo} {novo} {pasta}   ex.: hospedagem do domínio novo + 301 de TODO o domínio antigo para o novo
// Sem config/infra.json, os arquivos e o build são feitos e a resposta avisa que a infra ficou por fazer.
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const C = require('./caminhos');
const Sites = require('./sites');
const { construir } = require('./build');
const { comTrava } = require('./trava');

const aspas = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const lerInfra = () => { try { return JSON.parse(fs.readFileSync(C.config('infra.json'), 'utf8')); } catch (e) { return null; } };

function rodarInfra(acao, valores) {
  const cfg = lerInfra();
  if (!cfg || !cfg[acao]) return Promise.resolve({ status: 'nao_configurada', mensagem: `sem "${acao}" em config/infra.json: a hospedagem do domínio não foi mexida` });
  const cmd = Object.entries(valores).reduce((c, [k, v]) => c.replace(new RegExp(`\\{${k}\\}`, 'g'), aspas(v)), cfg[acao]);
  return new Promise((ok) => execFile('/bin/sh', ['-c', cmd], { cwd: C.ROOT, timeout: 15 * 60 * 1000 }, (e, so, se) =>
    ok(e ? { status: 'falhou', mensagem: `${(se || so || e.message).trim().split('\n').slice(-3).join(' | ').slice(0, 500)}` } : { status: 'ok', saida: (so || '').trim().slice(-500) })));
}

// site novo só com o domínio (o resto vem de config/site-modelo.json) ou com o cadastro que vier
async function criarSite(dominio, parcial = {}, { pasta = 'dist', log = console.log } = {}) {
  if (Sites.existe(dominio)) return { status: 'existe', erros: [`site "${dominio}" já existe`] };
  const cadastro = Sites.cadastroNovo(dominio, parcial);
  const erros = Sites.validarSite(cadastro, dominio);
  if (erros.length) return { status: 'invalido', erros };
  const r = await comTrava(() => {
    Sites.criarArquivos(dominio, cadastro);
    try { construir({ sites: [dominio], saida: pasta }); }
    catch (e) { fs.rmSync(C.site(dominio), { recursive: true, force: true }); throw e; } // não deixa site pela metade
    return { status: 'ok' };
  });
  if (r.status !== 'ok') return r;
  log(`${dominio}: site criado`);
  return { status: 'ok', site: dominio, cadastro, infra: await rodarInfra('criar', { site: dominio, pasta: path.join(pasta, dominio) }) };
}

async function renomearSite(antigo, novo, { pasta = 'dist', log = console.log } = {}) {
  if (!Sites.existe(antigo)) return { status: 'invalido', erros: [`site "${antigo}" não existe`] };
  if (!Sites.ID_SITE.test(String(novo))) return { status: 'invalido', erros: [`domínio novo inválido "${novo}" (ex.: novaloja.com.br, só minúsculas)`] };
  if (fs.existsSync(C.site(novo))) return { status: 'existe', erros: [`já existe um site "${novo}"`] };
  const r = await comTrava(() => {
    const { trocas, desfazer } = Sites.renomearArquivos(antigo, novo, { pasta });
    // url, canonical, sitemap, JSON-LD, links absolutos: tudo muda com o domínio → o build refaz as páginas
    try { construir({ sites: [novo], saida: pasta }); } catch (e) { desfazer(); throw e; }
    return { status: 'ok', trocas };
  });
  if (r.status !== 'ok') return r;
  log(`${antigo} → ${novo}: domínio trocado (${r.trocas} menção(ões) no site.json)`);
  return { status: 'ok', antigo, novo, trocasNoCadastro: r.trocas, infra: await rodarInfra('renomear', { antigo, novo, pasta: path.join(pasta, novo) }) };
}

module.exports = { criarSite, renomearSite, rodarInfra };
