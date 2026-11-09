// Fotos vindas de qualquer sistema: o carro manda "fotos": ["https://.../a.jpg", ...] (ou só a quantidade, como antes,
// quando as fotos já estão no armazenamento). A plataforma baixa, converte para webp (400/800/1600) e grava no padrão
// que o site usa: carros/<id>/<n>-<largura>.webp  (n = 1..fotos, só as que deram certo, renumeradas).
// EM PRODUÇÃO AS FOTOS NÃO FICAM NO SERVIDOR: com "enviar" configurado, a conversão é feita numa pasta temporária,
// o comando sobe para a S3 (ou outro armazenamento) e a pasta é apagada. Sem "enviar" (teste local), grava em "pasta".
//
// Roda à parte do build (as fotos de 1000 carros levam minutos): enquanto um carro não tem fotos prontas, o build usa
// fotos = 0 (o site mostra o marcador, nunca imagem quebrada); quando ficam prontas, o site é refeito e só a página
// daquele carro muda. Estado em .estado/fotos/<dominio>.json: { id: { hash das URLs, n, erros, em } }.
// Mesmas URLs na mesma ordem = nada a fazer. Mudou qualquer URL do carro = refaz as fotos daquele carro.
//
// config/fotos.json (veja config/fotos.exemplo.json):
//   enviar      PRODUÇÃO: comando por carro: {dir} (pasta temporária com as fotos) {destino} ("carros/<id>") {site}
//               ex.: aws s3 sync {dir} s3://bucket/{destino} --delete   (--delete tira as fotos que sobraram de uma lista maior)
//   apagar      PRODUÇÃO: comando por carro que saiu do estoque: {destino} {site}  (ex.: aws s3 rm s3://bucket/{destino} --recursive)
//   pasta       SÓ SEM "enviar" (teste local): onde gravar (padrão "s3-local", servido em :8081); aceita {site}
//   converter   comando por foto: {entrada} {saida} {larguras}   (padrão: python3 core/converter-foto.py, precisa do Pillow)
//   paralelo    carros ao mesmo tempo (padrão 4)
//   permitirRedeLocal  true (ou lista de IPs) só em teste: por padrão, URL que aponta para a rede interna é recusada (SSRF: numa máquina
//                      da AWS, http://169.254.169.254 entrega as credenciais da máquina para quem pedir)
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { execFile } = require('child_process');
const C = require('./caminhos');
const Sites = require('./sites');
const Inq = require('./inquilinos');

const LARGURAS = [400, 800, 1600];
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const hashUrls = (urls) => crypto.createHash('sha1').update(JSON.stringify(urls)).digest('hex').slice(0, 16);
const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; } };
const aspas = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// config de fotos do inquilino (inquilinos/<id>/config/fotos.json; sem ela, config/fotos.json)
function lerConfig(inquilino = Inq.PADRAO) {
  const cfg = Inq.lerConfig(inquilino, 'fotos.json', null);
  if (!cfg) return null;
  return {
    pasta: cfg.pasta || 's3-local',
    converter: cfg.converter || `python3 ${aspas(path.join(C.CORE, 'converter-foto.py'))} {entrada} {saida} {larguras}`,
    enviar: cfg.enviar || '',
    apagar: cfg.apagar || '',
    paralelo: Math.max(1, cfg.paralelo || 4),
    permitirRedeLocal: cfg.permitirRedeLocal === true || (Array.isArray(cfg.permitirRedeLocal) ? cfg.permitirRedeLocal : false), // true ou lista de IPs
  };
}
const lerEstado = (site) => lerJSON(C.fotosEstado(site), {});
function gravarEstado(site, e) {
  const arq = C.fotosEstado(site);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, JSON.stringify(e));
  fs.renameSync(`${arq}.tmp`, arq);
}

// quantas fotos prontas o carro tem (usado pelo build): número = como veio; lista = o que já foi processado
function contarFotos(c, estado) {
  if (!Array.isArray(c.fotos)) return c.fotos;
  const e = estado[c.id];
  return e && e.hash === hashUrls(c.fotos) ? e.n : 0;
}
// carros do estoque com fotos (lista de URLs) ainda não processadas
function pendentes(site) {
  const est = Sites.estoque(site);
  const e = lerEstado(site);
  return (est.carros || []).filter((c) => Array.isArray(c.fotos) && (!e[c.id] || e[c.id].hash !== hashUrls(c.fotos)));
}
function resumo(site) {
  const e = lerEstado(site);
  return { pendentes: pendentes(site).length, comErro: Object.entries(e).filter(([, v]) => v.erros && v.erros.length).map(([id, v]) => ({ id, fotos: v.n, erros: v.erros.slice(0, 5) })).slice(0, 50) };
}

// ---------- baixar com segurança ----------
function ipInterno(ip) {
  if (net.isIPv6(ip)) {
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (m) return ipInterno(m[1]);
    const x = ip.toLowerCase();
    return x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function conferirEndereco(u, cfg) {
  if (!/^https?:$/.test(u.protocol)) throw new Error(`protocolo não aceito (${u.protocol})`);
  if (cfg.permitirRedeLocal === true) return;
  const liberados = Array.isArray(cfg.permitirRedeLocal) ? cfg.permitirRedeLocal : [];
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((x) => x.address);
  if (ips.some((ip) => ipInterno(ip) && !liberados.includes(ip))) throw new Error('endereço da rede interna recusado');
}
async function baixar(url, destino, cfg) {
  let u = new URL(url);
  for (let saltos = 0; ; saltos++) {
    await conferirEndereco(u, cfg); // a cada redirecionamento também: um site externo pode redirecionar para a rede interna
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'site-carros-fotos/1' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (saltos >= 3) throw new Error('redirecionamentos demais');
      u = new URL(r.headers.get('location'), u);
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const tipo = r.headers.get('content-type') || '';
    if (tipo && !/^image\//i.test(tipo)) throw new Error(`não é imagem (${tipo.split(';')[0]})`);
    if (Number(r.headers.get('content-length')) > MAX_BYTES) throw new Error('foto grande demais (máx. 20 MB)');
    const partes = []; let n = 0;
    for await (const p of r.body) { n += p.length; if (n > MAX_BYTES) throw new Error('foto grande demais (máx. 20 MB)'); partes.push(p); }
    fs.writeFileSync(destino, Buffer.concat(partes));
    return;
  }
}
const rodar = (cmd) => new Promise((ok, erro) => execFile('/bin/sh', ['-c', cmd], { cwd: C.ROOT, timeout: 5 * 60 * 1000 }, (e, so, se) => (e ? erro(new Error(`${(se || so || e.message).trim().split('\n').pop().slice(0, 200)}`)) : ok())));

// ---------- um carro ----------
async function processarCarro(site, c, cfg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-'));
  const erros = [];
  const prontas = [];
  try {
    for (const [i, url] of c.fotos.entries()) {
      const ent = path.join(tmp, `o${i}`);
      const sai = path.join(tmp, `c${i}`);
      try {
        await baixar(url, ent, cfg);
        await rodar(cfg.converter.replace(/\{entrada\}/g, aspas(ent)).replace(/\{saida\}/g, aspas(sai)).replace(/\{larguras\}/g, LARGURAS.join(',')));
        if (!LARGURAS.every((w) => fs.existsSync(`${sai}-${w}.webp`))) throw new Error('o conversor não gerou os 3 tamanhos');
        prontas.push(sai);
      } catch (e) { erros.push(`foto ${i + 1}: ${e.message}`); }
    }
    const destino = `carros/${c.id}`;
    // com "enviar": pasta temporária (apagada no fim); sem: a pasta local que faz o papel do armazenamento
    const dir = cfg.enviar ? path.join(tmp, 'saida') : path.join(path.resolve(C.ROOT, cfg.pasta.replace(/\{site\}/g, site)), destino);
    fs.rmSync(dir, { recursive: true, force: true }); // sobra de uma lista maior não pode aparecer como foto
    fs.mkdirSync(dir, { recursive: true });
    prontas.forEach((sai, k) => LARGURAS.forEach((w) => fs.renameSync(`${sai}-${w}.webp`, path.join(dir, `${k + 1}-${w}.webp`))));
    if (cfg.enviar) await rodar(cfg.enviar.replace(/\{dir\}/g, aspas(dir)).replace(/\{destino\}/g, aspas(destino)).replace(/\{site\}/g, aspas(site)));
    return { hash: hashUrls(c.fotos), n: prontas.length, erros, em: new Date().toISOString() };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// carro que saiu do estoque: as fotos dele saem do armazenamento (comando "apagar"; sem ele, da pasta local).
// Se apagar falhar, fica no estado e tenta de novo na próxima vez.
async function limparSaidos(site, e, ids, cfg, log) {
  for (const id of Object.keys(e).filter((x) => !ids.has(x))) {
    try {
      if (cfg.enviar) { if (cfg.apagar) await rodar(cfg.apagar.replace(/\{destino\}/g, aspas(`carros/${id}`)).replace(/\{site\}/g, aspas(site))); }
      else fs.rmSync(path.join(path.resolve(C.ROOT, cfg.pasta.replace(/\{site\}/g, site)), 'carros', id), { recursive: true, force: true });
      delete e[id];
    } catch (err) { log(`${site}: não consegui apagar as fotos de ${id}: ${err.message}`); }
  }
}

// processa as fotos pendentes de um site → { processados: [ids], erros: n }
async function processarSite(site, { log = console.log, cfg = lerConfig(Inq.doSite(site)) } = {}) {
  const lista = pendentes(site);
  // sem foto por URL pendente, a configuração só faz falta se houver fotos de carro que saiu para apagar
  if (!cfg && !lista.length && !Object.keys(lerEstado(site)).length) return { processados: [], erros: 0, falhas: [] };
  if (!cfg) throw Object.assign(new Error('crie config/fotos.json (veja config/fotos.exemplo.json) para processar fotos por URL'), { semConfig: true });
  if (!lista.length) {
    const e = lerEstado(site);
    const ids = new Set((Sites.estoque(site).carros || []).map((c) => c.id));
    if (Object.keys(e).some((id) => !ids.has(id))) { await limparSaidos(site, e, ids, cfg, log); gravarEstado(site, e); }
    return { processados: [], erros: 0, falhas: [] };
  }
  log(`${site}: processando fotos de ${lista.length} carro(s)`);
  const fila = [...lista];
  const feitos = {};
  const falhas = [];
  await Promise.all(Array.from({ length: cfg.paralelo }, async () => {
    while (fila.length) {
      const c = fila.shift();
      // falha do carro inteiro (envio para o armazenamento, disco...): NÃO marca como feito, fica pendente para a próxima vez
      try { feitos[c.id] = await processarCarro(site, c, cfg); } catch (e) { falhas.push(`${c.id}: ${e.message}`); }
    }
  }));
  // relê o estado na hora de gravar (outro processamento pode ter gravado no meio)
  const ids = new Set((Sites.estoque(site).carros || []).map((c) => c.id));
  const e = { ...lerEstado(site), ...feitos };
  await limparSaidos(site, e, ids, cfg, log);
  gravarEstado(site, e);
  const nErros = Object.values(feitos).filter((x) => x.erros.length).length;
  log(`${site}: fotos prontas de ${Object.keys(feitos).length} carro(s)${nErros ? ` · ${nErros} com foto que falhou (GET /v1/sites/${site})` : ''}${falhas.length ? ` · ${falhas.length} carro(s) ficam pendentes: ${falhas.slice(0, 3).join('; ')}` : ''}`);
  return { processados: Object.keys(feitos), erros: nErros, falhas };
}

// site removido: as fotos de TODOS os carros saem do armazenamento (comando "apagar"; sem "enviar", da pasta local)
async function apagarFotosDoSite(site, { log = console.log } = {}) {
  const cfg = lerConfig(Inq.doSite(site));
  const e = lerEstado(site);
  if (!cfg || !Object.keys(e).length) return { apagados: 0, pendentes: 0 };
  const antes = Object.keys(e).length;
  await limparSaidos(site, e, new Set(), cfg, log);
  gravarEstado(site, e);
  return { apagados: antes - Object.keys(e).length, pendentes: Object.keys(e).length };
}

// algo a fazer neste site? (fotos pendentes ou carros que saíram com fotos guardadas)
function temTrabalho(site) {
  if (pendentes(site).length) return true;
  const ids = new Set((Sites.estoque(site).carros || []).map((c) => c.id));
  return Object.keys(lerEstado(site)).some((id) => !ids.has(id));
}

module.exports = { apagarFotosDoSite, lerConfig, contarFotos, lerEstadoFotos: lerEstado, pendentes, temTrabalho, resumo, processarSite, hashUrls, ipInterno, LARGURAS };
