// Travas de execução POR CHAVE (em geral, por site): dois trabalhadores nunca mexem no MESMO site ao mesmo tempo, mas
// sites diferentes são gerados em paralelo (vários pods de trabalhador no Kubernetes, com o volume compartilhado).
//   .estado/travas/<chave>.lock  criado com O_EXCL (atômico, inclusive em EFS/NFSv4); conteúdo = host:pid:data
// Expira em 30 min: um pod que morreu no meio não deixa o site travado para sempre.
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./caminhos');

const EXPIRA_MS = 30 * 60 * 1000;
const CHAVE_OK = /^[a-z0-9][a-z0-9._-]{0,200}$/;
const arquivo = (chave) => {
  if (!CHAVE_OK.test(chave)) throw new Error(`chave de trava inválida "${chave}"`);
  return path.join(C.ESTADO, 'travas', `${chave}.lock`);
};
const chaveSite = (dominio) => `site-${dominio}`;

function travar(chave) {
  const arq = arquivo(chave);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  try { if (Date.now() - fs.statSync(arq).mtimeMs > EXPIRA_MS) fs.rmSync(arq, { force: true }); } catch (e) { /* sem trava */ }
  try { fs.writeFileSync(arq, `${os.hostname()}:${process.pid}:${new Date().toISOString()}`, { flag: 'wx' }); return true; } catch (e) { return false; }
}
const destravar = (chave) => fs.rmSync(arquivo(chave), { force: true });

// roda fn com TODAS as travas (ordem fixa: sem impasse entre dois trabalhadores); alguma ocupada → { status: 'ocupado' }
async function comTrava(chaves, fn) {
  const lista = [...new Set([].concat(chaves))].sort();
  const pegas = [];
  for (const c of lista) { if (!travar(c)) { pegas.forEach(destravar); return { status: 'ocupado', chave: c }; } pegas.push(c); }
  try { return await fn(); } finally { pegas.forEach(destravar); }
}

module.exports = { travar, destravar, comTrava, chaveSite, arquivo };
