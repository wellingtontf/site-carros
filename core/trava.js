// Travas de execução POR CHAVE (em geral, por site): dois trabalhadores nunca mexem no MESMO site ao mesmo tempo, mas
// sites diferentes são gerados em paralelo (vários pods de trabalhador no Kubernetes, com o volume compartilhado).
//   .estado/travas/<chave>.lock  criado com O_EXCL (atômico, inclusive em EFS/NFSv4); conteúdo = host:pid:data
// Enquanto o trabalho roda, a trava é RENOVADA (a cada 1/3 do prazo): um build longo nunca perde a trava. Um pod que
// morreu para de renovar e a trava expira em EXPIRA_MS (5 min; SITE_CARROS_TRAVA_EXPIRA_MS muda), liberando o site.
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./caminhos');

const expira = () => Number(process.env.SITE_CARROS_TRAVA_EXPIRA_MS) || 5 * 60 * 1000;
const CHAVE_OK = /^[a-z0-9][a-z0-9._-]{0,200}$/;
const arquivo = (chave) => {
  if (!CHAVE_OK.test(chave)) throw new Error(`chave de trava inválida "${chave}"`);
  return path.join(C.ESTADO, 'travas', `${chave}.lock`);
};
const chaveSite = (dominio) => `site-${dominio}`;

function travar(chave) {
  const arq = arquivo(chave);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  try { if (Date.now() - fs.statSync(arq).mtimeMs > expira()) fs.rmSync(arq, { force: true }); } catch (e) { /* sem trava */ }
  try { fs.writeFileSync(arq, `${os.hostname()}:${process.pid}:${new Date().toISOString()}`, { flag: 'wx' }); minhas.add(chave); return true; } catch (e) { return false; }
}
const minhas = new Set(); // travas deste processo (o build, que é síncrono, renova todas de tempos em tempos)
const destravar = (chave) => { minhas.delete(chave); fs.rmSync(arquivo(chave), { force: true }); };
// "ainda estou aqui": atualiza a data da trava (só se ela ainda existir)
const renovar = (chave) => { try { const agora = new Date(); fs.utimesSync(arquivo(chave), agora, agora); } catch (e) { /* trava já liberada */ } };

// trabalho síncrono longo (o build) não deixa o temporizador rodar: ele chama isto entre uma página e outra
let ultimaRenovacao = 0;
function renovarMinhas() {
  if (!minhas.size || Date.now() - ultimaRenovacao < expira() / 3) return;
  ultimaRenovacao = Date.now();
  minhas.forEach(renovar);
}

// roda fn com TODAS as travas (ordem fixa: sem impasse entre dois trabalhadores); alguma ocupada → { status: 'ocupado' }
async function comTrava(chaves, fn) {
  const lista = [...new Set([].concat(chaves))].sort();
  const pegas = [];
  for (const c of lista) { if (!travar(c)) { pegas.forEach(destravar); return { status: 'ocupado', chave: c }; } pegas.push(c); }
  const pulso = setInterval(() => pegas.forEach(renovar), Math.max(50, expira() / 3));
  pulso.unref();
  try { return await fn(); } finally { clearInterval(pulso); pegas.forEach(destravar); }
}

module.exports = { travar, destravar, renovar, renovarMinhas, comTrava, chaveSite, arquivo, expira };
