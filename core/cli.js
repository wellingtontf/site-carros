#!/usr/bin/env node
// Versões do motor: rascunho → congelar → testar → aplicar em alguns sites → aplicar em todos (→ reverter)
// Os sites são identificados pelo domínio (nome da pasta em sites/).
//   node core/cli.js status
//   node core/cli.js congelar v2 --nota "texto"         copia core/motor/rascunho para core/motor/v2 (fica imutável)
//   node core/cli.js testar [--motor v2|rascunho] [--sites a.com.br,b.com.br]
//   node core/cli.js aplicar v2 --sites a.com.br        ou --todos   (roda os testes antes; --sem-teste pula; --dry só mostra)
//   node core/cli.js reverter --sites a.com.br          volta esses sites para a versão anterior
//   node core/cli.js historico
//   node core/cli.js atualizar [a.com.br,b.com.br] [--publicar]   busca o estoque em config/fontes.json e refaz só o que mudou
//   node core/cli.js publicar                           publica só o que mudou e ainda não foi publicado (config/publicacao.json)
//   node core/cli.js fotos [a.com.br,b.com.br]          baixa e converte as fotos por URL pendentes e refaz os sites (config/fotos.json)
// Depois de aplicar, gere os sites: node core/build.js --sites a.com.br   e publique as pastas de dist/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { construir } = require('./build.js');
const Sites = require('./sites');
const { versoesMotor } = require('./versoes');
const C = require('./caminhos');
const LinkCarro = require('./ui/link-carro.js');

const ROOT = C.ROOT;
const BOOL = new Set(['todos', 'dry', 'forcar', 'sem-teste', 'completo', 'publicar']);
const HIST = C.config('historico.json');

const parse = (av) => {
  const o = { _: [] };
  for (let i = 0; i < av.length; i++) {
    const a = av[i];
    if (a.startsWith('--')) { const k = a.slice(2); o[k] = BOOL.has(k) ? true : av[++i]; } else o._.push(a);
  }
  return o;
};
const falha = (msg) => { console.error('Erro: ' + msg); process.exit(1); };
const lerJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function sitesInfo() {
  return Sites.listar().map((id) => {
    const arquivo = C.siteJson(id);
    const texto = fs.readFileSync(arquivo, 'utf8');
    return { id, arquivo, texto, obj: JSON.parse(texto) };
  });
}
function escolherSites(args) {
  const todos = sitesInfo();
  if (args.todos) return todos;
  if (!args.sites) falha('informe --sites a,b ou --todos');
  return args.sites.split(',').map((s) => s.trim()).filter(Boolean).map((id) => todos.find((s) => s.id === id) || falha(`site inexistente: "${id}"`));
}
const versoes = versoesMotor;
const infoVersao = (v) => { const p = path.join(C.motor(v), 'versao.json'); return fs.existsSync(p) ? lerJSON(p) : {}; };
const hash = (v) => crypto.createHash('md5').update(fs.readFileSync(path.join(C.motor(v), 'engine.js'))).digest('hex');
const historico = () => (fs.existsSync(HIST) ? lerJSON(HIST) : []);
const gravarHistorico = (h) => { fs.mkdirSync(path.dirname(HIST), { recursive: true }); fs.writeFileSync(HIST, JSON.stringify(h, null, 2) + '\n'); };
function setMotor(texto, versao) {
  if (/"motor"\s*:\s*"[^"]*"/.test(texto)) return texto.replace(/"motor"\s*:\s*"[^"]*"/, `"motor": "${versao}"`);
  return texto.replace(/^\s*\{\s*\n/, `{\n  "motor": "${versao}",\n`);
}
const agora = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

// ---------- comandos ----------
function status() {
  const vs = versoes();
  console.log('Motor');
  vs.forEach((v) => { const i = infoVersao(v); console.log(`  ${v.padEnd(8)} ${(i.data || '').padEnd(17)} ${i.nota || ''}`); });
  const ultima = vs[vs.length - 1];
  const igual = ultima && hash('rascunho') === hash(ultima);
  console.log(`  rascunho ${igual ? `igual à ${ultima}` : ultima ? `com alterações desde a ${ultima}` : 'sem versão congelada ainda'}`);
  console.log('\nSites');
  const larg = Math.max(...sitesInfo().map((s) => s.id.length));
  sitesInfo().forEach((s) => {
    const m = s.obj.motor || '(sem motor)';
    const aviso = s.obj.motor && !vs.includes(s.obj.motor) ? '  ← versão não existe!' : '';
    console.log(`  ${s.id.padEnd(larg)}  template ${String(s.obj.template).padEnd(12)} motor ${m}${aviso}`);
  });
}

function congelar(args) {
  const v = args._[0];
  if (!v || !/^v\d+(\.\d+)*$/.test(v)) falha('informe o nome da versão, ex.: congelar v2');
  const destino = C.motor(v);
  if (fs.existsSync(destino)) falha(`${v} já existe e não pode ser alterada (versões congeladas são imutáveis)`);
  const ultima = versoes().pop();
  if (ultima && hash('rascunho') === hash(ultima) && !args.forcar) falha(`o rascunho é igual à ${ultima}: nada para congelar (use --forcar se quiser mesmo assim)`);
  fs.mkdirSync(destino, { recursive: true });
  for (const f of fs.readdirSync(C.motor('rascunho'))) fs.copyFileSync(path.join(C.motor('rascunho'), f), path.join(destino, f));
  // sha256 do engine.js: os testes (tests/motor.test.js) falham se uma versão congelada for editada
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(destino, 'engine.js'))).digest('hex');
  fs.writeFileSync(path.join(destino, 'versao.json'), JSON.stringify({ versao: v, data: agora(), nota: args.nota || '', origem: 'rascunho', sha256 }, null, 2) + '\n');
  console.log(`Rascunho congelado como ${v}. Próximo passo: node core/cli.js testar --motor ${v}   e   node core/cli.js aplicar ${v} --sites <site>`);
}

// Roda o motor (sem tela!) em Node contra os arquivos gerados de cada site.
async function testarSite(pasta, id) {
  const dir = path.join(C.saida(pasta), id);
  const falhas = [];
  const ok = (c, msg) => { if (!c) falhas.push(msg); };
  const m = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(dir, 'motor', 'engine.js'), 'utf8'))(m, m.exports);
  const Motor = m.exports;
  const carregar = async (u) => lerJSON(path.join(dir, u));
  const cfg = lerJSON(path.join(dir, 'config.json'));
  const novo = () => Motor.criar({ dados: 'carros.json', config: 'config.json', carregar });
  const motor = await novo();

  ok(motor.total > 0, 'site sem carros');
  ok(motor.versao === cfg.motor, `versão do motor (${motor.versao}) diferente da configurada (${cfg.motor})`);
  ok(motor.resultado().length === motor.total, 'resultado inicial deveria ter todos os carros');
  ok(fs.existsSync(path.join(dir, 'index.html')), 'index.html não foi gerado');
  const linkDe = new Map(lerJSON(path.join(dir, 'carros.json')).filter((d) => d.l).map((d) => [d.i, d.l])); // link vindo do estoque
  const caminho = (c) => linkDe.get(c.id) || LinkCarro.caminho(c);
  const semPagina = motor.resultado().filter((c) => !fs.existsSync(path.join(dir, caminho(c))));
  ok(!semPagina.length, `faltam páginas de carros (${semPagina.length}), ex.: ${semPagina[0] && caminho(semPagina[0])}`);

  // ordenação "destaque": a lista sai na ordem do estoque (carros.json já vem nessa ordem; campo r)
  if (motor.ordens[0] && motor.ordens[0].chave === 'destaque') {
    const brutos = lerJSON(path.join(dir, 'carros.json'));
    ok(motor.resultado().every((c, i) => c.id === brutos[i].i), 'ordem padrão (destaque) diferente da ordem do estoque');
  }
  const primeiro = motor.resultado()[0];
  if (primeiro) {
    motor.buscar(`${primeiro.marca} ${primeiro.modelo}`);
    ok(motor.resultado().some((c) => c.id === primeiro.id), 'busca por marca e modelo não achou o carro');
    // erro de digitação: troca duas letras de uma palavra com 5+ letras
    const pal = `${primeiro.marca} ${primeiro.modelo} ${primeiro.cidade}`.split(/[^A-Za-zÀ-ú]+/).map((p) => p.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()).find((p) => p.length >= 5);
    if (pal && motor.buscaAtiva) {
      let i = 1;
      while (i < pal.length - 2 && pal[i] === pal[i + 1]) i++;
      const typo = pal.slice(0, i) + pal[i + 1] + pal[i] + pal.slice(i + 2);
      motor.buscar(typo);
      ok(motor.resultado().some((c) => c.id === primeiro.id), `busca aproximada não achou "${typo}" (${pal})`);
    }
    motor.limpar();
  }

  const f = motor.filtros.find((x) => x.tipo === 'lista' && x.opcoes().length > 1);
  if (f) {
    const antes = motor.total;
    const op = f.opcoes()[0].valor;
    motor.definir(f.campo, op);
    ok(motor.estado().valores[f.campo] === op, `filtro ${f.campo} não ficou aplicado`);
    ok(motor.resultado().length > 0 && motor.resultado().length < antes, `filtro ${f.campo} não reduziu a lista`);
    const q = motor.query();
    const outro = await novo();
    outro.aplicarQuery(q);
    ok(outro.resultado().length === motor.resultado().length, 'link da busca não reproduz o mesmo resultado');
    motor.limpar();
  }
  const est = motor.filtros.find((x) => x.campo === 'estado');
  const cid = motor.filtros.find((x) => x.campo === 'cidade');
  if (est && cid) {
    const todas = cid.opcoes().length;
    motor.definir('estado', est.opcoes()[0].valor);
    ok(cid.opcoes().length <= todas, 'cidades não acompanharam o estado');
    motor.limpar();
  }
  return falhas;
}

async function testar({ motor = null, sites = null, pasta = 'dist-teste' }) {
  let r;
  try { r = construir({ sites, motor, saida: pasta, completo: true, efemero: true }); } catch (e) { console.error('  não deu para gerar: ' + e.message); return false; }
  let tudoOk = true;
  for (const { site, total, motor: mv } of r.feitos) {
    const falhas = await testarSite(pasta, site.id);
    console.log(`  ${falhas.length ? 'FALHOU' : 'ok    '} ${site.id} (${total} carros, motor ${mv})${falhas.map((x) => `\n         - ${x}`).join('')}`);
    if (falhas.length) tudoOk = false;
  }
  return tudoOk;
}

async function aplicar(args) {
  const v = args._[0];
  if (!v) falha('informe a versão, ex.: aplicar v2 --sites prime');
  if (v === 'rascunho') falha('não dá para aplicar o rascunho num site: congele antes (node core/cli.js congelar v2)');
  if (!versoes().includes(v)) falha(`versão "${v}" não existe (disponíveis: ${versoes().join(', ')})`);
  const alvo = escolherSites(args);
  console.log(`Aplicar ${v} em: ${alvo.map((s) => s.id).join(', ')}`);
  if (!args['sem-teste']) {
    console.log('Testando antes de aplicar...');
    if (!(await testar({ motor: v, sites: alvo.map((s) => s.id) }))) falha('testes falharam; nada foi alterado');
  }
  const todas = alvo.map((s) => ({ site: s.id, anterior: s.obj.motor || null, para: v }));
  todas.forEach((m) => console.log(`  ${m.site}: ${m.anterior || '(nenhum)'} → ${v}${m.anterior === v ? '  (já estava)' : ''}`));
  const mudancas = todas.filter((m) => m.anterior !== v); // quem já estava na versão não entra no histórico
  if (!mudancas.length) return console.log('Nada a fazer: todos já estão na ' + v);
  if (args.dry) return console.log('(--dry: nada foi gravado)');
  alvo.filter((s) => mudancas.some((m) => m.site === s.id)).forEach((s) => fs.writeFileSync(s.arquivo, setMotor(s.texto, v)));
  const h = historico();
  h.push({ data: agora(), acao: 'aplicar', versao: v, sites: mudancas });
  gravarHistorico(h);
  console.log(`\nAplicado. Gere e publique: node core/build.js --sites ${mudancas.map((m) => m.site).join(',')}`);
}

function reverter(args) {
  const alvo = escolherSites(args);
  const h = historico();
  const mudancas = [];
  for (const s of alvo) {
    const ult = [...h].reverse().find((e) => e.sites.some((x) => x.site === s.id && x.anterior));
    if (!ult) { console.log(`  ${s.id}: sem versão anterior no histórico`); continue; }
    const anterior = ult.sites.find((x) => x.site === s.id).anterior;
    mudancas.push({ site: s.id, anterior: s.obj.motor || null, para: anterior });
    console.log(`  ${s.id}: ${s.obj.motor} → ${anterior}`);
    if (!args.dry) fs.writeFileSync(s.arquivo, setMotor(s.texto, anterior));
  }
  if (args.dry || !mudancas.length) return;
  h.push({ data: agora(), acao: 'reverter', versao: null, sites: mudancas.map((m) => ({ site: m.site, anterior: m.anterior, para: m.para })) });
  gravarHistorico(h);
  console.log(`\nRevertido. Gere e publique: node core/build.js --sites ${mudancas.map((m) => m.site).join(',')}`);
}

function mostrarHistorico() {
  const h = historico();
  if (!h.length) return console.log('Sem histórico ainda.');
  h.forEach((e) => console.log(`${e.data}  ${e.acao.padEnd(8)} ${e.sites.map((s) => `${s.site} ${s.anterior || '-'}→${s.para || e.versao || '?'}`).join(', ')}`));
}

(async () => {
  const [cmd, ...resto] = process.argv.slice(2);
  const args = parse(resto);
  const sitesArg = args.sites ? args.sites.split(',').map((s) => s.trim()) : null;
  switch (cmd) {
    case 'status': return status();
    case 'congelar': return congelar(args);
    case 'testar': {
      console.log(`Testando${args.motor ? ' com motor ' + args.motor : ''}...`);
      const okTudo = await testar({ motor: args.motor || null, sites: sitesArg });
      process.exit(okTudo ? 0 : 1);
      break;
    }
    case 'aplicar': return aplicar(args);
    case 'reverter': return reverter(args);
    case 'historico': return mostrarHistorico();
    case 'atualizar': {
      const { atualizar } = require('./atualizar.js');
      const ids = args._[0] ? args._[0].split(',').map((s) => s.trim()).filter(Boolean) : null;
      const r = await atualizar({ sites: ids, forcar: !!args.forcar, completo: !!args.completo, publicar: !!args.publicar });
      if (r.status === 'ocupado') falha('já tem uma atualização rodando (.estado/atualizar.lock)');
      // fotos por URL dos sites que mudaram: processa e refaz (só as páginas dos carros que ganharam fotos)
      const Fotos = require('./fotos.js');
      const comFotos = r.estoques.filter((e) => e.status === 'atualizado' && Fotos.pendentes(e.id).length).map((e) => e.id);
      if (comFotos.length && comFotos.every((s) => Fotos.lerConfig(require('./inquilinos').doSite(s)))) {
        const feitos = [];
        for (const s of comFotos) if ((await Fotos.processarSite(s)).processados.length) feitos.push(s);
        if (feitos.length) { construir({ sites: feitos }); if (args.publicar) await require('./atualizar.js').publicarPendentes({}); }
      } else if (comFotos.length) console.warn('aviso: há fotos por URL, mas falta config/fotos.json (veja config/fotos.exemplo.json)');
      const ruim = r.estoques.some((e) => ['invalido', 'erro', 'recusado'].includes(e.status)) || (r.publicacao && r.publicacao.falhas.length);
      process.exit(ruim ? 2 : 0);
      break;
    }
    case 'publicar': {
      const { publicarPendentes } = require('./atualizar.js');
      const r = await publicarPendentes({});
      process.exit(r.falhas.length ? 2 : 0);
      break;
    }
    case 'fotos': {
      const Fotos = require('./fotos.js');
      const alvo = args._[0] ? args._[0].split(',').map((s) => s.trim()) : Sites.listar();
      const feitos = [];
      for (const s of alvo) if ((await Fotos.processarSite(s)).processados.length) feitos.push(s);
      if (feitos.length) construir({ sites: feitos });
      else console.log('nenhuma foto pendente');
      return;
    }
    default:
      console.log('Comandos: fotos [a,b] | status | congelar vN [--nota ""] | testar [--motor v|rascunho] [--sites a,b] | aplicar vN (--sites a,b | --todos) [--dry] [--sem-teste] | reverter (--sites a,b | --todos) | historico | atualizar [dominio1,dominio2] [--publicar] [--forcar] [--completo] | publicar');
  }
})().catch((e) => falha(e.stack || e.message));
