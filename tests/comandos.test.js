// Comandos de terminal e ferramentas, rodando de verdade (processo separado, pasta de dados temporária SITE_CARROS_RAIZ):
// core/cli.js (motor, testar, componentes, sitemap, limpar-public, publicar, atualizar, fotos), api/cli.js (inquilinos e
// tokens), core/build.js, ferramentas/servidor-local.js, auditar-sites.js, gerar-exemplo.js, migrar-temas.js (tudo de uma
// vez, com conflitos) e mover-paginas.js. Nada aqui escreve no projeto (o motor congelado nunca é criado por estes testes).
const A = require('./ajuda');
const raiz = A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawnSync, spawn } = require('child_process');

const ID = 'cli.teste.com.br';
const roda = (arq, ...args) => {
  const r = spawnSync(process.execPath, [path.join(A.PROJETO, arq), ...args], { env: { ...process.env, SITE_CARROS_RAIZ: raiz }, encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, saida: r.stdout + r.stderr };
};
const cli = (...a) => roda('core/cli.js', ...a);
const marcas = ['Honda', 'Toyota', 'Fiat'];
A.criarSite(ID, { carros: Array.from({ length: 9 }, (_, i) => A.carro({ marca: marcas[i % 3], modelo: `M${i % 3}`, loja: i % 2 ? 'sul' : 'centro' })), site: { motor: 'v4' } });

test('core/cli.js status, historico, componentes e ajuda', () => {
  const st = cli('status');
  assert.ok(st.ok, st.saida);
  assert.match(st.saida, /Motor\n {2}v1 [\s\S]*v4 [\s\S]*rascunho (igual à|com alterações desde a) v4/);
  assert.match(st.saida, /cli\.teste\.com\.br +tema teste +motor v4/);
  assert.match(cli('historico').saida, /Sem histórico ainda/);
  const comp = cli('componentes');
  for (const n of ['barra-busca', 'estoque', 'filtro', 'filtros-ativos']) assert.match(comp.saida, new RegExp(`^${n}: `, 'm'));
  assert.match(cli('componentes', 'barra-busca').saida, /textoModelo +texto +padrão "Selecione o Modelo"/);
  assert.match(cli('nao-existe').saida, /Comandos: tema .*\| status \| congelar vN/);
});

test('core/cli.js testar (com os filtros de verdade) e o fluxo do motor: aplicar (--dry, testes antes), histórico, reverter', () => {
  const t = cli('testar', '--sites', ID);
  assert.ok(t.ok, t.saida);
  assert.match(t.saida, /ok +cli\.teste\.com\.br \(9 carros, motor v4\)/);
  // recusas
  assert.match(cli('congelar', 'dois').saida, /informe o nome da versão/);
  assert.match(cli('congelar', 'v1').saida, /v1 já existe e não pode ser alterada/);
  assert.match(cli('aplicar').saida, /informe a versão/);
  assert.match(cli('aplicar', 'rascunho', '--sites', ID).saida, /congele antes/);
  assert.match(cli('aplicar', 'v99', '--sites', ID).saida, /versão "v99" não existe/);
  assert.match(cli('aplicar', 'v3').saida, /informe --sites a,b ou --todos/);
  assert.match(cli('aplicar', 'v3', '--sites', 'nao-existe.com.br').saida, /site inexistente/);
  // --dry: mostra e não grava
  assert.match(cli('aplicar', 'v3', '--sites', ID, '--dry', '--sem-teste').saida, /cli\.teste\.com\.br: v4 → v3[\s\S]*--dry: nada foi gravado/);
  assert.equal(A.lerSite(ID).motor, 'v4');
  // de verdade (testa antes)
  const ap = cli('aplicar', 'v3', '--sites', ID);
  assert.ok(ap.ok, ap.saida);
  assert.match(ap.saida, /Testando antes de aplicar[\s\S]*ok +cli\.teste\.com\.br \(9 carros, motor v3\)[\s\S]*Aplicado/);
  assert.equal(A.lerSite(ID).motor, 'v3');
  assert.match(cli('aplicar', 'v3', '--todos', '--sem-teste').saida, /Nada a fazer: todos já estão na v3/);
  assert.match(cli('historico').saida, /motor +aplicar +cli\.teste\.com\.br v4→v3/);
  assert.match(cli('reverter', '--sites', ID, '--dry').saida, /cli\.teste\.com\.br: v3 → v4/);
  assert.equal(A.lerSite(ID).motor, 'v3', '--dry não grava');
  assert.ok(cli('reverter', '--sites', ID).ok);
  assert.equal(A.lerSite(ID).motor, 'v4');
  assert.match(cli('historico').saida, /motor +reverter +cli\.teste\.com\.br v3→v4/);
  // site.json sem "motor" (escrito à mão): o status avisa, e o aplicar põe a linha no começo do arquivo
  const arq = path.join(raiz, 'sites-config', ID, 'site.json');
  const original = fs.readFileSync(arq, 'utf8');
  fs.writeFileSync(arq, original.replace(/\n\s*"motor": "v\d+",?/, ''));
  assert.match(cli('status').saida, /cli\.teste\.com\.br +tema teste +motor \(sem motor\)/);
  assert.ok(cli('aplicar', 'v4', '--sites', ID, '--sem-teste').ok);
  assert.match(fs.readFileSync(arq, 'utf8'), /^\{\n {2}"motor": "v4",\n/);
  fs.writeFileSync(arq, original.replace('"motor": "v4"', '"motor": "v0"'));
  assert.match(cli('status').saida, /motor v0 +← versão não existe!/);
  fs.writeFileSync(arq, original);
});

test('core/cli.js sitemap, limpar-public, publicar, atualizar e fotos (sem configuração: mensagens claras)', () => {
  assert.ok(roda('core/build.js', '--sites', ID).ok);
  assert.match(cli('sitemap', ID).saida, new RegExp(`${ID.replace(/\./g, '\\.')}: \\d+ endereços`));
  // sobra em sites-public (pasta sem site em sites-config): só apaga com --aplicar
  fs.mkdirSync(path.join(raiz, 'sites-public', 'sobra.com.br'), { recursive: true });
  assert.match(cli('limpar-public').saida, /sobra: sites-public\/sobra\.com\.br\/[\s\S]*Nada foi apagado/);
  assert.ok(fs.existsSync(path.join(raiz, 'sites-public', 'sobra.com.br')));
  assert.match(cli('limpar-public', '--aplicar').saida, /apagada: sites-public\/sobra\.com\.br\//);
  assert.ok(!fs.existsSync(path.join(raiz, 'sites-public', 'sobra.com.br')));
  assert.match(cli('limpar-public').saida, /nenhuma sobra/);
  // publicar sem config/publicacao.json; atualizar sem config/fontes.json; fotos sem pendência
  const pub = cli('publicar');
  assert.match(pub.saida, /publicacao\.json/);
  const at = cli('atualizar');
  assert.match(at.saida, /fontes\.json/);
  assert.match(cli('fotos', ID).saida, /nenhuma foto pendente/, 'sem foto por URL, nem precisa de config/fotos.json (antes quebrava)');
  // com foto por URL esperando e sem config/fotos.json: mensagem clara, sem stack trace
  const D = 'fotos.teste.com.br';
  A.criarSite(D, { carros: [A.carro({ fotos: ['https://exemplo.com/a.jpg'] })] });
  const f = cli('fotos', D);
  assert.equal(f.status, 1);
  assert.match(f.saida, /^Erro: crie config\/fotos\.json \(veja config\/fotos\.exemplo\.json\)/);
  assert.doesNotMatch(f.saida, /\n\s+at /, 'sem stack trace');
  fs.rmSync(path.join(raiz, 'sites-config', D), { recursive: true });
});

test('core/build.js pelo terminal (--sites, --completo, --versao-tema rascunho → dist-preview) e erro com código de saída 1', () => {
  const b = roda('core/build.js', '--sites', ID, '--completo');
  assert.ok(b.ok, b.saida);
  assert.match(b.saida, /cli\.teste\.com\.br: 9 carros · gerado do zero/);
  const quebrado = { ...A.lerSite(ID), tema: 'nao-existe' };
  const ok = A.lerSite(ID);
  A.gravarSite(ID, quebrado);
  const e = roda('core/build.js', '--sites', ID);
  assert.equal(e.status, 1);
  assert.match(e.saida, /tema "nao-existe" não existe/);
  A.gravarSite(ID, ok);
});

test('ferramentas/servidor-local.js pelo terminal: porta e pasta escolhidas, regras da hospedagem', async () => {
  const porta = await new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const p = spawn(process.execPath, [path.join(A.PROJETO, 'ferramentas', 'servidor-local.js'), String(porta), path.join(raiz, 'sites-public')], { env: { ...process.env, SITE_CARROS_RAIZ: raiz } });
  let saida = '';
  p.stdout.on('data', (d) => (saida += d));
  try {
    const fim = Date.now() + 10000;
    while (!saida.includes('sites em') && Date.now() < fim) await new Promise((r) => setTimeout(r, 50));
    assert.match(saida, new RegExp(`http://localhost:${porta}/<dominio>/`));
    const r = await fetch(`http://127.0.0.1:${porta}/${ID}/multipla/marca/honda`);
    assert.equal(r.status, 200, 'rota da listagem entregue com o multipla/index.html');
    assert.equal((await fetch(`http://127.0.0.1:${porta}/${ID}/nao-existe.html`)).status, 404);
    const inexistente = await fetch(`http://127.0.0.1:${porta}/dominio-que-nao-existe.com.br/x.html`);
    assert.deepEqual([inexistente.status, await inexistente.text()], [404, '404'], 'domínio que não existe');
    fs.mkdirSync(path.join(raiz, 'sites-public', 'sem404.com.br'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'sites-public', 'sem404.com.br', 'index.html'), '<p>oi</p>');
    const sem404 = await fetch(`http://127.0.0.1:${porta}/sem404.com.br/x.html`);
    assert.deepEqual([sem404.status, await sem404.text()], [404, ''], 'site sem 404.html: 404 vazio');
    fs.rmSync(path.join(raiz, 'sites-public', 'sem404.com.br'), { recursive: true });
  } finally { p.kill(); }
});

test('ferramentas/auditar-sites.js pelo terminal: lista os problemas de produção do site (fotos em http, sem robots...)', () => {
  const r = roda('ferramentas/auditar-sites.js');
  assert.match(r.saida, new RegExp(`Auditoria de ${path.join(raiz, 'sites-public').replace(/[.\\/]/g, '\\$&')}`), 'audita a sites-public da pasta de dados (antes: sempre a do projeto)');
  assert.match(r.saida, new RegExp(ID.replace(/\./g, '\\.')));
});

test('ferramentas/gerar-exemplo.js: estoque da primeseminovos (determinístico, válido) só nos sites que existem', () => {
  const D = 'primeseminovos.exemplo.com.br';
  A.criarSite(D, { carros: [], site: { lojas: { 'sp-centro': { nome: 'SP', cidade: 'São Paulo', uf: 'SP' }, rio: { nome: 'Rio', cidade: 'Rio de Janeiro', uf: 'RJ' } } } });
  const r = roda('ferramentas/gerar-exemplo.js');
  assert.ok(r.ok, r.saida);
  assert.match(r.saida, /sites-config\/primeseminovos\.exemplo\.com\.br\/estoque\.json: 400 carros/);
  const ler = () => JSON.parse(fs.readFileSync(path.join(raiz, 'sites-config', D, 'estoque.json'), 'utf8')).carros;
  const um = ler();
  assert.deepEqual(require('../core/atualizar.js').validarEstoque({ carros: um }, ['sp-centro', 'rio']), [], 'o estoque gerado passa na validação');
  roda('ferramentas/gerar-exemplo.js');
  assert.deepEqual(ler(), um, 'mesma semente: mesmo estoque');
  fs.rmSync(path.join(raiz, 'sites-config', D), { recursive: true });
});

test('api/cli.js: inquilinos e tokens (o token aparece uma vez; só o hash fica gravado; remover desliga)', () => {
  const api = (...a) => roda('api/cli.js', ...a);
  const cri = api('inquilino', 'criar', 'loja-xyz', '--nome', 'Loja XYZ', '--rascunho', 'site{n}.xyz-previa.com.br', '--temas', 'teste');
  assert.ok(cri.ok, cri.saida);
  assert.match(cri.saida, /Inquilino "loja-xyz" criado/);
  assert.match(api('inquilino', 'criar', 'loja-xyz').saida, /já existe/);
  assert.match(api('inquilino', 'criar').saida, /informe o id/);
  assert.match(api('inquilino', 'listar').saida, /loja-xyz +0 site\(s\) +Loja XYZ +rascunho: site\{n\}\.xyz-previa\.com\.br +temas: teste/);
  const tok = api('cliente', 'criar', 'crm-xyz', '--inquilino', 'loja-xyz', '--sites', 'ainda-nao.com.br');
  assert.ok(tok.ok, tok.saida);
  assert.match(tok.saida, /aviso: site "ainda-nao\.com\.br" ainda não existe/);
  const token = (tok.saida.match(/\n {2}(sc_\S+)/) || [])[1];
  assert.ok(token, tok.saida);
  assert.ok(!fs.readFileSync(path.join(raiz, 'config', 'clientes.json'), 'utf8').includes(token), 'só o hash');
  assert.match(api('cliente', 'criar').saida, /informe o nome/);
  assert.match(api('cliente', 'listar').saida, /crm-xyz +loja-xyz +ativo/);
  assert.ok(api('cliente', 'remover', 'crm-xyz').ok);
  assert.match(api('cliente', 'remover', 'crm-xyz').saida, /cliente "crm-xyz" não existe/);
  assert.match(api('cliente', 'listar').saida, /Nenhum cliente/);
  assert.match(api('xpto').saida, /uso: inquilino criar/);
  assert.match(api('cliente', 'xpto').saida, /uso: /);
  assert.match(api('inquilino', 'xpto').saida, /uso: /);
});

test('ferramentas/migrar-temas.js tudo de uma vez: templates/ antigo, tema de inquilino, inquilino.json, site-modelo, sites; conflitos não estragam nada', () => {
  // um tema na pasta antiga templates/ (estrutura de antes), outro de inquilino, e um conflito (mesmo nome já em temas/)
  const velho = (dir) => {
    fs.mkdirSync(path.join(dir, 'paginas'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify({ nome: 'Velho' }));
    fs.writeFileSync(path.join(dir, 'paginas', 'home.html'), '<p>{{tema.logo}}</p>{{{blocosAntes}}}');
  };
  velho(path.join(raiz, 'templates', 'antigo'));
  velho(path.join(raiz, 'templates', 'teste-conflito'));
  fs.mkdirSync(path.join(raiz, 'temas', 'teste-conflito'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'inquilinos', 'velhinho'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'inquilinos', 'velhinho', 'inquilino.json'), JSON.stringify({ nome: 'Velhinho', templates: ['antigo'] }));
  velho(path.join(raiz, 'inquilinos', 'velhinho', 'templates', 'proprio'));
  fs.writeFileSync(path.join(raiz, 'config', 'site-modelo.json'), JSON.stringify({ template: 'antigo', tema: { cor: '#123456' } }));
  A.criarSite('migra.teste.com.br', { carros: [A.carro()] });
  const cfg = A.lerSite('migra.teste.com.br'); delete cfg.tema; delete cfg.versaoTema;
  A.gravarSite('migra.teste.com.br', { ...cfg, template: 'antigo', tema: { cor: '#00ff00' } });

  const sim = roda('ferramentas/migrar-temas.js', '--simular');
  assert.match(sim.saida, /\[simulação\] templates\/antigo → temas\/antigo/);
  assert.ok(fs.existsSync(path.join(raiz, 'templates', 'antigo')), '--simular não mexe em nada');

  const r = roda('ferramentas/migrar-temas.js');
  assert.equal(r.status, 1, 'conflito = código de saída 1 (para o script de deploy perceber)');
  assert.match(r.saida, /templates\/teste-conflito: já existe temas\/teste-conflito; não mexido/);
  // o que dava para migrar, migrou
  for (const v of ['v1', 'rascunho']) {
    assert.equal(fs.readFileSync(path.join(raiz, 'temas', 'antigo', v, 'templates', 'home.html'), 'utf8'), '<p>{{configuracoes.logo}}</p>{{{secoesAntes}}}');
    assert.ok(fs.existsSync(path.join(raiz, 'inquilinos', 'velhinho', 'temas', 'proprio', v, 'config', 'settings_schema.json')), `tema do inquilino ${v}`);
  }
  assert.ok(fs.existsSync(path.join(raiz, 'templates', 'teste-conflito', 'template.json')), 'o conflito ficou onde estava');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raiz, 'inquilinos', 'velhinho', 'inquilino.json'), 'utf8')), { nome: 'Velhinho', temas: ['antigo'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'site-modelo.json'), 'utf8')), { tema: 'antigo', configuracoes: { cor: '#123456' } });
  const s = A.lerSite('migra.teste.com.br');
  assert.deepEqual([s.tema, s.versaoTema, s.configuracoes, s.template], ['antigo', 'v1', { cor: '#00ff00' }, undefined]);
  // resolvido o conflito, roda de novo: o que já está no formato novo fica como está
  fs.rmSync(path.join(raiz, 'templates'), { recursive: true });
  fs.rmSync(path.join(raiz, 'temas', 'teste-conflito'), { recursive: true });
  const de_novo = roda('ferramentas/migrar-temas.js');
  assert.ok(de_novo.ok, de_novo.saida);
  assert.match(de_novo.saida, /nada a migrar/);
  for (const d of ['antigo']) fs.rmSync(path.join(raiz, 'temas', d), { recursive: true });
  fs.rmSync(path.join(raiz, 'inquilinos', 'velhinho'), { recursive: true });
  fs.rmSync(path.join(raiz, 'config', 'site-modelo.json'));
  fs.rmSync(path.join(raiz, 'sites-config', 'migra.teste.com.br'), { recursive: true });
});

test('ferramentas/mover-paginas.js: "componentes" do site.json vira sites-config/<d>/componentes/<nome>.json (e não sobrescreve)', () => {
  const D = 'mover.teste.com.br';
  A.criarSite(D, { carros: [A.carro()] });
  A.gravarSite(D, { ...A.lerSite(D), componentes: { estoque: { porPagina: 6 }, filtro: { checkbox: 'marca' } } });
  const r = roda('ferramentas/mover-paginas.js', D);
  assert.ok(r.ok, r.saida);
  assert.match(r.saida, /componentes → componentes\/estoque\.json, componentes\/filtro\.json/);
  assert.equal(A.lerSite(D).componentes, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raiz, 'sites-config', D, 'componentes', 'estoque.json'), 'utf8')), { porPagina: 6 });
  // de novo, com o arquivo já existindo: não sobrescreve e avisa (código 1)
  A.gravarSite(D, { ...A.lerSite(D), componentes: { estoque: { porPagina: 99 } } });
  const r2 = roda('ferramentas/mover-paginas.js', D);
  assert.equal(r2.status, 1);
  assert.match(r2.saida, /componentes\/estoque\.json já existe; componentes não mexidos/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raiz, 'sites-config', D, 'componentes', 'estoque.json'), 'utf8')), { porPagina: 6 });
  fs.rmSync(path.join(raiz, 'sites-config', D), { recursive: true });
});

test('core/cli.js atualizar com fotos por URL: sem config/fotos.json só avisa; com ela, baixa, converte e refaz o site', async () => {
  const http = require('http');
  const D = 'atualiza.teste.com.br';
  A.criarSite(D, { carros: [A.carro({ id: 'F1' })] });
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  let estoque = { carros: [A.carro({ id: 'F1', fotos: [] }), A.carro({ id: 'F2', fotos: [] })] };
  const fonte = http.createServer((q, s) => {
    if (q.url === '/estoque') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify(estoque)); }
    s.writeHead(200, { 'content-type': 'image/png' }); s.end(png);
  }).listen(0, '127.0.0.1');
  await new Promise((ok) => fonte.on('listening', ok));
  const base = `http://127.0.0.1:${fonte.address().port}`;
  estoque = { carros: [A.carro({ id: 'F1', fotos: [`${base}/1.png`] }), A.carro({ id: 'F2', fotos: [`${base}/2.png`] })] };
  fs.writeFileSync(path.join(raiz, 'config', 'fontes.json'), JSON.stringify({ [D]: `${base}/estoque` }));
  // o cli roda num processo separado: o servidor de fotos/estoque precisa ficar livre enquanto ele roda (spawn, não spawnSync)
  const cliAsync = (...a) => new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(A.PROJETO, 'core', 'cli.js'), ...a], { env: { ...process.env, SITE_CARROS_RAIZ: raiz } });
    let saida = ''; p.stdout.on('data', (d) => (saida += d)); p.stderr.on('data', (d) => (saida += d));
    p.on('close', (status) => ok({ status, saida }));
  });
  try {
    const sem = await cliAsync('atualizar', D);
    assert.match(sem.saida, /aviso: há fotos por URL, mas falta config\/fotos\.json/);
    // com a configuração (conversor de mentira: copia a entrada para os 3 tamanhos; "pasta" local no lugar da S3)
    fs.writeFileSync(path.join(raiz, 'config', 'fotos.json'), JSON.stringify({ pasta: 'fotos-cli', permitirRedeLocal: true,
      converter: `sh -c 'for w in 400 800 1600; do cp "$1" "$2-$w.webp"; done' _ {entrada} {saida}` }));
    estoque.carros[0].km += 1; // estoque diferente: o atualizar grava e as fotos entram
    const com = await cliAsync('atualizar', D);
    assert.equal(com.status, 0, com.saida);
    assert.ok(fs.existsSync(path.join(raiz, 'fotos-cli', 'carros', 'F1', '1-800.webp')), com.saida);
    assert.deepEqual(A.lerJSON(D, 'estoque.json').map((c) => c.n), [1, 1], 'o site foi refeito com as fotos prontas');
  } finally {
    fonte.close();
    for (const f of ['fontes.json', 'fotos.json']) fs.rmSync(path.join(raiz, 'config', f), { force: true });
    fs.rmSync(path.join(raiz, 'sites-config', D), { recursive: true });
  }
});
