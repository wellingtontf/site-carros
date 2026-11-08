// Validação do estoque (core/atualizar.js): qualquer erro → nada é gravado.
const { prepararRaiz, carro } = require('./ajuda');
prepararRaiz();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarEstoque } = require('../core/atualizar.js');

const ok = (carros, lojas = ['centro']) => assert.deepEqual(validarEstoque({ carros }, lojas), []);
const erro = (carros, regex, lojas = ['centro']) => {
  const e = validarEstoque({ carros }, lojas);
  assert.ok(e.some((m) => regex.test(m)), `esperava ${regex}, veio: ${JSON.stringify(e)}`);
};

test('estoque válido passa (com e sem campos opcionais)', () => {
  ok([carro(), carro({ ordem: 0, destaque: true, carroceria: 'SUV' }), carro({ fotos: 0, opcionais: [] })]);
  ok([]);
});
test('formato errado', () => {
  assert.match(validarEstoque(null)[0], /carros/);
  assert.match(validarEstoque({ itens: [] })[0], /carros/);
  erro(['texto'], /não é um objeto/);
});
test('ids: obrigatório, formato e repetido', () => {
  erro([carro({ id: '' })], /id inválido/);
  erro([carro({ id: 'a b' })], /id inválido/);
  erro([carro({ id: '../x' })], /id inválido/);
  erro([carro({ id: 'X1' }), carro({ id: 'X1' })], /id repetido/);
});
test('textos obrigatórios', () => {
  for (const k of ['marca', 'modelo', 'versao', 'cor', 'cambio', 'combustivel']) {
    erro([carro({ [k]: '' })], new RegExp(`"${k}"`));
    erro([carro({ [k]: '   ' })], new RegExp(`"${k}"`));
    erro([carro({ [k]: undefined })], new RegExp(`"${k}"`));
  }
});
test('números: ano, preço, km, fotos', () => {
  const anoMax = new Date().getFullYear() + 2;
  erro([carro({ ano: 1949 })], /ano/); erro([carro({ ano: anoMax + 1 })], /ano/); erro([carro({ ano: '2020' })], /ano/); erro([carro({ ano: 2020.5 })], /ano/);
  ok([carro({ ano: anoMax })]);
  erro([carro({ preco: 0 })], /preco/); erro([carro({ preco: -1 })], /preco/); erro([carro({ preco: '50000' })], /preco/); erro([carro({ preco: NaN })], /preco/);
  erro([carro({ km: -1 })], /km/); erro([carro({ km: '0' })], /km/);
  erro([carro({ fotos: 61 })], /fotos/); erro([carro({ fotos: -1 })], /fotos/); erro([carro({ fotos: 1.5 })], /fotos/);
});
test('loja: obrigatória se o site tem mais de uma; precisa existir', () => {
  ok([carro({ loja: undefined })], ['centro']); // site com 1 loja: pode omitir
  erro([carro({ loja: undefined })], /"loja" ausente/, ['centro', 'sul']);
  ok([carro({ loja: 'sul' })], ['centro', 'sul']);
  erro([carro({ loja: 'norte' })], /não existe/, ['centro', 'sul']);
});
test('opcionais novos: ordem, destaque, carroceria, opcionais', () => {
  erro([carro({ ordem: -1 })], /ordem/); erro([carro({ ordem: 1.5 })], /ordem/); erro([carro({ ordem: '1' })], /ordem/);
  erro([carro({ destaque: 'sim' })], /destaque/);
  erro([carro({ carroceria: 3 })], /carroceria/);
  erro([carro({ opcionais: 'ar' })], /opcionais/);
});
test('limita a 30 mensagens (estoque gigante todo errado não estoura a memória/log)', () => {
  const e = validarEstoque({ carros: Array.from({ length: 500 }, () => carro({ marca: '' })) }, ['centro']);
  assert.equal(e.length, 30);
});
