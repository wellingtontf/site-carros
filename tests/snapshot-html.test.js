// Guarda do VERSAO_HTML (core/build.js). Gera um site fixo com o template "teste" e compara a saída com
// tests/snapshot-html.json. Por quê: as páginas de carro só são refeitas quando o hash delas muda; se o build passar a
// gerar HTML diferente sem aumentar VERSAO_HTML, os sites ficariam com páginas novas e velhas misturadas.
//   - saída mudou e VERSAO_HTML não → aumente VERSAO_HTML em core/build.js
//   - VERSAO_HTML mudou → rode: SNAPSHOT_ATUALIZAR=1 node --test tests/snapshot-html.test.js
const A = require('./ajuda');
A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { construir, VERSAO_HTML } = require('../core/build.js');

const ARQ = path.join(__dirname, 'snapshot-html.json');
const ID = 'snapshot.teste.com.br';

function gerar() {
  const c = (id, extra) => ({ id, marca: 'Honda', modelo: 'Civic', versao: 'EXL 2.0', ano: 2021, preco: 99900, km: 30000, cor: 'Preto', cambio: 'Automático',
    combustivel: 'Flex', fotos: 2, opcionais: ['Teto solar'], descricao: 'Único dono.', loja: 'centro', ...extra });
  A.criarSite(ID, {
    carros: [c('S1', { ordem: 2, destaque: true, carroceria: 'Sedan' }), c('S2', { ordem: 1, modelo: 'City', loja: 'sul' }), c('S3', { fotos: 0 })],
    site: { tema: { logo: 'assets/logo.png' }, cabecalho: { menu: [{ rotulo: 'Estoque', link: 'multipla/' }] },
      estoque: { blocosAntes: [{ tipo: 'banner', titulo: 'Estoque' }] },
      paginas: [
        { caminho: '', titulo: 'Home', blocos: [{ tipo: 'banner', titulo: 'Oi', imagem: 'assets/logo.png' }, { tipo: 'vitrine', titulo: 'Destaques', quantidade: 2, botao: 'Ver' }, { tipo: 'lojas' }] },
        { caminho: 'sobre', titulo: 'Sobre', blocos: [{ tipo: 'texto', html: '<p>Texto</p>' }, { tipo: 'listagem', quantidade: 2 }] },
      ] },
  });
  A.silencioso(() => construir({ sites: [ID], hoje: '2026-01-01' }));
  // um carro sai e outro muda de link: cobre a página "indisponível" e o redirecionamento
  const est = JSON.parse(fs.readFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), 'utf8'));
  est.carros = est.carros.filter((x) => x.id !== 'S3');
  est.carros[0].versao = 'Touring 1.5';
  fs.writeFileSync(path.join(A.raiz(), 'sites', ID, 'estoque.json'), JSON.stringify(est));
  A.silencioso(() => construir({ sites: [ID], hoje: '2026-01-02' }));
  const dir = A.saida(ID);
  const arquivos = A.listar(dir).map((f) => path.relative(dir, f).split(path.sep).join('/'))
    .filter((f) => !f.startsWith('motor/') && !f.startsWith('css/')).sort(); // motor e css vêm prontos (não são gerados)
  const h = crypto.createHash('sha256');
  for (const f of arquivos) { h.update(f); h.update('\0'); h.update(fs.readFileSync(path.join(dir, f))); }
  return { versaoHtml: VERSAO_HTML, hash: h.digest('hex'), arquivos };
}

test('HTML gerado só muda junto com VERSAO_HTML', () => {
  const atual = gerar();
  if (process.env.SNAPSHOT_ATUALIZAR || !fs.existsSync(ARQ)) {
    fs.writeFileSync(ARQ, JSON.stringify(atual, null, 2) + '\n');
    return;
  }
  const salvo = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  if (salvo.versaoHtml === atual.versaoHtml) {
    assert.deepEqual(atual.arquivos, salvo.arquivos, 'mudou a lista de arquivos gerados: aumente VERSAO_HTML em core/build.js');
    assert.equal(atual.hash, salvo.hash,
      'O HTML/JSON gerado mudou, mas VERSAO_HTML continua igual. Se a mudança no build é de propósito, aumente VERSAO_HTML ' +
      'em core/build.js (isso refaz as páginas de todos os sites) e rode SNAPSHOT_ATUALIZAR=1 node --test tests/snapshot-html.test.js');
  } else {
    assert.notEqual(atual.hash, salvo.hash, `VERSAO_HTML mudou (${salvo.versaoHtml} → ${atual.versaoHtml}) mas a saída é a mesma: volte a versão (refazer tudo à toa custa caro)`);
    assert.fail(`VERSAO_HTML mudou (${salvo.versaoHtml} → ${atual.versaoHtml}): confira o HTML e rode SNAPSHOT_ATUALIZAR=1 node --test tests/snapshot-html.test.js`);
  }
});
