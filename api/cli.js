#!/usr/bin/env node
// Inquilinos e tokens da API.
//   node api/cli.js inquilino criar <id> --nome "Webmotors" [--rascunho "site{n}.previa.com.br"] [--templates a,b]
//   node api/cli.js inquilino listar
//   node api/cli.js cliente criar <nome> --inquilino <id> --sites a.com.br,b.com.br   (ou --sites "*" = todos do inquilino)
//   node api/cli.js cliente listar
//   node api/cli.js cliente remover <nome>                                          o token deixa de valer na hora
const CL = require('./clientes');
const Sites = require('../core/sites');
const Inq = require('../core/inquilinos');

const falha = (m) => { console.error(`Erro: ${m}`); process.exit(1); };
const av = process.argv.slice(2);
const opc = (k) => { const i = av.indexOf(`--${k}`); return i >= 0 ? av[i + 1] : null; };
const [grupo, acao, nome] = av.filter((x, i) => !x.startsWith('--') && !(i > 0 && av[i - 1].startsWith('--')));
const lista = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const USO = 'uso: inquilino criar <id> --nome "..." [--rascunho "site{n}.x.com.br"] [--templates a,b] | inquilino listar | cliente criar <nome> --inquilino <id> --sites a,b | cliente listar | cliente remover <nome>';

if (grupo === 'inquilino') {
  if (acao === 'criar') {
    if (!nome) falha('informe o id: inquilino criar <id> --nome "..."');
    try {
      const i = Inq.criar(nome, { nome: opc('nome') || nome, templates: opc('templates') ? lista(opc('templates')) : null, rascunhos: opc('rascunho') ? { padrao: opc('rascunho') } : null });
      console.log(`Inquilino "${i.id}" criado: inquilinos/${i.id}/ (coloque fotos.json, infra.json, publicacao.json, site-modelo.json em inquilinos/${i.id}/config/)`);
    } catch (e) { falha(e.message); }
  } else if (!acao || acao === 'listar') {
    for (const id of [Inq.PADRAO, ...Inq.listar()]) {
      const i = Inq.carregar(id);
      console.log(`${id.padEnd(20)} ${String(Sites.listar({ inquilino: id }).length).padStart(5)} site(s)  ${i.nome}${i.rascunhos ? `  rascunho: ${i.rascunhos.padrao}` : ''}${i.templates ? `  templates: ${i.templates.join(',')}` : ''}`);
    }
  } else falha(USO);
} else if (grupo === 'cliente') {
  if (acao === 'criar') {
    if (!nome) falha('informe o nome: cliente criar <nome> --inquilino <id> --sites a.com.br,b.com.br');
    const sites = lista(opc('sites'));
    const inq = opc('inquilino') || Inq.PADRAO;
    for (const x of sites) if (x !== '*' && !Sites.existe(x)) console.warn(`  aviso: site "${x}" ainda não existe (o token vai valer quando existir)`);
    let token;
    try { token = CL.criarCliente(nome, sites, inq); } catch (e) { falha(e.message); }
    console.log(`Cliente "${nome}" criado (inquilino: ${inq}; sites: ${sites.join(', ')}).\n\nToken (aparece SÓ agora; guarde no cofre de senhas do sistema que vai chamar a API):\n\n  ${token}\n\nUso: Authorization: Bearer <token>   (api/README.md)`);
  } else if (acao === 'remover') {
    try { CL.removerCliente(nome); } catch (e) { falha(e.message); }
    console.log(`Cliente "${nome}" removido: o token dele deixa de valer na hora.`);
  } else if (!acao || acao === 'listar') {
    const l = CL.listarClientes();
    if (!l.length) console.log('Nenhum cliente. Crie com: node api/cli.js cliente criar <nome> --inquilino <id> --sites "*"');
    l.forEach((c) => console.log(`${c.nome.padEnd(20)} ${c.inquilino.padEnd(16)} ${c.ativo ? 'ativo  ' : 'INATIVO'} ${c.criado.padEnd(10)} ${c.sites.join(', ')}`));
  } else falha(USO);
} else falha(USO);
