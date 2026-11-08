// Navegador de verdade (Chrome headless): a parte que roda no cliente — listagem montada por JS, filtros pela URL,
// botão de WhatsApp, página do carro — em TODOS os templates. Pula sozinho se não houver Chrome/Chromium instalado.
const A = require('./ajuda');
const raiz = A.prepararRaiz();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { construir } = require('../core/build.js');
const L = require('../core/ui/link-carro.js');

const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', process.env.CHROME].filter(Boolean)
  .find((c) => { try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch (e) { return false; } });
const pular = process.env.SEM_NAVEGADOR ? 'SEM_NAVEGADOR definido (npm run test:rapido)' : !CHROME && 'Chrome/Chromium não encontrado (defina CHROME=/caminho)';
const templates = fs.readdirSync(path.join(A.PROJETO, 'temas'));
const TOTAL = 30;

let srv, base;
before(async () => {
  if (pular) return;
  for (const t of templates) {
    const carros = Array.from({ length: TOTAL }, (_, i) => A.carro({ marca: i % 3 ? 'Toyota' : 'Honda', modelo: i % 3 ? 'Corolla' : 'Civic', loja: i % 2 ? 'sul' : 'centro', ordem: TOTAL - i }));
    carros[TOTAL - 1].link = `carros/Link/Do/Revenda-Mais/${t}-especial-1.html`; // o primeiro na tela (ordem 1) usa link vindo do estoque
    A.criarSite(`${t}.teste.com.br`, { carros, site: { tema: t, fotosBase: '', motor: 'v3' } });
    // estado em caixas de marcar (opção "checkbox" do componente filtro, configurada na PÁGINA: web/multipla.json)
    A.gravarMultipla(`${t}.teste.com.br`, { componentes: { filtro: { checkbox: 'estado' } } });
  }
  // site com scripts de terceiros (core/codigos.js): só podem rodar depois do "Aceitar" do aviso de cookies
  A.criarSite('lgpd.teste.com.br', { carros: [A.carro()], site: { tema: 'template-basico', fotosBase: '', motor: 'v3' } });
  const cod = path.join(raiz, 'sites-config', 'lgpd.teste.com.br', 'codigos');
  fs.mkdirSync(cod, { recursive: true });
  fs.writeFileSync(path.join(cod, 'head.html'), '<script>window.terceiroHead = (window.terceiroHead || 0) + 1;</script>');
  fs.writeFileSync(path.join(cod, 'body.html'), '<script src="data:text/javascript,window.terceiroSrc=1"></script><script>document.body.dataset.terceiro = "body";</script>');
  A.silencioso(() => construir({}));
  // o servidor local usa as regras da hospedagem (infra/cloudfront/roteador.js): rotas da listagem, 301, 404.html
  srv = require('../ferramentas/servidor-local.js').criar(path.join(raiz, 'sites-public')).listen(0);
  await new Promise((ok) => srv.on('listening', ok));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv && srv.close());

// abre a página, espera o JS rodar e devolve o DOM final + erros de JS do console.
// Assíncrono de propósito: o servidor de arquivos roda neste mesmo processo (spawnSync travaria os dois).
let perfil = 0;
function abrir(url) {
  return new Promise((ok, falha) => {
    const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--virtual-time-budget=5000',
      '--enable-logging=stderr', '--v=0', `--user-data-dir=${path.join(raiz, `perfil-${perfil++}`)}`, '--dump-dom', url]);
    let dom = '', err = '';
    p.stdout.on('data', (d) => (dom += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => { p.kill('SIGKILL'); falha(new Error(`Chrome demorou demais em ${url}`)); }, 45000);
    p.on('close', () => { clearTimeout(t); ok({ dom, erros: err.split('\n').filter((l) => /CONSOLE.*(Uncaught|Error)|Uncaught/.test(l)) }); });
  });
}
// card antigo (class="card") ou do componente estoque (class="c-card")
const cards = (dom) => (semModelo(dom).match(/class="(c-)?card[" ]/g) || []).length;
const semModelo = (dom) => dom.replace(/<script type="text\/html"[\s\S]*?<\/script>/g, '');

for (const t of templates) {
  const id = `${t}.teste.com.br`;

  test(`[${t}] /multipla: o JS monta os cards, conta e não dá erro`, { skip: pular }, async () => {
    const { dom, erros } = await abrir(`${base}/${id}/multipla/`);
    assert.deepEqual(erros, [], 'erros de JavaScript no console');
    assert.equal(cards(dom), Math.min(24, TOTAL), 'primeira página de cards');
    assert.match(dom, new RegExp(`${TOTAL} carros`), 'contagem');
    assert.match(dom, /<select id="f-marca"/, 'filtro de marca montado');
    const href = semModelo(dom).match(/class="card[^"]*" href="([^"]+)"|<a class="(?:c-)?card(?:-foto|__foto)" href="([^"]+)"/);
    assert.ok(href, 'card com link');
    const alvo = (href[1] || href[2]).replace(/^\.\.\//, '');
    assert.equal(alvo, `carros/Link/Do/Revenda-Mais/${t}-especial-1.html`, 'o card usa o link vindo do estoque');
    assert.ok(fs.existsSync(path.join(raiz, 'sites-public', id, alvo)), `link do card aponta para página que existe: ${alvo}`);
  });

  test(`[${t}] /multipla?marca=Honda: filtro vindo do link é aplicado`, { skip: pular }, async () => {
    const { dom } = await abrir(`${base}/${id}/multipla/?marca=Honda`);
    assert.match(dom, /10 carros/);
    assert.equal(cards(dom), 10);
  });

  test(`[${t}] ROTA: /multipla/<campo>/<valor> em qualquer ordem, vários valores com |, nomes do Revenda Mais; canonical na ordem do site`, { skip: pular }, async () => {
    const canon = (dom) => (dom.match(/rel="canonical" href="([^"]*)"/) || [])[1];
    let r = await abrir(`${base}/${id}/multipla/marca/honda`);
    assert.deepEqual(r.erros, []);
    assert.match(r.dom, /10 carros/);
    assert.equal(cards(r.dom), 10, 'css/js/estoque.json carregados com o <base> da rota');
    assert.equal(canon(r.dom), `https://${id}/multipla/marca/honda`);
    r = await abrir(`${base}/${id}/multipla/marca/Honda%7CToyota/revenda_cidade_nome/Porto%20Alegre?ord=menor`);
    assert.deepEqual(r.erros, []);
    assert.match(r.dom, /15 carros/, 'Honda ou Toyota, só Porto Alegre');
    assert.equal(canon(r.dom), `https://${id}/multipla/revenda-cidade-nome/porto%20alegre/marca/honda|toyota`, 'mesmo filtro = mesmo endereço, nomes do Revenda Mais com "-"');
    assert.match(r.dom, /<option value="Honda\|Toyota"[^>]*>Honda, Toyota</, 'o select mostra o grupo escolhido');
    const href = semModelo(r.dom).match(/<a class="(?:c-)?card(?:-foto|__foto)?" href="([^"]+)"|class="card[^"]*" href="([^"]+)"/);
    assert.ok(href && fs.existsSync(path.join(raiz, 'sites-public', id, (href[1] || href[2]).replace(/^\.\.\//, ''))), 'link do card certo numa rota funda');
  });

  test(`[${t}] caixas de marcar (checkbox="estado"): vêm marcadas do link e cada clique filtra e reescreve a rota`, { skip: pular }, async () => {
    // página de teste no mesmo site: abre a listagem num iframe, clica nas caixas e escreve o que aconteceu
    const arq = path.join(raiz, 'sites-public', id, 'teste-clique.html');
    fs.writeFileSync(arq, `<!doctype html><body><pre id="r"></pre><iframe id="f" src="multipla/revenda-estado-cod/rs"></iframe><script>
      const f = document.getElementById('f'), log = (x) => (document.getElementById('r').textContent += x + ';');
      f.onload = () => setTimeout(() => { const d = f.contentDocument, w = f.contentWindow, n = () => d.getElementById('contagem').textContent.trim();
        try {
          log('inicio=' + n() + '|' + d.querySelectorAll('#f-estado input:checked').length);
          d.querySelector('#f-estado input[value="PR"]').click(); log('pr+rs=' + n() + '|' + w.location.pathname.split('/multipla/')[1]);
          d.querySelector('#f-estado input[value="RS"]').click(); log('pr=' + n() + '|' + w.location.pathname.split('/multipla/')[1]);
        } catch (e) { log('ERRO ' + e.message); } }, 2000);
    </script>`);
    try {
      const { dom, erros } = await abrir(`${base}/${id}/teste-clique.html`);
      assert.deepEqual(erros, []);
      const r = (dom.match(/<pre id="r">([^<]*)/) || [])[1] || '';
      assert.equal(r, 'inicio=15 carros|1;pr+rs=30 carros|revenda-estado-cod/pr%7Crs;pr=15 carros|revenda-estado-cod/pr;', r);
    } finally { fs.rmSync(arq); }
  });

  test(`[${t}] filtros ativos: uma etiqueta por filtro (com a busca), X tira só aquele, "Limpar busca" tira todos e esconde`, { skip: pular }, async () => {
    const arq = path.join(raiz, 'sites-public', id, 'teste-chips.html');
    fs.writeFileSync(arq, `<!doctype html><body><pre id="r"></pre><iframe id="f" src="multipla/marca/honda%7Ctoyota/revenda-estado-cod/rs?q=civic"></iframe><script>
      const f = document.getElementById('f'), log = (x) => (document.getElementById('r').textContent += x + ';');
      f.onload = () => setTimeout(() => { const d = f.contentDocument, n = () => d.getElementById('contagem').textContent.trim();
        const chips = () => [...d.querySelectorAll('.c-ativos__chip')].map((b) => b.dataset.valor).join(',');
        try {
          log(n() + '|' + chips());
          d.querySelector('.c-ativos__chip[data-campo="q"]').click(); log(n() + '|' + chips());
          d.querySelector('.c-ativos__chip[data-valor="Toyota"]').click(); log(n() + '|' + chips());
          d.querySelector('.c-ativos__limpar').click(); log(n() + '|' + chips() + '|' + d.getElementById('filtros-ativos').hidden);
        } catch (e) { log('ERRO ' + e.message); } }, 2000);
    </script>`);
    try {
      const { dom, erros } = await abrir(`${base}/${id}/teste-chips.html`);
      assert.deepEqual(erros, []);
      const r = (dom.match(/<pre id="r">([^<]*)/) || [])[1] || '';
      assert.equal(r, '5 carros|civic,RS,Honda,Toyota;15 carros|RS,Honda,Toyota;5 carros|RS,Honda;30 carros||true;', r);
    } finally { fs.rmSync(arq); }
  });

  test(`[${t}] filtro por parâmetro sem diferença de maiúscula/acento (como chega pelo 301 de /multipla/marca/honda/)`, { skip: pular }, async () => {
    const { dom, erros } = await abrir(`${base}/${id}/multipla/?marca=honda`);
    assert.deepEqual(erros, []);
    assert.match(dom, /10 carros/);
    assert.equal(cards(dom), 10);
  });

  test(`[${t}] página do carro: botão de WhatsApp com o número da loja e a referência do carro`, { skip: pular }, async () => {
    const c = JSON.parse(fs.readFileSync(path.join(raiz, 'sites-config', id, 'estoque.json'), 'utf8')).carros[0];
    const loja = A.LOJAS[c.loja];
    const { dom, erros } = await abrir(`${base}/${id}/${L.caminho({ ...c, cidade: loja.cidade, uf: loja.uf })}`);
    assert.deepEqual(erros, []);
    const zap = dom.match(/id="zap"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*id="zap"/);
    assert.ok(zap, 'botão #zap');
    const u = zap[1] || zap[2];
    assert.match(u, new RegExp(`^https://wa\\.me/${loja.whatsapp || '5511999999999'}\\?text=`));
    assert.ok(decodeURIComponent(u).includes(c.id), 'mensagem cita a referência do carro');
  });

  test(`[${t}] aviso de cookies aparece (com link para a política) e o contato tem o formulário`, { skip: pular }, async () => {
    const { dom, erros } = await abrir(`${base}/${id}/paginas/contato/`);
    assert.deepEqual(erros, []);
    assert.match(dom, /class="aviso-cookies"/, 'aviso de cookies');
    assert.match(dom, /href="\.\.\/\.\.\/paginas\/politica-de-cookies\/"[^>]*>Saiba mais/);
    assert.match(dom, /class="b-form-campos js-form-zap"/);
  });

  test(`[${t}] home: abre sem erro de JS`, { skip: pular }, async () => {
    const { erros, dom } = await abrir(`${base}/${id}/`);
    assert.deepEqual(erros, []);
    assert.ok(cards(dom) >= 1, 'vitrine da home com carros');
  });
}

test('LGPD: scripts de terceiros só rodam depois do "Aceitar"; "Recusar" nunca roda; a escolha vale nas próximas páginas', { skip: pular }, async () => {
  const id = 'lgpd.teste.com.br';
  const arq = path.join(raiz, 'sites-public', id, 'teste-lgpd.html');
  // passos: 1) primeira visita: nada rodou, aviso com Aceitar/Recusar → Aceitar; 2) recarrega: roda direto, sem aviso;
  // 3) apaga a escolha, recarrega → Recusar; 4) recarrega: não roda e o aviso não volta
  fs.writeFileSync(arq, `<!doctype html><body><pre id="r"></pre><iframe id="f" src="index.html"></iframe><script>
    localStorage.removeItem('cookies-ok');
    const f = document.getElementById('f'), log = (x) => (document.getElementById('r').textContent += x + ';');
    const estado = () => { const w = f.contentWindow, d = f.contentDocument, av = d.querySelector('.aviso-cookies');
      return [w.terceiroHead || 0, w.terceiroSrc || 0, d.body.dataset.terceiro || '-', av ? [...av.querySelectorAll('button')].map((b) => b.textContent).join('/') : 'sem-aviso',
        d.querySelectorAll('template[data-lgpd]').length].join(','); };
    let passo = 0;
    f.onload = () => setTimeout(() => { const d = f.contentDocument; try {
      passo++; log(passo + ':' + estado());
      if (passo === 1) { d.querySelector('.aviso-cookies-ok').click(); setTimeout(() => { log('aceitou:' + estado()); f.contentWindow.location.reload(); }, 300); }
      else if (passo === 2) { localStorage.removeItem('cookies-ok'); f.contentWindow.location.reload(); }
      else if (passo === 3) { d.querySelector('.aviso-cookies-recusar').click(); log('recusou:' + estado()); f.contentWindow.location.reload(); }
    } catch (e) { log('ERRO ' + e.message); } }, 800);
  </script>`);
  try {
    const { dom, erros } = await abrir(`${base}/${id}/teste-lgpd.html`);
    assert.deepEqual(erros, []);
    const r = (dom.match(/<pre id="r">([^<]*)/) || [])[1] || '';
    assert.equal(r, '1:0,0,-,Aceitar/Recusar,2;aceitou:1,1,body,sem-aviso,0;2:1,1,body,sem-aviso,0;3:0,0,-,Aceitar/Recusar,2;recusou:0,0,-,sem-aviso,2;4:0,0,-,sem-aviso,2;', r);
  } finally { fs.rmSync(arq); }
});
