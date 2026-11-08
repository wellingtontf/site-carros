// Motor (core/motor/<versao>/engine.js): busca, busca aproximada, filtros em cascata, link da busca, ordem e WhatsApp.
// Roda em TODAS as versões (as congeladas não podem regredir) e garante que as congeladas não foram editadas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'core', 'motor');
const versoes = fs.readdirSync(DIR).filter((v) => fs.existsSync(path.join(DIR, v, 'engine.js'))).sort();
const congeladas = versoes.filter((v) => v !== 'rascunho');
const numero = (v) => (v === 'rascunho' ? Infinity : Number(v.replace(/^v/, '')));

function carregar(v) {
  const m = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(DIR, v, 'engine.js'), 'utf8').replace(/__VERSAO__/g, v))(m, m.exports);
  return m.exports;
}
// estoque.json usa chaves curtas
const C = (i, m, o, v, a, p, k, extra = {}) => ({ i, m, o, v, a, p, k, c: 'Prata', b: 'Automático', f: 'Flex', n: 1, u: 'Loja Centro', cd: 'Curitiba', uf: 'PR', ...extra });
const DADOS = [
  C('a', 'Honda', 'Civic', 'EXL 2.0', 2020, 100000, 50000),
  C('b', 'Honda', 'City', 'Touring 1.5', 2022, 110000, 20000, { u: 'Loja Sul', cd: 'Porto Alegre', uf: 'RS', c: 'Preto' }),
  C('c', 'Toyota', 'Corolla', 'XEi 2.0', 2018, 90000, 80000, { b: 'Manual' }),
  C('d', 'Chevrolet', 'Onix', 'LT 1.0', 2024, 70000, 5000, { u: 'Loja Norte', cd: 'Londrina', uf: 'PR' }),
  C('e', 'Volkswagen', 'T-Cross', 'Highline 250 TSI', 2023, 150000, 15000, { cd: 'São José dos Pinhais' }),
];
const criar = (M, cfg = {}, dados = DADOS) => M.criar({ dados: 'd', config: 'c', carregar: async (u) => (u === 'd' ? dados : cfg) });
const ids = (mo) => mo.resultado().map((c) => c.id).sort().join('');

test('versões congeladas não foram editadas (sha256 em versao.json)', () => {
  assert.ok(congeladas.length >= 1);
  for (const v of congeladas) {
    const info = JSON.parse(fs.readFileSync(path.join(DIR, v, 'versao.json'), 'utf8'));
    assert.ok(info.sha256, `${v}/versao.json sem sha256`);
    const atual = crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, v, 'engine.js'))).digest('hex');
    assert.equal(atual, info.sha256, `core/motor/${v}/engine.js FOI EDITADO. Versão congelada é imutável: mexa só no rascunho e congele uma nova.`);
  }
});

for (const v of versoes) {
  const M = carregar(v);

  test(`[${v}] busca: acento, maiúscula, pedaço de palavra, várias palavras (todas obrigatórias)`, async () => {
    const mo = await criar(M);
    assert.equal(mo.total, 5);
    mo.buscar('HONDA'); assert.equal(ids(mo), 'ab');
    mo.buscar('civ'); assert.equal(ids(mo), 'a');
    mo.buscar('honda preto'); assert.equal(ids(mo), 'b');
    mo.buscar('sao jose'); assert.equal(ids(mo), 'e');
    mo.buscar('honda corolla'); assert.equal(ids(mo), '');
    mo.buscar('  '); assert.equal(ids(mo), 'abcde');
  });

  test(`[${v}] busca aproximada: 1 erro (4+ letras), 2 erros (7+), números e palavras curtas exatas`, async () => {
    const mo = await criar(M);
    mo.buscar('civc'); assert.equal(ids(mo), 'a'); assert.match(mo.dica(), /civic/);
    mo.buscar('chevrlet'); assert.equal(ids(mo), 'd');
    mo.buscar('chvrolett'); assert.equal(ids(mo), 'd', '2 erros em palavra de 7+ letras');
    mo.buscar('crola'); assert.equal(ids(mo), '', '2 erros em palavra de 5 letras não aproxima');
    mo.buscar('2021'); assert.equal(ids(mo), '', 'número nunca é aproximado');
    mo.buscar('lx'); assert.equal(ids(mo), '', 'palavra curta nunca é aproximada');
    mo.buscar('civic'); assert.equal(mo.dica(), '', 'achou exato: sem dica');
  });

  test(`[${v}] busca desligada (busca: false) ignora o texto`, async () => {
    const mo = await criar(M, { busca: false });
    mo.buscar('honda');
    assert.equal(ids(mo), 'abcde');
  });

  test(`[${v}] filtros: lista, mínimo (ano), máximo (preço/km)`, async () => {
    // v3+: o ano é exato por padrão; "a partir de" continua com { campo: 'ano', tipo: 'minimo' }
    const mo = await criar(M, numero(v) >= 3 ? { filtros: ['marca', { campo: 'ano', tipo: 'minimo' }, 'preco', 'km'] } : {});
    mo.definir('marca', 'Honda'); assert.equal(ids(mo), 'ab');
    mo.limpar();
    mo.definir('ano', '2022'); assert.equal(ids(mo), 'bde');
    mo.definir('preco', '100000'); assert.equal(ids(mo), 'd');
    mo.limpar();
    mo.definir('km', '20000'); assert.equal(ids(mo), 'bde');
  });

  test(`[${v}] cascata: estado → cidade → loja; marca → modelo; trocar o pai limpa o filho que não existe mais`, async () => {
    const mo = await criar(M);
    const f = (c) => mo.filtros.find((x) => x.campo === c);
    assert.equal(f('cidade').opcoes().length, 4);
    mo.definir('estado', 'RS');
    assert.deepEqual(f('cidade').opcoes().map((o) => o.valor), ['Porto Alegre']);
    mo.limpar();
    mo.definir('cidade', 'Londrina');
    mo.definir('estado', 'RS');
    assert.equal(mo.estado().valores.cidade, '', 'cidade de outro estado foi limpa');
    mo.limpar();
    mo.definir('marca', 'Honda');
    assert.deepEqual(f('modelo').opcoes().map((o) => o.valor), ['City', 'Civic']);
  });

  test(`[${v}] link da busca: ida e volta reproduz o mesmo resultado; valores inválidos são ignorados`, async () => {
    const mo = await criar(M);
    mo.buscar('honda'); mo.definir('estado', 'PR'); mo.ordenar('menor');
    const q = mo.query();
    const outro = await criar(M);
    outro.aplicarQuery(q);
    assert.equal(ids(outro), ids(mo));
    assert.equal(outro.estado().ord, 'menor');
    outro.aplicarQuery('marca=Ferrari&preco=123&ord=hackeado&estado=<script>');
    if (numero(v) >= 3) {
      // v3+: valor de lista que veio do link fica (sem carro → "nenhum carro"); preço fora da lista e ordem inválida saem
      assert.equal(ids(outro), '');
      assert.deepEqual(outro.estado().valores, { ...outro.estado().valores, marca: 'Ferrari', estado: '<script>', preco: '' });
      assert.equal(outro.estado().ord, outro.ordens[0].chave);
    } else {
      assert.equal(ids(outro), 'abcde');
      assert.deepEqual(Object.values(outro.estado().valores).filter(Boolean), []);
    }
  });

  test(`[${v}] filtros configurados pelo site: ordem, rótulo, opções; lista com 1 valor some (sempre: true mantém)`, async () => {
    const mo = await criar(M, { filtros: [{ campo: 'preco', rotulo: 'Até', opcoes: [80000] }, 'marca', 'cor', { campo: 'combustivel', sempre: true }] });
    assert.deepEqual(mo.filtros.map((x) => x.campo), ['preco', 'marca', 'cor', 'combustivel']);
    assert.equal(mo.filtros[0].rotulo, 'Até');
    const sem = await criar(M, { filtros: ['marca', 'combustivel'] });
    assert.deepEqual(sem.filtros.map((x) => x.campo), ['marca'], 'combustível só tem "Flex": filtro some');
  });

  test(`[${v}] ordenação: menor e maior preço, km`, async () => {
    const mo = await criar(M);
    mo.ordenar('menor'); assert.equal(mo.resultado()[0].id, 'd');
    mo.ordenar('maior'); assert.equal(mo.resultado()[0].id, 'e');
    mo.ordenar('km'); assert.equal(mo.resultado()[0].id, 'd');
    mo.ordenar('nao-existe'); assert.equal(mo.estado().ord, 'km', 'ordem desconhecida é ignorada');
  });

  test(`[${v}] WhatsApp: vendedor (?v=) > loja > site; texto codificado`, () => {
    const cfg = { whatsapp: '5500', lojas: { centro: { whatsapp: '5511' }, sul: {} }, vendedores: { ana: '5599' } };
    const guarda = { location: globalThis.location, localStorage: globalThis.localStorage };
    const mem = {};
    globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, x) => { mem[k] = x; } };
    try {
      globalThis.location = { search: '' };
      assert.equal(M.whatsapp(cfg, 'Olá & tchau', 'centro'), 'https://wa.me/5511?text=Ol%C3%A1%20%26%20tchau');
      assert.match(M.whatsapp(cfg, 'x', 'sul'), /wa\.me\/5500\?/);
      globalThis.location = { search: '?v=ana' };
      assert.match(M.whatsapp(cfg, 'x', 'centro'), /wa\.me\/5599\?/);
      globalThis.location = { search: '' };
      assert.match(M.whatsapp(cfg, 'x', 'centro'), /wa\.me\/5599\?/, 'vendedor fica lembrado entre páginas');
      globalThis.location = { search: '?v=desconhecido' };
      assert.match(M.whatsapp(cfg, 'x', 'centro'), /wa\.me\/5511\?/, 'vendedor que não existe cai na loja');
    } finally { Object.assign(globalThis, guarda); }
  });

  test(`[${v}] dados estranhos não quebram: estoque vazio, campos faltando`, async () => {
    const vazio = await criar(M, {}, []);
    assert.equal(vazio.total, 0);
    vazio.buscar('qualquer');
    assert.deepEqual(vazio.resultado(), []);
    const torto = await criar(M, {}, [{ i: 'x', m: 'Fiat' }]);
    torto.buscar('fiat');
    assert.equal(torto.resultado().length, 1);
  });

  if (numero(v) >= 3) {
    test(`[${v}] vários valores por filtro (OU) e ano exato, do mais novo ao mais velho (como veic-anomodelo/2022|2024)`, async () => {
      const mo = await criar(M);
      const f = (c) => mo.filtros.find((x) => x.campo === c);
      assert.deepEqual(f('ano').opcoes().map((o) => o.valor), ['2024', '2023', '2022', '2020', '2018']);
      mo.aplicarQuery('ano=2022|2024|1999');
      assert.equal(ids(mo), 'bd');
      assert.equal(f('ano').valor(), '2022|2024|1999', 'valor do link fica como veio');
      mo.aplicarQuery('marca=Honda&ano=1999');
      assert.equal(ids(mo), '', 'valor sem carro no estoque: nenhum carro (não esconde o filtro)');
      mo.definir('marca', 'Toyota');
      assert.equal(ids(mo), '', 'mexer em outro filtro mantém o do link');
      mo.definir('ano', '2018');
      assert.equal(ids(mo), 'c');
      mo.definir('ano', '1999');
      assert.equal(f('ano').valor(), '', 'pela tela (definir) só vale o que existe');
      mo.aplicarQuery('marca=Honda|Toyota&estado=PR');
      assert.equal(ids(mo), 'ac');
      mo.aplicarQuery('estado=PR|RS&cidade=Curitiba|Porto Alegre|Londrina');
      assert.equal(ids(mo), 'abcd');
      mo.aplicarQuery('estado=RS&cidade=Curitiba|Porto Alegre');
      assert.equal(ids(mo), 'b', 'cidade de outro estado não dá resultado (cascata)');
      mo.definir('estado', 'PR');
      assert.equal(f('cidade').valor(), 'Curitiba', 'trocar o pai pela tela limpa o filho que não existe mais');
    });
  }

  if (numero(v) >= 2) {
    test(`[${v}] ordem "destaque" (padrão): a ordem do estoque (campo r ou posição)`, async () => {
      const dados = [C('x', 'A', 'A', 'A', 2020, 1, 1, { r: 2 }), C('y', 'B', 'B', 'B', 2020, 1, 1, { r: 0 }), C('z', 'C', 'C', 'C', 2020, 1, 1, { r: 1 })];
      const mo = await criar(M, {}, dados);
      assert.equal(mo.ordens[0].chave, 'destaque');
      assert.deepEqual(mo.resultado().map((c) => c.id), ['y', 'z', 'x']);
      const semR = await criar(M, {}, dados.map(({ r, ...d }) => d));
      assert.deepEqual(semR.resultado().map((c) => c.id), ['x', 'y', 'z'], 'sem r: posição no arquivo');
    });

    test(`[${v}] filtro carroceria; valor vazio não vira opção`, async () => {
      const dados = [C('x', 'A', 'A', 'A', 2020, 1, 1, { cr: 'SUV' }), C('y', 'B', 'B', 'B', 2020, 1, 1, { cr: 'Hatch' }), C('z', 'C', 'C', 'C', 2020, 1, 1)];
      const mo = await criar(M, { filtros: ['carroceria'] }, dados);
      const f = mo.filtros.find((x) => x.campo === 'carroceria');
      assert.deepEqual(f.opcoes().map((o) => o.valor), ['Hatch', 'SUV']);
      mo.definir('carroceria', 'SUV');
      assert.deepEqual(mo.resultado().map((c) => c.id), ['x']);
      const so1 = await criar(M, { filtros: ['carroceria'] }, [dados[0], dados[2]]);
      assert.equal(so1.filtros.length, 0, 'SUV + vazio = 1 valor de verdade: filtro some');
    });
  }
}
