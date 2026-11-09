// Versões dos temas (temas/<nome>/rascunho → v1, v2...; core/cli.js tema ...): o mesmo fluxo do motor. O designer edita só o
// rascunho; congelar cria uma versão imutável; o site fixa "versaoTema"; aplicar testa antes; reverter volta; prévia do
// rascunho em dist-preview/ sem tocar no site publicado.
const A = require('./ajuda');
const raiz = A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { construir } = require('../core/build.js');
const V = require('../core/versoes');
const Sites = require('../core/sites');

const ID = 'versoes.teste.com.br';
const OUTRO = 'outro-tema.teste.com.br';
const TEMA = path.join(raiz, 'temas', 'meu');
const cli = (...args) => {
  const r = spawnSync(process.execPath, [path.join(A.PROJETO, 'core', 'cli.js'), ...args], { env: { ...process.env, SITE_CARROS_RAIZ: raiz }, encoding: 'utf8' });
  return { ok: r.status === 0, saida: r.stdout + r.stderr };
};
const layout = (v) => path.join(TEMA, v, 'layout', 'tema.html');
const marcar = (v, txt) => fs.writeFileSync(layout(v), fs.readFileSync(layout(v), 'utf8').replace('</body>', `<!--${txt}--></body>`));

// tema "meu": v1 congelada (cópia do tema de teste) + rascunho igual
fs.cpSync(path.join(A.PROJETO, 'tests', 'fixtures', 'temas', 'teste', 'v1'), path.join(TEMA, 'v1'), { recursive: true });
fs.cpSync(path.join(TEMA, 'v1'), path.join(TEMA, 'rascunho'), { recursive: true });
fs.rmSync(path.join(TEMA, 'rascunho', 'versao.json'));
fs.writeFileSync(path.join(TEMA, 'v1', 'versao.json'), JSON.stringify({ versao: 'v1', sha256: V.hashPasta(path.join(TEMA, 'v1')) }));
A.criarSite(ID, { carros: [A.carro(), A.carro()], site: { tema: 'meu', versaoTema: 'v1' } });
A.criarSite(OUTRO, { carros: [A.carro()] }); // tema "teste"

test('congelar: rascunho igual à última é recusado; editado vira vN imutável (com sha256); o site não muda sozinho', () => {
  assert.match(cli('tema', 'congelar', 'meu', 'v2').saida, /o rascunho é igual à v1/);
  marcar('rascunho', 'NOVO-V2');
  const r = cli('tema', 'congelar', 'meu', 'v2', '--nota', 'rodapé novo');
  assert.ok(r.ok, r.saida);
  assert.match(fs.readFileSync(layout('v2'), 'utf8'), /NOVO-V2/);
  const info = JSON.parse(fs.readFileSync(path.join(TEMA, 'v2', 'versao.json'), 'utf8'));
  assert.deepEqual([info.versao, info.nota, info.sha256], ['v2', 'rodapé novo', V.hashPasta(path.join(TEMA, 'v2'))]);
  assert.match(cli('tema', 'congelar', 'meu', 'v2').saida, /já existe e não pode ser alterada/);
  assert.match(cli('tema', 'congelar', 'meu', 'dois').saida, /informe o nome da versão/);
  assert.equal(A.lerSite(ID).versaoTema, 'v1', 'congelar não mexe em site nenhum');
  assert.match(cli('tema', 'status').saida, /Tema meu\n {2}v1 .*← versoes\.teste\.com\.br\n {2}v2 .*rodapé novo\n {2}rascunho igual à v2/);
});

test('prévia do rascunho (build --versao-tema rascunho): vai para dist-preview/, o site publicado continua na versão dele', () => {
  marcar('rascunho', 'SO-NO-RASCUNHO');
  A.silencioso(() => construir({ sites: [ID] }));
  A.silencioso(() => construir({ sites: [ID], versaoTema: 'rascunho' }));
  assert.match(A.ler(ID, 'index.html', 'dist-preview'), /SO-NO-RASCUNHO/);
  assert.doesNotMatch(A.ler(ID, 'index.html'), /SO-NO-RASCUNHO|NOVO-V2/, 'sites-public na v1');
});

test('aplicar: testa antes, grava só "versaoTema" (o resto do site.json intacto), histórico; o build usa a versão nova', () => {
  const antes = fs.readFileSync(path.join(raiz, 'sites-config', ID, 'site.json'), 'utf8');
  assert.match(cli('tema', 'aplicar', 'meu', 'rascunho', '--sites', ID).saida, /congele antes/);
  assert.match(cli('tema', 'aplicar', 'meu', 'v9', '--sites', ID).saida, /versão "v9" do tema "meu" não existe \(disponíveis: v1, v2\)/);
  assert.match(cli('tema', 'aplicar', 'meu', 'v2', '--sites', OUTRO).saida, /usa o tema "teste", não "meu"/);
  const r = cli('tema', 'aplicar', 'meu', 'v2', '--todos');
  assert.ok(r.ok, r.saida);
  assert.match(r.saida, /ok +versoes\.teste\.com\.br .*tema meu v2/);
  const depois = fs.readFileSync(path.join(raiz, 'sites-config', ID, 'site.json'), 'utf8');
  assert.equal(depois, antes.replace('"versaoTema": "v1"', '"versaoTema": "v2"'), 'só a versão mudou (sem reformatar o arquivo)');
  assert.equal(A.lerSite(OUTRO).versaoTema, 'v1', '--todos = só os sites DESSE tema');
  const h = JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'historico.json'), 'utf8')).pop();
  assert.deepEqual([h.tipo, h.tema, h.acao, h.versao, h.sites], ['tema', 'meu', 'aplicar', 'v2', [{ site: ID, anterior: 'v1', para: 'v2' }]]);
  const f = A.silencioso(() => construir({ sites: [ID] })).r.feitos[0];
  assert.equal(f.resumo.base, true, 'versão nova do tema refaz as páginas');
  assert.match(A.ler(ID, 'index.html'), /NOVO-V2/);
  assert.doesNotMatch(A.ler(ID, 'index.html'), /SO-NO-RASCUNHO/);
});

test('reverter: volta para a versão anterior do tema (o histórico do motor não entra nisso)', () => {
  assert.match(cli('reverter', '--sites', ID).saida, /sem versão anterior no histórico/, 'reverter do MOTOR ignora as entradas de tema');
  const r = cli('tema', 'reverter', '--sites', ID);
  assert.ok(r.ok, r.saida);
  assert.equal(A.lerSite(ID).versaoTema, 'v1');
  assert.match(cli('tema', 'historico').saida, /tema meu +aplicar +versoes\.teste\.com\.br v1→v2\n.*tema meu +reverter +versoes\.teste\.com\.br v2→v1/);
});

test('tema testar pelo terminal (rascunho ou versão); site sem "versaoTema" no arquivo: o aplicar põe a linha logo depois de "tema"', () => {
  const t = cli('tema', 'testar', 'meu', 'v2');
  assert.ok(t.ok, t.saida);
  assert.match(t.saida, /Testando o tema meu v2 em: versoes\.teste\.com\.br[\s\S]*ok +versoes\.teste\.com\.br .*tema meu v2/);
  assert.match(cli('tema', 'testar', 'meu', 'v8').saida, /não tem a versão "v8" \(existem: rascunho, v1, v2\)/);
  assert.match(cli('tema', 'testar', 'nao-tem').saida, /tema "nao-tem" não existe/);
  assert.match(cli('tema', 'testar', 'meu', '--sites', 'nao-existe.com.br').saida, /Site inexistente|site inexistente/);
  assert.match(cli('tema', 'xpto').saida, /uso: tema status/);
  // cadastro antigo, escrito à mão sem "versaoTema": o aplicar insere a linha depois de "tema", sem reformatar o resto
  const arq = path.join(raiz, 'sites-config', ID, 'site.json');
  const original = fs.readFileSync(arq, 'utf8');
  fs.writeFileSync(arq, original.replace(/\n\s*"versaoTema": "v\d+",?/, ''));
  const r = cli('tema', 'aplicar', 'meu', 'v2', '--sites', ID, '--sem-teste');
  assert.ok(r.ok, r.saida);
  assert.match(fs.readFileSync(arq, 'utf8'), /\n {2}"tema": "meu",\n {2}"versaoTema": "v2",\n/);
  // JSON numa linha só (escrito por outro sistema) e sem o campo: antes a troca de texto falhava calada ("Aplicado" e nada mudava)
  const linha = JSON.parse(original); delete linha.versaoTema;
  fs.writeFileSync(arq, JSON.stringify(linha));
  assert.ok(cli('tema', 'aplicar', 'meu', 'v2', '--sites', ID, '--sem-teste').ok);
  assert.equal(JSON.parse(fs.readFileSync(arq, 'utf8')).versaoTema, 'v2');
  fs.writeFileSync(arq, original);
});

test('versão com defeito: os testes do aplicar pegam e nada muda', () => {
  fs.rmSync(path.join(TEMA, 'rascunho', 'templates', 'carro.html'));
  assert.ok(cli('tema', 'congelar', 'meu', 'v3').ok);
  const r = cli('tema', 'aplicar', 'meu', 'v3', '--sites', ID);
  assert.ok(!r.ok);
  assert.match(r.saida, /falta templates\/carro\.html[\s\S]*testes falharam; nada foi alterado/);
  assert.equal(A.lerSite(ID).versaoTema, 'v1');
});

test('o site fixa a versão: sem "versaoTema", rascunho ou versão que não existe são recusados (build e API); site novo nasce na última', () => {
  const cfg = A.lerSite(ID);
  const sem = { ...cfg }; delete sem.versaoTema;
  for (const [c, re] of [[sem, /"versaoTema" vazio ou ausente \(ex\.: "versaoTema": "v3"\)/], [{ ...cfg, versaoTema: 'rascunho' }, /não pode ser o rascunho: congele antes/],
    [{ ...cfg, versaoTema: 'v7' }, /versão "v7" do tema "meu" não existe \(existem: v1, v2, v3\)/]]) {
    assert.match(Sites.validarSite(c, ID).join(' '), re);
  }
  A.gravarSite(ID, sem);
  assert.throws(() => A.silencioso(() => construir({ sites: [ID] })), /sem "versaoTema"/);
  A.gravarSite(ID, { ...cfg, versaoTema: 'v7' });
  assert.throws(() => A.silencioso(() => construir({ sites: [ID] })), /tema "meu" não tem a versão "v7"/);
  A.gravarSite(ID, cfg);
  assert.equal(Sites.cadastroNovo('novo.teste.com.br', { tema: 'meu' }).versaoTema, 'v3', 'a última congelada');
  // tema sem versões (estrutura de antes): erro com o caminho da migração
  fs.cpSync(path.join(TEMA, 'v1'), path.join(raiz, 'temas', 'solto'), { recursive: true });
  A.gravarSite(ID, { ...cfg, tema: 'solto', versaoTema: 'v1' });
  assert.throws(() => A.silencioso(() => construir({ sites: [ID] })), /Tema "solto" sem versões.*migrar-temas/);
  A.gravarSite(ID, cfg);
});
