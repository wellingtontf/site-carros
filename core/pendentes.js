// Pendências de publicação: o que mudou em cada site e ainda não subiu para a hospedagem.
// UM ARQUIVO POR SITE (.estado/<pasta>/pendentes/<dominio>.json): vários trabalhadores gerando sites diferentes ao
// mesmo tempo nunca disputam o mesmo arquivo (cada site é gerado por um trabalhador por vez: trava por site).
//   { escritos: ["<dominio>/a.html", ...], removidos: [...], completo: false }   completo = publicar a pasta inteira
//
// Publicar sem perder nada: reservar() tira o arquivo do lugar (rename atômico) antes de publicar. O que um build
// registrar DURANTE a publicação vai para um arquivo novo; se a publicação falhar, devolver() mescla a reserva de volta.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./caminhos');

const dir = (pasta) => path.join(C.ESTADO, pasta, 'pendentes');
const arq = (pasta, id) => path.join(dir(pasta), `${id}.json`);
const lerJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const gravar = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p); };

// formato antigo (um pendente.json para todos): separa por site uma vez
function migrar(pasta) {
  const velho = path.join(C.ESTADO, pasta, 'pendente.json');
  const p = fs.existsSync(velho) ? lerJSON(velho) : null;
  if (!p) return;
  for (const [id, s] of Object.entries(p)) registrar(pasta, id, s, !!s.completo);
  fs.renameSync(velho, `${velho}.migrado`);
}

function mesclar(atual, mud, completo) {
  const s = atual || { escritos: [], removidos: [], completo: false };
  s.completo = !!(s.completo || completo);
  s.removidos = [...new Set([...s.removidos, ...(mud.removidos || [])])];
  s.escritos = s.completo ? [] : [...new Set([...s.escritos, ...(mud.escritos || [])])].filter((x) => !s.removidos.includes(x));
  return s;
}
function registrar(pasta, id, mud, completo = false) {
  const s = mesclar(lerJSON(arq(pasta, id)), mud, completo);
  if (s.completo || s.escritos.length || s.removidos.length) gravar(arq(pasta, id), s);
}
const ler = (pasta, id) => { migrar(pasta); return lerJSON(arq(pasta, id)) || undefined; };
const listar = (pasta) => { migrar(pasta); return fs.existsSync(dir(pasta)) ? fs.readdirSync(dir(pasta)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : []; };
const remover = (pasta, id) => fs.rmSync(arq(pasta, id), { force: true });
const marcarCompleto = (pasta, id) => registrar(pasta, id, {}, true);

// pega as pendências de um site para publicar → { pendencia, confirmar(), devolver() } ou null (nada pendente)
function reservar(pasta, id) {
  migrar(pasta);
  const reserva = `${arq(pasta, id)}.publicando.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
  try { fs.renameSync(arq(pasta, id), reserva); } catch (e) { return null; }
  const pendencia = lerJSON(reserva) || { escritos: [], removidos: [], completo: false };
  return {
    pendencia,
    confirmar: () => fs.rmSync(reserva, { force: true }),
    devolver: () => { registrar(pasta, id, pendencia, pendencia.completo); fs.rmSync(reserva, { force: true }); },
  };
}

// domínio trocado: as pendências vão junto (e o domínio novo publica inteiro)
function mover(pasta, antigo, novo) {
  const p = lerJSON(arq(pasta, antigo));
  remover(pasta, antigo);
  registrar(pasta, novo, p || {}, true);
  return p;
}

module.exports = { registrar, ler, listar, remover, reservar, marcarCompleto, mover };
