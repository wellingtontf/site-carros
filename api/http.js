// Utilidades HTTP da API (sem regra de negócio): erro com código, leitura do corpo com limite e resposta JSON.
class Erro extends Error { constructor(code, msg, extra = {}) { super(msg); this.code = code; this.extra = extra; } }

function corpo(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const p = [];
    req.on('data', (c) => { n += c.length; if (n > max) { rej(new Erro(413, `corpo grande demais (máx. ${max / 1e6} MB)`)); req.destroy(); } else p.push(c); });
    req.on('end', () => res(Buffer.concat(p).toString('utf8')));
    req.on('error', rej);
  });
}
async function corpoBinario(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const p = [];
    req.on('data', (c) => { n += c.length; if (n > max) { rej(new Erro(413, `arquivo grande demais (máx. ${max / 1e6} MB)`)); req.destroy(); } else p.push(c); });
    req.on('end', () => res(Buffer.concat(p)));
    req.on('error', rej);
  });
}
async function corpoJSON(req, max, vazio) {
  const t = (await corpo(req, max)).trim();
  if (!t) { if (vazio !== undefined) return vazio; throw new Erro(400, 'corpo vazio (esperado JSON)'); }
  try { return JSON.parse(t); } catch (e) { throw new Erro(400, `JSON inválido: ${e.message}`); }
}
const enviar = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };

module.exports = { Erro, corpo, corpoBinario, corpoJSON, enviar };
