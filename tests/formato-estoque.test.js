// estoque.json compacto ("formatoEstoque": "compacto" no site.json): menor, e o motor recebe EXATAMENTE os mesmos dados.
const A = require('./ajuda');
A.prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { construir } = require('../core/build.js');
const F = require('../core/ui/formato-estoque.js');
const Sites = require('../core/sites.js');

const marcas = [['Toyota', 'Corolla'], ['Honda', 'Civic'], ['Fiat', 'Argo'], ['Volkswagen', 'Polo']];
const carros = Array.from({ length: 40 }, (_, n) => A.carro({
  id: `F${n}`, marca: marcas[n % 4][0], modelo: marcas[n % 4][1], ano: 2015 + (n % 8), preco: 50000 + n * 1700, km: n * 3100,
  ...(n % 3 === 0 ? { carroceria: 'Sedã' } : {}), ...(n % 5 === 0 ? { link: `/carros/antigo-${n}.html` } : {}),
}));

test('compactar/descompactar devolve a mesma lista (chaves, ordem, campos opcionais)', () => {
  const lista = [{ i: 'A', m: 'Fiat', a: 2020, r: 0 }, { i: 'B', m: 'Fiat', a: 2021, r: 1, cr: 'Hatch', l: '/x.html' }, { i: 'C', m: 'Kia', a: 2019, r: 2 }];
  assert.equal(JSON.stringify(F.descompactar(F.compactar(lista))), JSON.stringify(lista));
  assert.deepEqual(F.descompactar(lista), lista, 'lista no formato de sempre passa direto');
  assert.throws(() => F.descompactar({ formato: 'outro' }), /formato desconhecido/);
});

test('site compacto: estoque.json menor e o motor dá os mesmos resultados do formato de sempre', async () => {
  A.criarSite('lista.teste.com.br', { carros });
  A.criarSite('compacto.teste.com.br', { carros, site: { formatoEstoque: 'compacto' } });
  A.silencioso(() => construir({ sites: ['lista.teste.com.br', 'compacto.teste.com.br'] }));
  const arq = (id) => path.join(A.saida(id), 'estoque.json');
  const bruto = JSON.parse(fs.readFileSync(arq('compacto.teste.com.br'), 'utf8'));
  assert.equal(bruto.formato, F.FORMATO);
  assert.ok(fs.statSync(arq('compacto.teste.com.br')).size < fs.statSync(arq('lista.teste.com.br')).size / 2, 'compacto deveria ter menos da metade');
  assert.ok(A.existe('compacto.teste.com.br', 'motor/formato-estoque.js'), 'o navegador precisa do decodificador');
  assert.deepEqual(F.descompactar(bruto), A.lerJSON('lista.teste.com.br', 'estoque.json'));

  const [m1, m2] = await Promise.all(['lista.teste.com.br', 'compacto.teste.com.br'].map((id) => A.carregarMotor(A.saida(id)).criar()));
  for (const q of ['', 'marca=Toyota', 'q=corola', 'marca=Honda&ord=menor', 'ord=maior', 'anoMin=2018&q=polo']) {
    m1.aplicarQuery(q); m2.aplicarQuery(q);
    assert.deepEqual(m2.resultado().map((c) => c.id), m1.resultado().map((c) => c.id), `busca "${q}"`);
  }
  assert.ok(m2.resultado().length > 0);
});

test('formatoEstoque inválido é recusado no cadastro', () => {
  const s = { ...A.lerSite('compacto.teste.com.br'), formatoEstoque: 'zip' };
  assert.ok(Sites.validarSite(s, 'compacto.teste.com.br').some((e) => /formatoEstoque/.test(e)));
  assert.deepEqual(Sites.avisosSite({ formatoEstoque: 'compacto' }), []);
});
