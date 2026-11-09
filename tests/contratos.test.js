// Contratos que não precisam do Chrome:
//   - os arquivos de core/ui que rodam no navegador E no Node (rotas, link do carro, formato do estoque) viram variáveis
//     globais quando não há "module" (é assim que as páginas os usam: window.Rotas, window.LinkCarro, window.FormatoEstoque)
//   - o "congelar" do motor com sucesso: roda numa CÓPIA de core/motor (SITE_CARROS_MOTOR; nunca cria versão no projeto)
const A = require('./ajuda');
const raiz = A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

test('core/ui no navegador: sem "module", cada arquivo vira a variável global que as páginas usam (e funciona igual ao do Node)', () => {
  for (const [arq, nome] of [['rotas.js', 'Rotas'], ['link-carro.js', 'LinkCarro'], ['formato-estoque.js', 'FormatoEstoque']]) {
    const caminho = path.join(A.PROJETO, 'core', 'ui', arq);
    const janela = {};
    janela.self = janela; // no navegador, self === window
    vm.runInNewContext(fs.readFileSync(caminho, 'utf8'), janela, { filename: caminho });
    assert.equal(typeof janela[nome], 'object', `${arq}: window.${nome}`);
    const node = require(caminho);
    assert.deepEqual(Object.keys(janela[nome]).sort(), Object.keys(node).sort(), `${arq}: mesmas funções no navegador e no Node`);
  }
  // e dão o mesmo resultado
  const j = { self: null }; j.self = j;
  vm.runInNewContext(fs.readFileSync(path.join(A.PROJETO, 'core', 'ui', 'rotas.js'), 'utf8'), j);
  const pares = [['marca', 'Audi|BMW'], ['estado', 'PR']];
  assert.equal(j.Rotas.montar(pares), require('../core/ui/rotas.js').montar(pares));
});

test('congelar o motor (numa cópia de core/motor, via SITE_CARROS_MOTOR): cria vN com o engine do rascunho e o sha256 que o teste do motor confere', () => {
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'site-carros-motor-'));
  try {
    fs.cpSync(path.join(A.PROJETO, 'core', 'motor'), copia, { recursive: true });
    const cli = (...a) => spawnSync(process.execPath, [path.join(A.PROJETO, 'core', 'cli.js'), ...a], { env: { ...process.env, SITE_CARROS_RAIZ: raiz, SITE_CARROS_MOTOR: copia }, encoding: 'utf8' });
    const ultima = fs.readdirSync(copia).filter((v) => /^v\d+$/.test(v)).sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })).pop();
    const nova = `v${Number(ultima.slice(1)) + 1}`;
    // rascunho diferente da última congelada
    const rasc = path.join(copia, 'rascunho', 'engine.js');
    fs.appendFileSync(rasc, '\n// mudança de teste\n');
    const r = cli('congelar', nova, '--nota', 'teste de congelar');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`Rascunho congelado como ${nova}`));
    const dir = path.join(copia, nova);
    assert.equal(fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'), fs.readFileSync(rasc, 'utf8'));
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'versao.json'), 'utf8'));
    assert.deepEqual([info.versao, info.nota, info.origem], [nova, 'teste de congelar', 'rascunho']);
    assert.equal(info.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'engine.js'))).digest('hex'));
    assert.match(cli('status').stdout, new RegExp(`${nova} .*teste de congelar`));
    // de novo: igual à última → recusa; --forcar congela mesmo assim
    assert.match(cli('congelar', `v${Number(nova.slice(1)) + 1}`).stderr, new RegExp(`o rascunho é igual à ${nova}`));
    assert.equal(cli('congelar', `v${Number(nova.slice(1)) + 1}`, '--forcar').status, 0);
    assert.ok(!fs.existsSync(path.join(A.PROJETO, 'core', 'motor', nova)), 'nada foi criado no projeto');
  } finally { fs.rmSync(copia, { recursive: true, force: true }); }
});
