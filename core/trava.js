// Trava de execução: uma operação que mexe em sites/ ou dist/ por vez (build pela API, atualizar pela CLI, criar ou
// renomear site, reescrever robots). Arquivo .estado/atualizar.lock com o pid; expira em 30 min (processo que morreu).
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');

const LOCK = () => path.join(C.ESTADO, 'atualizar.lock');

function travar() {
  fs.mkdirSync(C.ESTADO, { recursive: true });
  try { if (Date.now() - fs.statSync(LOCK()).mtimeMs > 30 * 60 * 1000) fs.rmSync(LOCK(), { force: true }); } catch (e) { /* sem trava */ }
  try { fs.writeFileSync(LOCK(), String(process.pid), { flag: 'wx' }); return true; } catch (e) { return false; }
}
const destravar = () => fs.rmSync(LOCK(), { force: true });

// roda fn com a trava; ocupado → { status: 'ocupado' } sem rodar
async function comTrava(fn) {
  if (!travar()) return { status: 'ocupado' };
  try { return await fn(); } finally { destravar(); }
}

module.exports = { travar, destravar, comTrava };
