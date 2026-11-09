// Fotos por URL (core/fotos.js): baixa, converte, renumera as que deram certo, não refaz o que não mudou, recusa rede
// interna (SSRF), e o build só conta foto pronta. Também o caminho completo pela API (PUT carro → fotos → build).
const A = require('./ajuda');
A.prepararRaiz();
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const F = require('../core/fotos.js');
const { construir } = require('../core/build.js');
const { validarEstoque } = require('../core/atualizar.js');

const ID = 'fotos.teste.com.br';
// PNG de verdade (4x3, vermelho), feito na mão para não depender de arquivo
function png(w = 4, h = 3) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo); const l = Buffer.alloc(4); l.writeUInt32BE(dados.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([l, t, dados, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([255, 0, 0]))])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}
let img, base, pedidosImg = 0;
before(async () => {
  img = http.createServer((req, res) => {
    pedidosImg++;
    if (req.url.startsWith('/ok')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png()); }
    if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>'); }
    if (req.url === '/redir-interno') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => img.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${img.address().port}`;
});
after(() => img.close());

// conversor de mentira: copia a entrada para os 3 tamanhos (o teste do conversor real fica à parte)
const FALSO = `sh -c 'for w in 400 800 1600; do cp "$1" "$2-$w.webp"; done' _ {entrada} {saida}`;
const config = (extra = {}) => fs.writeFileSync(path.join(A.raiz(), 'config', 'fotos.json'), JSON.stringify({ pasta: 'fotos-teste', converter: FALSO, permitirRedeLocal: true, ...extra }));
const dirCarro = (id) => path.join(A.raiz(), 'fotos-teste', 'carros', id);
const silencioso = { log: () => {} };
beforeEach(() => { A.limpar(); fs.rmSync(path.join(A.raiz(), 'fotos-teste'), { recursive: true, force: true }); config(); });

test('validação: lista de URLs vale; protocolo estranho, espaço e mais de 60 não', () => {
  const lojas = Object.keys(A.LOJAS);
  assert.deepEqual(validarEstoque({ carros: [A.carro({ fotos: ['https://a.com/1.jpg', 'http://b.com/2.png'] })] }, lojas), []);
  assert.equal(validarEstoque({ carros: [A.carro({ fotos: ['ftp://a.com/1.jpg'] })] }, lojas).length, 1);
  assert.equal(validarEstoque({ carros: [A.carro({ fotos: ['https://a.com/um arquivo.jpg'] })] }, lojas).length, 1);
  assert.equal(validarEstoque({ carros: [A.carro({ fotos: Array(61).fill('https://a.com/x.jpg') })] }, lojas).length, 1);
});

test('baixa, converte e renumera só as que deram certo; o build passa a contar as fotos prontas', async () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`, `${base}/sumiu`, `${base}/ok2`, `${base}/html`] })] });
  A.silencioso(() => construir({ sites: [ID] }));
  assert.equal(A.lerJSON(ID, 'estoque.json')[0].n, 0, 'antes de processar: sem foto (nada de imagem quebrada)');
  const r = await F.processarSite(ID, silencioso);
  assert.deepEqual(r.processados, ['C1']);
  assert.deepEqual(fs.readdirSync(dirCarro('C1')).sort(), ['1-1600.webp', '1-400.webp', '1-800.webp', '2-1600.webp', '2-400.webp', '2-800.webp']);
  const res = F.resumo(ID);
  assert.equal(res.pendentes, 0);
  assert.equal(res.comErro[0].erros.length, 2, JSON.stringify(res)); // 404 e "não é imagem"
  A.silencioso(() => construir({ sites: [ID] }));
  assert.equal(A.lerJSON(ID, 'estoque.json')[0].n, 2);
});

test('mesmas URLs: não baixa de novo; lista menor: as fotos que sobraram somem', async () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`, `${base}/ok2`, `${base}/ok3`] })] });
  await F.processarSite(ID, silencioso);
  const antes = pedidosImg;
  assert.deepEqual((await F.processarSite(ID, silencioso)).processados, []);
  assert.equal(pedidosImg, antes, 'nada baixado de novo');
  A.gravarEstoque(ID, [A.carro({ id: 'C1', fotos: [`${base}/ok9`] })]);
  await F.processarSite(ID, silencioso);
  assert.deepEqual(fs.readdirSync(dirCarro('C1')).filter((f) => f.startsWith('3-')), [], 'foto 3 antiga não pode continuar no ar');
});

test('carro com a quantidade (formato antigo) continua igual e não é tocado', async () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: 5 })] });
  assert.deepEqual(F.pendentes(ID), []);
  A.silencioso(() => construir({ sites: [ID] }));
  assert.equal(A.lerJSON(ID, 'estoque.json')[0].n, 5);
});

test('SSRF: endereço da rede interna é recusado (IP direto, metadados da AWS, IPv6)', async () => {
  config({ permitirRedeLocal: false });
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`, 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x.jpg'] })] });
  await F.processarSite(ID, silencioso);
  const e = F.resumo(ID).comErro[0];
  assert.equal(e.fotos, 0);
  assert.equal(e.erros.length, 3);
  assert.ok(e.erros.every((x) => /rede interna/.test(x)), JSON.stringify(e));
  for (const ip of ['10.0.0.1', '172.20.1.1', '192.168.0.1', '127.0.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.100.1.1']) assert.ok(F.ipInterno(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2804:14c::1']) assert.ok(!F.ipInterno(ip), ip);
});

test('SSRF por redirecionamento: um endereço liberado que redireciona para a rede interna é barrado no 2º salto', async () => {
  config({ permitirRedeLocal: ['127.0.0.1'] }); // só o servidor de imagens do teste
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`, `${base}/redir-interno`] })] });
  await F.processarSite(ID, silencioso);
  const e = F.resumo(ID).comErro[0];
  assert.equal(e.fotos, 1, 'a foto normal passa');
  assert.match(e.erros[0], /foto 2: endereço da rede interna recusado/);
});

test('falha no envio para o armazenamento: o carro continua pendente (tenta de novo depois)', async () => {
  config({ enviar: 'exit 3' });
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`] })] });
  const r = await F.processarSite(ID, silencioso);
  assert.equal(r.falhas.length, 1);
  assert.equal(F.pendentes(ID).length, 1);
  config({ enviar: `test -f {dir}/1-800.webp && test {destino} = carros/C1 && test {site} = ${ID}` });
  assert.deepEqual((await F.processarSite(ID, silencioso)).processados, ['C1']);
  assert.equal(F.pendentes(ID).length, 0);
});

test('produção: com "enviar", nada fica no servidor; carro que sai tem as fotos apagadas do armazenamento', async () => {
  // "bucket" faz o papel da S3: o comando enviar copia a pasta temporária para lá
  config({ enviar: 'mkdir -p bucket/carros && rm -rf bucket/{destino} && cp -r {dir} bucket/{destino}', apagar: 'rm -rf bucket/{destino}' });
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`, `${base}/ok2`] }), A.carro({ id: 'C2', fotos: [`${base}/ok3`] })] });
  await F.processarSite(ID, silencioso);
  const bucket = (id) => path.join(A.raiz(), 'bucket', 'carros', id);
  assert.equal(fs.readdirSync(bucket('C1')).length, 6);
  assert.ok(!fs.existsSync(path.join(A.raiz(), 'fotos-teste')), 'nenhuma foto gravada no servidor');
  assert.ok(!fs.existsSync(path.join(A.raiz(), 's3-local')));
  // C2 vendido: sai do estoque → fotos dele saem do armazenamento
  A.gravarEstoque(ID, [A.carro({ id: 'C1', fotos: [`${base}/ok1`, `${base}/ok2`] })]);
  assert.ok(F.temTrabalho(ID));
  await F.processarSite(ID, silencioso);
  assert.ok(!fs.existsSync(bucket('C2')), 'fotos do carro que saiu continuam no armazenamento');
  assert.ok(fs.existsSync(bucket('C1')));
  assert.ok(!F.temTrabalho(ID));
});

test('conversor real (Pillow): gera webp de verdade nos 3 tamanhos, sem ampliar', { skip: spawnSync('python3', ['-c', 'import PIL']).status !== 0 && 'Pillow não instalado' }, async () => {
  config({ converter: undefined });
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`] })] });
  await F.processarSite(ID, silencioso);
  for (const w of [400, 800, 1600]) {
    const b = fs.readFileSync(path.join(dirCarro('C1'), `1-${w}.webp`));
    assert.equal(b.subarray(8, 12).toString(), 'WEBP');
  }
});

test('pela API: PUT de carro com URLs → site no ar sem foto → fotos prontas → site refeito com as fotos', async () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'C0' })] });
  A.silencioso(() => construir({ sites: [ID] }));
  const CL = require('../api/clientes.js');
  const tok = CL.criarCliente('teste-fotos', [ID]);
  const porta = await new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
  let saida = '';
  const srv = spawn(process.execPath, [path.join(A.PROJETO, 'api', 'servidor.js')], { env: { ...process.env, PORT: String(porta), ATRASO_MS: '50', TOKEN_ATUALIZAR: '', SITE_CARROS_RAIZ: A.raiz() } });
  srv.stdout.on('data', (d) => (saida += d)); srv.stderr.on('data', (d) => (saida += d));
  try {
    const esperar = async (cond, ms = 10000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
    assert.ok(await esperar(() => saida.includes('API em')), saida);
    const carro = A.carro({ fotos: [`${base}/ok1`, `${base}/ok2`] });
    delete carro.id;
    const r = await fetch(`http://127.0.0.1:${porta}/v1/sites/${ID}/carros/NOVO?esperar=20`, { method: 'PUT', body: JSON.stringify(carro), headers: { authorization: `Bearer ${tok}` } });
    assert.equal(r.status, 200, await r.text());
    const n = () => (A.lerJSON(ID, 'estoque.json').find((c) => c.i === 'NOVO') || {}).n;
    assert.ok(await esperar(() => n() === 2), `fotos não chegaram ao site (n=${n()}):\n${saida}`);
    assert.ok(fs.existsSync(path.join(dirCarro('NOVO'), '2-1600.webp')));
    const info = await (await fetch(`http://127.0.0.1:${porta}/v1/sites/${ID}`, { headers: { authorization: `Bearer ${tok}` } })).json();
    assert.equal(info.fotos.pendentes, 0);
  } finally { srv.kill(); }
});

test('site removido: apagarFotosDoSite tira do armazenamento as fotos de TODOS os carros dele (e o estado fica vazio)', async () => {
  A.criarSite(ID, { carros: [A.carro({ id: 'C1', fotos: [`${base}/ok1`] }), A.carro({ id: 'C2', fotos: [`${base}/ok2`] })] });
  await F.processarSite(ID, silencioso);
  assert.ok(fs.existsSync(dirCarro('C1')) && fs.existsSync(dirCarro('C2')));
  assert.deepEqual(await F.apagarFotosDoSite(ID, silencioso), { apagados: 2, pendentes: 0 });
  assert.ok(!fs.existsSync(dirCarro('C1')) && !fs.existsSync(dirCarro('C2')), 'fotos apagadas');
  assert.deepEqual(Object.keys(F.lerEstadoFotos(ID)), []);
  assert.deepEqual(await F.apagarFotosDoSite(ID, silencioso), { apagados: 0, pendentes: 0 }, 'de novo: nada a apagar');
});
