// Gera os estoques dos 3 sites de exemplo (sites/<dominio>/estoque.json).
// Em produção, cada estoque.json vem do Revenda Mais (um JSON por site), via node core/cli.js atualizar.
const fs = require('fs');
const path = require('path');

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);

// [marca, modelo, versões, preço mín (0 km), preço máx (0 km)]
const MODELOS = [
  ['Chevrolet', 'Onix', ['1.0 LT', '1.0 Turbo Premier', '1.0 LTZ'], 55000, 95000],
  ['Chevrolet', 'Tracker', ['1.2 Turbo LTZ', '1.0 Turbo Premier'], 90000, 150000],
  ['Volkswagen', 'Gol', ['1.0 MPI', '1.6 Highline'], 35000, 65000],
  ['Volkswagen', 'Polo', ['1.0 TSI', 'Highline 200 TSI'], 70000, 110000],
  ['Volkswagen', 'T-Cross', ['200 TSI', 'Highline 250 TSI'], 95000, 150000],
  ['Fiat', 'Mobi', ['Like 1.0'], 40000, 65000],
  ['Fiat', 'Argo', ['1.0 Drive', '1.3 Trekking'], 50000, 90000],
  ['Fiat', 'Toro', ['Freedom 1.3 Turbo', 'Volcano Diesel'], 110000, 190000],
  ['Honda', 'City', ['EX 1.5', 'Touring 1.5'], 85000, 130000],
  ['Honda', 'HR-V', ['EXL 1.8', 'Touring 1.5 Turbo'], 110000, 180000],
  ['Honda', 'Civic', ['EXL 2.0', 'Touring 1.5 Turbo'], 100000, 190000],
  ['Toyota', 'Yaris', ['XL Plus 1.3', 'XLS 1.5'], 70000, 110000],
  ['Toyota', 'Corolla', ['XEi 2.0', 'Altis Hybrid'], 110000, 200000],
  ['Toyota', 'Hilux', ['SRV 2.8 Diesel', 'SRX 4x4 Diesel'], 200000, 330000],
  ['Hyundai', 'HB20', ['1.0 Comfort', '1.0 Turbo Platinum'], 55000, 100000],
  ['Hyundai', 'Creta', ['Limited 1.0 Turbo', 'Ultimate 2.0'], 100000, 160000],
  ['Jeep', 'Renegade', ['Longitude 1.8', 'Sport T270'], 85000, 150000],
  ['Jeep', 'Compass', ['Limited Diesel', 'Longitude T270'], 130000, 230000],
  ['Renault', 'Kwid', ['Zen 1.0'], 38000, 60000],
  ['Renault', 'Duster', ['Iconic 1.6', 'Intense 1.3 Turbo'], 80000, 140000],
  ['Nissan', 'Kicks', ['SV 1.6', 'Exclusive CVT'], 85000, 135000],
  ['Ford', 'Ranger', ['XLT 3.2 Diesel', 'Limited V6 Diesel'], 180000, 300000],
  ['BMW', '320i', ['M Sport 2.0 Turbo'], 220000, 330000],
  ['Mercedes-Benz', 'C 180', ['Avantgarde 1.6 Turbo'], 230000, 340000],
  ['Audi', 'A3', ['Sedan Prestige Plus 1.4'], 150000, 230000],
];

// carroceria de cada modelo (campo opcional "carroceria" do estoque; vira filtro e atalho na home)
const CARROCERIA = {
  Onix: 'Hatch', Gol: 'Hatch', Polo: 'Hatch', Mobi: 'Hatch', Argo: 'Hatch', Yaris: 'Hatch', HB20: 'Hatch', Kwid: 'Hatch',
  City: 'Sedan', Civic: 'Sedan', Corolla: 'Sedan', '320i': 'Sedan', 'C 180': 'Sedan', A3: 'Sedan',
  Tracker: 'SUV', 'T-Cross': 'SUV', 'HR-V': 'SUV', Creta: 'SUV', Renegade: 'SUV', Compass: 'SUV', Duster: 'SUV', Kicks: 'SUV', Q3: 'SUV', XC60: 'SUV', 'XC40 Recharge': 'SUV',
  Toro: 'Utilitário', Hilux: 'Utilitário', Ranger: 'Utilitário',
};
// lojas especializadas (Servopa): premium e motos
const PREMIUM_MODELOS = [
  ['Audi', 'A3', ['Sedan Prestige Plus 1.4', 'Sedan Performance 2.0'], 150000, 260000],
  ['Audi', 'Q3', ['Prestige Plus 1.4 TFSI', 'Black 2.0 TFSI'], 180000, 290000],
  ['Volvo', 'XC60', ['T8 Recharge Inscription', 'B5 Momentum'], 260000, 420000],
  ['Volvo', 'XC40 Recharge', ['Plus Elétrico', 'Ultimate Elétrico'], 220000, 330000],
  ['BMW', '320i', ['M Sport 2.0 Turbo'], 220000, 330000],
];
const MOTOS = [
  ['Harley-Davidson', 'Street Glide', ['Special 114'], 90000, 160000],
  ['Harley-Davidson', 'Fat Boy', ['114'], 80000, 140000],
  ['Triumph', 'Tiger 900', ['Rally Pro', 'GT Pro'], 60000, 95000],
  ['Triumph', 'Street Triple', ['RS 765'], 55000, 85000],
];

const CORES = ['Branco', 'Preto', 'Prata', 'Cinza', 'Vermelho', 'Azul'];
const PREMIUM = ['BMW', 'Mercedes-Benz', 'Audi'];
const OPCIONAIS = [
  'Ar-condicionado', 'Direção elétrica', 'Vidros elétricos', 'Central multimídia',
  'Câmera de ré', 'Sensor de estacionamento', 'Bancos de couro', 'Teto solar',
  'Piloto automático', 'Faróis de LED', 'Rodas de liga leve', 'Airbag duplo',
  'Freios ABS', 'Controle de estabilidade',
];
const NOTAS = ['Único dono.', 'Revisões na concessionária.', 'Laudo cautelar aprovado.', 'IPVA 2026 pago.', 'Chave reserva e manual.'];
const ANO_ATUAL = 2026;

function gerarCarro(prefixo, n, modelos) {
  const [marca, modelo, versoes, pmin, pmax] = pick(modelos);
  const versao = pick(versoes);
  const ano = Math.round(between(2013, ANO_ATUAL));
  const idade = ANO_ATUAL - ano;
  const preco = Math.max(18000, Math.round((between(pmin, pmax) * (1 - idade * 0.045)) / 500) * 500);
  const km = Math.min(170000, Math.round(((idade + 0.5) * between(6000, 16000)) / 100) * 100);
  const premium = PREMIUM.includes(marca);
  const moto = MOTOS.some((m) => m[0] === marca);
  const combustivel = /Diesel/.test(versao) ? 'Diesel' : /Hybrid|T8/.test(versao) ? 'Híbrido' : /Elétrico/.test(versao) ? 'Elétrico' : premium || moto || ['Audi', 'Volvo'].includes(marca) ? 'Gasolina' : 'Flex';
  const automatico =
    premium || /CVT|Hybrid|Diesel|Touring|Premier|T270/.test(versao) || (preco > 90000 && rnd() > 0.3) || rnd() > 0.6;
  return {
    id: `${prefixo}${String(n).padStart(4, '0')}`,
    marca, modelo, versao, ano, preco, km,
    cor: pick(CORES),
    cambio: automatico ? 'Automático' : 'Manual',
    combustivel,
    carroceria: moto ? 'Moto' : CARROCERIA[modelo] || 'Hatch',
    fotos: 4 + Math.floor(rnd() * 7),
    opcionais: OPCIONAIS.filter(() => rnd() > 0.5),
    descricao: `${marca} ${modelo} ${versao} ${ano}, ${km.toLocaleString('pt-BR')} km. ${pick(NOTAS)} ${pick(NOTAS)}`,
  };
}

// Um estoque.json por site de exemplo (sites/<dominio>/estoque.json). Cada carro diz a sua loja (ids de site.json → "lojas").
// Os sites e as lojas já existem em sites/<dominio>/site.json; aqui só se geram os carros.
const caros = MODELOS.filter((m) => m[3] >= 90000);
const SITES = [
  { dominio: 'autocentral.exemplo.com.br', lojas: [
    { loja: 'sp-centro', prefixo: 'SM', total: 300, modelos: MODELOS },
    { loja: 'sp-centro', prefixo: 'SP', total: 150, modelos: caros },
    { loja: 'campinas', prefixo: 'CP', total: 200, modelos: MODELOS.filter((m) => m[4] <= 190000) },
    { loja: 'bh', prefixo: 'BH', total: 200, modelos: MODELOS.filter((m) => m[4] <= 230000) },
    { loja: 'rio', prefixo: 'RJ', total: 150, modelos: MODELOS },
  ] },
  { dominio: 'outletdocarro.exemplo.com.br', lojas: [ // site.json limita a R$ 50 mil (restricoes.precoMax)
    { loja: 'campinas', prefixo: 'OC', total: 120, modelos: MODELOS.filter((m) => m[3] <= 70000) },
    { loja: 'sp-centro', prefixo: 'OS', total: 80, modelos: MODELOS.filter((m) => m[3] <= 70000) },
  ] },
  { dominio: 'gruposervopaseminovos.com.br', ordem: true, lojas: [ // 23 lojas, ~1050 carros, com "ordem" e "destaque"
    ...['servopa-curitiba-marechal', 'servopa-curitiba-pinheirinho', 'servopa-curitiba-rockefeller', 'servopa-maringa', 'servopa-paranagua',
      'servopa-ponta-grossa-oficinas', 'grupo-servopa-seminovos-canoas', 'grupo-servopa-seminovos-gravatai', 'grupo-servopa-seminovos-novo-hamburgo',
      'grupo-servopa-seminovos-londrina', 'grupo-servopa-seminovos-umuarama', 'grupo-servopa-seminovos-ipiranga']
      .map((loja, i) => ({ loja, prefixo: `G${String.fromCharCode(65 + i)}`, total: 60, modelos: MODELOS })),
    { loja: 'honda-servopa-curitiba', prefixo: 'HC', total: 50, modelos: MODELOS.filter((m) => m[0] === 'Honda') },
    { loja: 'honda-servopa-sao-jose-dos-pinhais', prefixo: 'HS', total: 40, modelos: MODELOS.filter((m) => m[0] === 'Honda') },
    { loja: 'audi-center-cascavel', prefixo: 'AC', total: 25, modelos: PREMIUM_MODELOS.filter((m) => m[0] === 'Audi') },
    { loja: 'audi-center-maringa', prefixo: 'AM', total: 25, modelos: PREMIUM_MODELOS.filter((m) => m[0] === 'Audi') },
    { loja: 'audi-curitiba', prefixo: 'AU', total: 30, modelos: PREMIUM_MODELOS },
    { loja: 'volvo-cascavel', prefixo: 'VC', total: 20, modelos: PREMIUM_MODELOS.filter((m) => m[0] === 'Volvo') },
    { loja: 'volvo-servopa', prefixo: 'VS', total: 30, modelos: PREMIUM_MODELOS.filter((m) => m[0] === 'Volvo') },
    { loja: 'red-wheel-harley-davidson', prefixo: 'RW', total: 25, modelos: MOTOS.filter((m) => m[0] === 'Harley-Davidson') },
    { loja: 'the-one-harley-davidson', prefixo: 'TO', total: 25, modelos: MOTOS.filter((m) => m[0] === 'Harley-Davidson') },
    { loja: 'triumph-cwb', prefixo: 'TC', total: 32, modelos: MOTOS.filter((m) => m[0] === 'Triumph') },
    { loja: 'triumph-north', prefixo: 'TN', total: 30, modelos: MOTOS.filter((m) => m[0] === 'Triumph') },
  ] },
  { dominio: 'primeseminovos.exemplo.com.br', lojas: [ // site.json exige R$ 90 mil ou mais (restricoes.precoMin)
    { loja: 'sp-centro', prefixo: 'PS', total: 250, modelos: caros },
    { loja: 'rio', prefixo: 'PR', total: 150, modelos: caros },
  ] },
];

const raiz = path.join(__dirname, '..', 'sites');
let soma = 0;
for (const s of SITES) {
  const dir = path.join(raiz, s.dominio);
  if (!fs.existsSync(path.join(dir, 'site.json'))) { console.log(`pulei ${s.dominio}: sites/${s.dominio}/site.json não existe`); continue; }
  let carros = s.lojas.flatMap((l) => Array.from({ length: l.total }, (_, i) => ({ ...gerarCarro(l.prefixo, i + 1, l.modelos), loja: l.loja })));
  if (s.ordem) {
    // como viria do Revenda Mais: metade marcada como destaque, e "ordem" = posição de exibição (destaques primeiro, misturando as lojas)
    carros.forEach((c) => { c.destaque = rnd() < 0.5; c._sorteio = rnd(); });
    carros.sort((a, b) => (b.destaque - a.destaque) || a._sorteio - b._sorteio);
    carros = carros.map(({ _sorteio, ...c }, i) => ({ ...c, ordem: i + 1 }));
    // o arquivo vem embaralhado de propósito: quem manda na exibição é o campo "ordem"
    carros.sort((a, b) => a.id.localeCompare(b.id));
  }
  fs.writeFileSync(path.join(dir, 'estoque.json'), JSON.stringify({ atualizado: new Date().toISOString(), carros }));
  soma += carros.length;
  console.log(`sites/${s.dominio}/estoque.json: ${carros.length} carros`);
}
console.log(`Total: ${soma} carros`);
