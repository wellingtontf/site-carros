#!/usr/bin/env node
// Tokens da API (um por sistema externo, cada um limitado aos seus sites).
//   node api/cli.js cliente criar <nome> --sites a.com.br,b.com.br     (ou --sites "*" = todos, e pode criar sites novos)
//   node api/cli.js cliente listar
//   node api/cli.js cliente remover <nome>                              o token deixa de valer na hora
const CL = require('./clientes');
const Sites = require('../core/sites');

const falha = (m) => { console.error(`Erro: ${m}`); process.exit(1); };
const av = process.argv.slice(2);
const opc = (k) => { const i = av.indexOf(`--${k}`); return i >= 0 ? av[i + 1] : null; };
const [grupo, acao, nome] = av.filter((x, i) => !x.startsWith('--') && !(i > 0 && av[i - 1].startsWith('--')));

if (grupo !== 'cliente') falha('uso: node api/cli.js cliente criar <nome> --sites a,b | cliente listar | cliente remover <nome>');
if (acao === 'criar') {
  if (!nome) falha('informe o nome: cliente criar <nome> --sites a.com.br,b.com.br');
  const sites = String(opc('sites') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const existentes = Sites.listar();
  for (const x of sites) if (x !== '*' && !existentes.includes(x)) console.warn(`  aviso: site "${x}" ainda não existe em sites/ (o token vai valer quando existir)`);
  let token;
  try { token = CL.criarCliente(nome, sites); } catch (e) { falha(e.message); }
  console.log(`Cliente "${nome}" criado (sites: ${sites.join(', ')}).\n\nToken (aparece SÓ agora; guarde no cofre de senhas do sistema que vai chamar a API):\n\n  ${token}\n\nUso: Authorization: Bearer <token>   (api/README.md)`);
} else if (acao === 'remover') {
  try { CL.removerCliente(nome); } catch (e) { falha(e.message); }
  console.log(`Cliente "${nome}" removido: o token dele deixa de valer na hora.`);
} else if (!acao || acao === 'listar') {
  const l = CL.listarClientes();
  if (!l.length) console.log('Nenhum cliente. Crie com: node api/cli.js cliente criar <nome> --sites "*"');
  l.forEach((c) => console.log(`${c.nome.padEnd(20)} ${c.ativo ? 'ativo  ' : 'INATIVO'} ${c.criado.padEnd(10)} ${c.sites.join(', ')}`));
} else falha('uso: cliente criar <nome> --sites a,b | cliente listar | cliente remover <nome>');
