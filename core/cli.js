#!/usr/bin/env node
// Versões do motor: rascunho → congelar → testar → aplicar em alguns sites → aplicar em todos (→ reverter)
// Os sites são identificados pelo domínio (nome da pasta em sites-config/).
//   node core/cli.js status
//   node core/cli.js congelar v2 --nota "texto"         copia core/motor/rascunho para core/motor/v2 (fica imutável)
//   node core/cli.js testar [--motor v2|rascunho] [--sites a.com.br,b.com.br]
//   node core/cli.js aplicar v2 --sites a.com.br        ou --todos   (roda os testes antes; --sem-teste pula; --dry só mostra)
//   node core/cli.js reverter --sites a.com.br          volta esses sites para a versão anterior
//   node core/cli.js historico
// Versões dos TEMAS (o mesmo fluxo; o designer edita só temas/<nome>/rascunho/):
//   node core/cli.js tema status
//   node core/cli.js tema congelar template-basico v2 --nota "texto"   copia temas/<nome>/rascunho para temas/<nome>/v2 (imutável)
//   node core/cli.js tema testar template-basico [v2|rascunho] [--sites a,b]   gera numa pasta temporária e testa
//   node core/cli.js tema aplicar template-basico v2 --sites a,b       ou --todos (os sites desse tema); roda os testes antes
//   node core/cli.js tema reverter --sites a,b                         volta esses sites para a versão anterior do tema
//   node core/cli.js tema historico
//   (--inquilino <id> nos comandos de um tema PRÓPRIO do inquilino: inquilinos/<id>/temas/<nome>/)
//   node core/cli.js atualizar [a.com.br,b.com.br] [--publicar]   busca o estoque em config/fontes.json e refaz só o que mudou
//   node core/cli.js publicar                           publica só o que mudou e ainda não foi publicado (config/publicacao.json)
//   node core/cli.js limpar-public [--aplicar]          pastas de sites-public sem site em sites-config (apaga com --aplicar)
//   node core/cli.js componentes [nome]                 lista os componentes e todas as opções
//   node core/cli.js sitemap [a.com.br,b.com.br]        reconstrói o sitemap.xml (páginas + carros no ar; core/sitemap.js)
//   node core/cli.js fotos [a.com.br,b.com.br]          baixa e converte as fotos por URL pendentes e refaz os sites (config/fotos.json)
// Depois de aplicar, gere os sites: node core/build.js --sites a.com.br   e publique as pastas de sites-public/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { construir } = require('./build.js');
const Sites = require('./sites');
const Versoes = require('./versoes');
const { versoesMotor } = Versoes;
const C = require('./caminhos');
const LinkCarro = require('./ui/link-carro.js');
const FormatoEstoque = require('./ui/formato-estoque.js');

const ROOT = C.ROOT;
const BOOL = new Set(['todos', 'dry', 'forcar', 'sem-teste', 'completo', 'publicar', 'aplicar']);
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
// muda um campo de texto do site.json sem reformatar o arquivo; se não existir, entra depois de "depois" (ou no começo)
function setCampo(texto, campo, valor, depois = null) {
  const re = new RegExp(`"${campo}"\\s*:\\s*"[^"]*"`);
  if (re.test(texto)) return texto.replace(re, `"${campo}": "${valor}"`);
  const ref = depois && new RegExp(`(\\n(\\s*)"${depois}"\\s*:\\s*"[^"]*",?)`).exec(texto);
  if (ref) return texto.replace(ref[1], `${ref[1].endsWith(',') ? ref[1] : `${ref[1]},`}\n${ref[2]}"${campo}": "${valor}"${ref[1].endsWith(',') ? ',' : ''}`);
  return texto.replace(/^\s*\{\s*\n/, `{\n  "${campo}": "${valor}",\n`);
}
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
    console.log(`  ${s.id.padEnd(larg)}  tema ${String(s.obj.tema).padEnd(15)} motor ${m}${aviso}`);
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
  const ler = (u) => (u.endsWith('estoque.json') ? FormatoEstoque.descompactar(lerJSON(path.join(dir, u))) : lerJSON(path.join(dir, u))); // aceita o compacto
  const carregar = async (u) => ler(u);
  const cfg = lerJSON(path.join(dir, 'config.json'));
  const novo = () => Motor.criar({ dados: 'estoque.json', config: 'config.json', carregar });
  const motor = await novo();

  ok(motor.total > 0, 'site sem carros');
  ok(motor.versao === cfg.motor, `versão do motor (${motor.versao}) diferente da configurada (${cfg.motor})`);
  ok(motor.resultado().length === motor.total, 'resultado inicial deveria ter todos os carros');
  ok(fs.existsSync(path.join(dir, 'index.html')), 'index.html não foi gerado');
  // o tema: páginas principais geradas e nenhum marcador {{ }} sobrando (campo com nome errado, bloco do layout quebrado)
  for (const p of ['index.html', 'multipla/index.html', '404.html']) {
    const arq = path.join(dir, p);
    if (!fs.existsSync(arq)) { falhas.push(`${p} não foi gerado`); continue; }
    const sobra = fs.readFileSync(arq, 'utf8').match(/\{\{[#^/>$!]?\s*[a-zA-Z][^}]*\}\}/);
    ok(!sobra, `${p}: marcador sobrando ${sobra && sobra[0]}`);
  }
  const linkDe = new Map(ler('estoque.json').filter((d) => d.l).map((d) => [d.i, d.l])); // link vindo do estoque
  const caminho = (c) => linkDe.get(c.id) || LinkCarro.caminho(c);
  const semPagina = motor.resultado().filter((c) => !fs.existsSync(path.join(dir, caminho(c))));
  ok(!semPagina.length, `faltam páginas de carros (${semPagina.length}), ex.: ${semPagina[0] && caminho(semPagina[0])}`);

  // ordenação "destaque": a lista sai na ordem do estoque (estoque.json já vem nessa ordem; campo r)
  if (motor.ordens[0] && motor.ordens[0].chave === 'destaque') {
    const brutos = ler('estoque.json');
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

// gera numa pasta TEMPORÁRIA (.estado/teste-<pid>), testa e apaga: a única saída que fica no projeto é a sites-public/
async function testar({ motor = null, versaoTema = null, sites = null }) {
  const pasta = path.join('.estado', `teste-${process.pid}`);
  try {
    let r;
    try { r = construir({ sites, motor, versaoTema, saida: pasta, completo: true, efemero: true }); } catch (e) { console.error('  não deu para gerar: ' + e.message); return false; }
    let tudoOk = true;
    for (const { site, total, motor: mv } of r.feitos) {
      const falhas = await testarSite(pasta, site.id);
      console.log(`  ${falhas.length ? 'FALHOU' : 'ok    '} ${site.id} (${total} carros, motor ${mv}${versaoTema ? `, tema ${site.tema} ${versaoTema}` : ''})${falhas.map((x) => `\n         - ${x}`).join('')}`);
      if (falhas.length) tudoOk = false;
    }
    return tudoOk;
  } finally { fs.rmSync(C.saida(pasta), { recursive: true, force: true }); }
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
    const ult = [...h].reverse().find((e) => e.tipo !== 'tema' && e.sites.some((x) => x.site === s.id && x.anterior));
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
  h.forEach((e) => console.log(`${e.data}  ${e.tipo === 'tema' ? `tema ${e.tema}` : 'motor'}  ${e.acao.padEnd(8)} ${e.sites.map((s) => `${s.site} ${s.anterior || '-'}→${s.para || e.versao || '?'}`).join(', ')}`));
}

// ---------- versões dos TEMAS: temas/<nome>/rascunho (editável) → v1, v2... (imutáveis); o site fixa "versaoTema" ----------
function raizDoTema(nome, args) {
  const Inq = require('./inquilinos');
  const inq = args.inquilino || Inq.PADRAO;
  if (!nome || !/^[a-z0-9-]+$/.test(nome)) falha('informe o tema, ex.: tema congelar template-basico v2');
  const raiz = Inq.dirTema(inq, nome);
  if (Versoes.temaSemVersoes(raiz)) falha(`o tema "${nome}" ainda não tem versões: node ferramentas/migrar-temas.js`);
  if (!Versoes.ehTema(raiz)) falha(`tema "${nome}" não existe (${path.relative(ROOT, raiz)}/)`);
  return raiz;
}
const sitesDoTema = (nome, args) => {
  const Inq = require('./inquilinos');
  return sitesInfo().filter((s) => s.obj.tema === nome && (!args.inquilino || Inq.doSite(s.obj) === args.inquilino));
};
function temaCongelar(args) {
  const [, nome, v] = args._;
  const raiz = raizDoTema(nome, args);
  if (!v || !Versoes.VERSAO_OK.test(v)) falha('informe o nome da versão, ex.: tema congelar template-basico v2');
  const rasc = path.join(raiz, 'rascunho');
  if (!Versoes.ehVersaoDeTema(raiz, 'rascunho')) falha(`o tema "${nome}" não tem rascunho (${path.relative(ROOT, rasc)}/)`);
  const destino = path.join(raiz, v);
  if (fs.existsSync(destino)) falha(`${nome} ${v} já existe e não pode ser alterada (versões congeladas são imutáveis)`);
  const ultima = Versoes.ultimaVersaoTema(raiz);
  if (ultima && Versoes.hashPasta(rasc) === Versoes.hashPasta(path.join(raiz, ultima)) && !args.forcar) falha(`o rascunho é igual à ${ultima}: nada para congelar (use --forcar se quiser mesmo assim)`);
  try { require('./temas').carregar(rasc); } catch (e) { falha(`o rascunho tem erro: ${e.message}`); }
  fs.cpSync(rasc, destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'versao.json'), JSON.stringify({ versao: v, data: agora(), nota: args.nota || '', origem: 'rascunho', sha256: Versoes.hashPasta(destino) }, null, 2) + '\n');
  console.log(`Rascunho do tema ${nome} congelado como ${v}. Próximo passo: node core/cli.js tema testar ${nome} ${v}   e   node core/cli.js tema aplicar ${nome} ${v} --sites <site>`);
}
async function temaTestar(args) {
  const [, nome, v = 'rascunho'] = args._;
  const raiz = raizDoTema(nome, args);
  if (!Versoes.ehVersaoDeTema(raiz, v)) falha(`o tema "${nome}" não tem a versão "${v}" (existem: ${['rascunho', ...Versoes.versoesTema(raiz)].join(', ')})`);
  const sites = args.sites ? args.sites.split(',').map((x) => x.trim()) : sitesDoTema(nome, args).map((s) => s.id);
  if (!sites.length) falha(`nenhum site usa o tema "${nome}" (use --sites para testar em outro)`);
  console.log(`Testando o tema ${nome} ${v} em: ${sites.join(', ')}`);
  const okTudo = await testar({ versaoTema: v, sites });
  process.exit(okTudo ? 0 : 1);
}
async function temaAplicar(args) {
  const [, nome, v] = args._;
  const raiz = raizDoTema(nome, args);
  if (!v) falha(`informe a versão, ex.: tema aplicar ${nome} v2 --sites a.com.br`);
  if (v === 'rascunho') falha(`não dá para aplicar o rascunho num site: congele antes (node core/cli.js tema congelar ${nome} vN)`);
  if (!Versoes.versoesTema(raiz).includes(v)) falha(`versão "${v}" do tema "${nome}" não existe (disponíveis: ${Versoes.versoesTema(raiz).join(', ')})`);
  const alvo = args.todos ? sitesDoTema(nome, args) : escolherSites(args);
  const outro = alvo.find((s) => s.obj.tema !== nome);
  if (outro) falha(`o site "${outro.id}" usa o tema "${outro.obj.tema}", não "${nome}" (trocar de tema é pelo cadastro: "tema" e "versaoTema" no site.json)`);
  if (!alvo.length) falha(`nenhum site usa o tema "${nome}"`);
  console.log(`Aplicar o tema ${nome} ${v} em: ${alvo.map((s) => s.id).join(', ')}`);
  if (!args['sem-teste']) {
    console.log('Testando antes de aplicar...');
    if (!(await testar({ versaoTema: v, sites: alvo.map((s) => s.id) }))) falha('testes falharam; nada foi alterado');
  }
  const todas = alvo.map((s) => ({ site: s.id, anterior: s.obj.versaoTema || null, para: v }));
  todas.forEach((m) => console.log(`  ${m.site}: ${m.anterior || '(nenhuma)'} → ${v}${m.anterior === v ? '  (já estava)' : ''}`));
  const mudancas = todas.filter((m) => m.anterior !== v);
  if (!mudancas.length) return console.log(`Nada a fazer: todos já estão na ${v}`);
  if (args.dry) return console.log('(--dry: nada foi gravado)');
  alvo.filter((s) => mudancas.some((m) => m.site === s.id)).forEach((s) => fs.writeFileSync(s.arquivo, setCampo(s.texto, 'versaoTema', v, 'tema')));
  const h = historico();
  h.push({ data: agora(), tipo: 'tema', tema: nome, acao: 'aplicar', versao: v, sites: mudancas });
  gravarHistorico(h);
  console.log(`\nAplicado. Gere e publique: node core/build.js --sites ${mudancas.map((m) => m.site).join(',')}`);
}
function temaReverter(args) {
  const alvo = escolherSites(args);
  const h = historico();
  const mudancas = [];
  for (const s of alvo) {
    const ult = [...h].reverse().find((e) => e.tipo === 'tema' && e.tema === s.obj.tema && e.sites.some((x) => x.site === s.id && x.anterior));
    if (!ult) { console.log(`  ${s.id}: sem versão anterior do tema no histórico`); continue; }
    const anterior = ult.sites.find((x) => x.site === s.id).anterior;
    mudancas.push({ site: s.id, anterior: s.obj.versaoTema || null, para: anterior, tema: s.obj.tema });
    console.log(`  ${s.id}: tema ${s.obj.tema} ${s.obj.versaoTema} → ${anterior}`);
    if (!args.dry) fs.writeFileSync(s.arquivo, setCampo(s.texto, 'versaoTema', anterior, 'tema'));
  }
  if (args.dry || !mudancas.length) return;
  for (const tema of new Set(mudancas.map((m) => m.tema))) {
    h.push({ data: agora(), tipo: 'tema', tema, acao: 'reverter', versao: null, sites: mudancas.filter((m) => m.tema === tema).map(({ site, anterior, para }) => ({ site, anterior, para })) });
  }
  gravarHistorico(h);
  console.log(`\nRevertido. Gere e publique: node core/build.js --sites ${mudancas.map((m) => m.site).join(',')}`);
}
function temaStatus(args) {
  const Temas = require('./temas');
  const Inq = require('./inquilinos');
  for (const nome of Temas.listar(args.inquilino || Inq.PADRAO)) {
    const raiz = Inq.dirTema(args.inquilino || Inq.PADRAO, nome);
    const vs = Versoes.versoesTema(raiz);
    console.log(`Tema ${nome}`);
    for (const v of vs) {
      const i = fs.existsSync(path.join(raiz, v, 'versao.json')) ? lerJSON(path.join(raiz, v, 'versao.json')) : {};
      const quem = sitesDoTema(nome, args).filter((s) => s.obj.versaoTema === v).map((s) => s.id);
      console.log(`  ${v.padEnd(8)} ${(i.data || '').padEnd(17)} ${i.nota || ''}${quem.length ? `  ← ${quem.join(', ')}` : ''}`);
    }
    const ultima = vs[vs.length - 1];
    const temRasc = Versoes.ehVersaoDeTema(raiz, 'rascunho');
    console.log(`  rascunho ${!temRasc ? '(não existe)' : ultima && Versoes.hashPasta(path.join(raiz, 'rascunho')) === Versoes.hashPasta(path.join(raiz, ultima)) ? `igual à ${ultima}` : ultima ? `com alterações desde a ${ultima}` : 'sem versão congelada ainda'}`);
  }
}
async function tema(args) {
  const sub = args._[0];
  if (sub === 'status') return temaStatus(args);
  if (sub === 'congelar') return temaCongelar(args);
  if (sub === 'testar') return temaTestar(args);
  if (sub === 'aplicar') return temaAplicar(args);
  if (sub === 'reverter') return temaReverter(args);
  if (sub === 'historico') { const h = historico().filter((e) => e.tipo === 'tema'); if (!h.length) return console.log('Sem histórico de temas ainda.'); return h.forEach((e) => console.log(`${e.data}  tema ${e.tema}  ${e.acao.padEnd(8)} ${e.sites.map((s) => `${s.site} ${s.anterior || '-'}→${s.para || e.versao || '?'}`).join(', ')}`)); }
  falha('uso: tema status | tema congelar <tema> vN [--nota ""] | tema testar <tema> [vN|rascunho] [--sites a,b] | tema aplicar <tema> vN (--sites a,b | --todos) [--dry] [--sem-teste] | tema reverter (--sites a,b | --todos) | tema historico   (--inquilino <id> para tema próprio do inquilino)');
}

(async () => {
  const [cmd, ...resto] = process.argv.slice(2);
  const args = parse(resto);
  const sitesArg = args.sites ? args.sites.split(',').map((s) => s.trim()) : null;
  switch (cmd) {
    case 'status': return status();
    case 'tema': return tema(args);
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
    case 'limpar-public': {
      // node core/cli.js limpar-public [--aplicar]   pastas de sites-public sem site em sites-config (só apaga com --aplicar)
      const { sobrasNaSaida } = require('./build.js');
      const sobras = sobrasNaSaida();
      if (!sobras.length) return console.log(`${C.PUBLICO}/: nenhuma sobra (toda pasta tem site em sites-config/)`);
      for (const o of sobras) console.log(`${args.aplicar ? 'apagada' : 'sobra'}: ${C.PUBLICO}/${o}/`);
      if (args.aplicar) { for (const o of sobras) fs.rmSync(path.join(C.saida(C.PUBLICO), o), { recursive: true, force: true }); require('./build.js').atualizarIndice(); }
      else console.log('\nNada foi apagado. Para apagar: node core/cli.js limpar-public --aplicar');
      return;
    }
    case 'componentes': {
      // node core/cli.js componentes [nome]   lista os componentes e todas as opções (do componente.json)
      const Comp = require('./componentes');
      for (const n of args._[0] ? [args._[0]] : Comp.listar()) {
        const c = Comp.carregar(n);
        console.log(`\n${n}: ${c.def.descricao || ''}`);
        for (const [k, d] of Object.entries(c.opcoes)) {
          const tipo = d.tipo || (typeof d.padrao === 'boolean' ? 'booleano' : typeof d.padrao === 'number' ? 'numero' : 'texto');
          console.log(`  ${k.padEnd(16)} ${tipo.padEnd(9)} padrão ${JSON.stringify(d.padrao)}${d.valores ? ` · aceita: ${d.valores.join(', ')}` : ''}${d.descricao ? ` · ${d.descricao}` : ''}`);
        }
      }
      return;
    }
    case 'sitemap': {
      // node core/cli.js sitemap [dominio1,dominio2]  reconstrói o sitemap.xml a partir do que está gerado
      const { gerarSitemap } = require('./sitemap.js');
      for (const d of args._[0] ? args._[0].split(',') : Sites.listar()) { const r = gerarSitemap(d); console.log(`${d}: ${r.status === 'sem_url' ? 'sem "url" no site.json: sem sitemap' : `${r.urls} endereços${r.alterado ? ' (atualizado)' : ' (sem mudança)'}`}`); }
      return;
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
      console.log('Comandos: tema (status|congelar|testar|aplicar|reverter|historico) | fotos [a,b] | status | congelar vN [--nota ""] | testar [--motor v|rascunho] [--sites a,b] | aplicar vN (--sites a,b | --todos) [--dry] [--sem-teste] | reverter (--sites a,b | --todos) | historico | atualizar [dominio1,dominio2] [--publicar] [--forcar] [--completo] | publicar');
  }
})().catch((e) => falha(e.stack || e.message));
