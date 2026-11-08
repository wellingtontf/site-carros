// Regra do link da página do carro (core/ui/link-carro.js): a mesma no build, no navegador e nos testes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../core/ui/link-carro.js');

test('reproduz exatamente o formato do Revenda Mais (exemplo real)', () => {
  assert.equal(
    L.caminho({ marca: 'Toyota', modelo: 'Corolla', versao: 'Cross XRE 2.0 Flex Aut.', ano: 2024, cidade: 'Curitiba', uf: 'PR', id: '8643966' }),
    'carros/Toyota/Corolla/Cross-Xre-20-Flex-Aut/Toyota-Corolla-Cross-Xre-20-Flex-Aut-2024-Curitiba-Parana-8643966.html');
});

test('tira acento, pontuação e espaços repetidos; palavras com inicial maiúscula', () => {
  assert.equal(L.parte('  São   José dos Pinhais '), 'Sao-Jose-Dos-Pinhais');
  assert.equal(L.parte('T-Cross 200 TSI'), 'T-Cross-200-Tsi');
  assert.equal(L.parte('C 180 Avantgarde 1.6 (Turbo)!'), 'C-180-Avantgarde-16-Turbo');
  assert.equal(L.parte('GOIÂNIA'), 'Goiania');
});

test('campo vazio não gera pasta vazia (//) no link', () => {
  const c = L.caminho({ marca: 'Fiat', modelo: '...', versao: '', ano: 2020, cidade: 'X', uf: 'SP', id: 'A1' });
  assert.ok(!c.includes('//'), c);
  assert.match(c, /\/Nd\//);
});

test('todos os 27 estados por extenso, sem acento', () => {
  const ufs = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  for (const uf of ufs) assert.match(L.estado(uf), /^[A-Za-z ]+$/, uf);
  assert.equal(L.parte(L.estado('SP')), 'Sao-Paulo');
  assert.equal(L.estado('pr'), 'Parana');
});

test('id com caractere fora do padrão não quebra o nome do arquivo', () => {
  const c = L.caminho({ marca: 'A', modelo: 'B', versao: 'C', ano: 2020, cidade: 'D', uf: 'SP', id: 'AB/12 3' });
  assert.ok(c.endsWith('-AB-12-3.html'), c);
  assert.equal(c.split('/').length, 5);
});

test('carros diferentes nunca colidem no mesmo link (id no nome)', () => {
  const base = { marca: 'VW', modelo: 'Gol', versao: '1.0', ano: 2020, cidade: 'X', uf: 'PR' };
  assert.notEqual(L.caminho({ ...base, id: '1' }), L.caminho({ ...base, id: '2' }));
});
