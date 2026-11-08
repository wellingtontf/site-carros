// Clientes da API: cada sistema que manda estoque (Revenda Mais, outro CRM, uma planilha...) tem o SEU token e só mexe
// nos sites que lhe pertencem. A plataforma não conhece nenhum desses sistemas: todos falam o mesmo contrato (api/README.md).
//
// config/clientes.json (fora do git):
// Multi-tenant: cada cliente pertence a UM inquilino ("inquilino"; ausente = "padrao") e só enxerga os sites dele.
// "sites": ["*"] = todos os sites DO INQUILINO (e pode criar sites nele). Só o admin (TOKEN_ATUALIZAR) atravessa inquilinos.
//   { "revenda-mais": { "token_sha256": "<sha256 do token>", "inquilino": "revenda-mais", "sites": ["*"], "criado": "2026-11-07" },
//     "crm-x":        { "token_sha256": "...", "sites": ["trokey.com.br"], "ativo": false } }
// Só o hash do token fica gravado: o token aparece uma vez, quando é criado (node api/cli.js cliente criar <nome>).
// TOKEN_ATUALIZAR (variável de ambiente) continua valendo como cliente "admin", com acesso a todos os sites.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../core/caminhos');
const Inq = require('../core/inquilinos');

const NOME_OK = /^[a-z0-9][a-z0-9-]{1,40}$/;
const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const iguais = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// relido a cada chamada (arquivo pequeno): cliente novo ou desativado vale na hora, sem reiniciar o servidor
function lerClientes() {
  try { return JSON.parse(fs.readFileSync(C.clientes(), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`config/clientes.json inválido: ${e.message}`);
  }
}
function gravarClientes(obj) {
  fs.mkdirSync(path.dirname(C.clientes()), { recursive: true });
  const tmp = `${C.clientes()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, C.clientes());
}

// token → { nome, sites, admin } ou null
function autenticar(token, { tokenAdmin = process.env.TOKEN_ATUALIZAR || '' } = {}) {
  if (!token || token.length < 16) return null;
  if (tokenAdmin.length >= 16 && iguais(token, tokenAdmin)) return { nome: 'admin', sites: ['*'], admin: true, inquilino: null };
  const h = sha256(token);
  for (const [nome, c] of Object.entries(lerClientes())) {
    if (c && typeof c.token_sha256 === 'string' && iguais(h, c.token_sha256)) return c.ativo === false ? null : { nome, sites: c.sites || [], admin: false, inquilino: c.inquilino || Inq.PADRAO };
  }
  return null;
}
// o site é do inquilino do cliente E está na lista dele (ou a lista é "*")
const pode = (cliente, site) => !!cliente && (cliente.admin || (Inq.doSite(site) === cliente.inquilino && (cliente.sites.includes('*') || cliente.sites.includes(site))));

function criarCliente(nome, sites, inquilino = Inq.PADRAO) {
  if (!Inq.existe(inquilino)) throw new Error(`inquilino "${inquilino}" não existe (crie com: node api/cli.js inquilino criar ${inquilino})`);
  if (!NOME_OK.test(nome)) throw new Error('nome do cliente: letras minúsculas, números e hífen (ex.: revenda-mais)');
  if (!Array.isArray(sites) || !sites.length) throw new Error('informe os sites do cliente (--sites a.com.br,b.com.br ou --sites "*")');
  const todos = lerClientes();
  if (todos[nome]) throw new Error(`cliente "${nome}" já existe (para trocar o token: cliente remover ${nome} e criar de novo)`);
  const token = `sc_${crypto.randomBytes(24).toString('base64url')}`;
  todos[nome] = { token_sha256: sha256(token), ...(inquilino !== Inq.PADRAO ? { inquilino } : {}), sites, criado: new Date().toISOString().slice(0, 10) };
  gravarClientes(todos);
  return token;
}
function removerCliente(nome) {
  const todos = lerClientes();
  if (!todos[nome]) throw new Error(`cliente "${nome}" não existe`);
  delete todos[nome];
  gravarClientes(todos);
}
// domínio trocado (POST /v1/sites/<d>/dominio): os tokens que tinham o antigo passam a ter o novo
function renomearSiteNosClientes(antigo, novo) {
  const todos = lerClientes();
  let mudou = false;
  for (const c of Object.values(todos)) if (Array.isArray(c.sites) && c.sites.includes(antigo)) { c.sites = c.sites.map((s) => (s === antigo ? novo : s)); mudou = true; }
  if (mudou) gravarClientes(todos);
}
// site removido: sai da lista de sites dos tokens (quem tinha "*" não muda)
function removerSiteDosClientes(dominio) {
  const todos = lerClientes();
  let mudou = false;
  for (const c of Object.values(todos)) if (Array.isArray(c.sites) && c.sites.includes(dominio)) { c.sites = c.sites.filter((s) => s !== dominio); mudou = true; }
  if (mudou) gravarClientes(todos);
}
const listarClientes = () => Object.entries(lerClientes()).map(([nome, c]) => ({ nome, inquilino: c.inquilino || Inq.PADRAO, sites: c.sites || [], ativo: c.ativo !== false, criado: c.criado || '' }));

module.exports = { autenticar, pode, criarCliente, removerCliente, renomearSiteNosClientes, removerSiteDosClientes, listarClientes, lerClientes, sha256 };
