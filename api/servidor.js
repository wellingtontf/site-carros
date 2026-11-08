#!/usr/bin/env node
// API de integração: porta de entrada HTTP da plataforma. Qualquer sistema (Revenda Mais, outro CRM, um script) cria
// sites e manda estoques; a plataforma valida, grava e refaz SÓ os sites afetados.
//
// Arquitetura (portas e adaptadores): core/ é o domínio (build, estoque, cadastro de site, fotos) e não sabe que a API
// existe; api/ só traduz HTTP ↔ core. Dependência num sentido só: api/ → core/.
//   api/servidor.js            liga tudo (este arquivo): token, servidor HTTP, fila e trabalhador de fotos
//   api/rotas.js               o que cada endereço faz
//   api/fila.js                pedidos em disco, processados em ordem, um build por site por lote
//   api/clientes.js            tokens por sistema externo (cada um limitado aos seus sites)
//   api/trabalhador-fotos.js   fotos por URL em segundo plano
//   api/cli.js                 criar/listar/remover tokens
//   api/README.md              o contrato para quem integra
//
//   node api/cli.js cliente criar revenda-mais --sites "*"     token de um sistema (aparece uma vez)
//   node api/servidor.js                                       sobe a API (PORT=8787)
// Variáveis: PORT (8787), ATRASO_MS (3000: junta chamadas seguidas), PUBLICAR=1 (publica depois de gerar),
// TOKEN_ATUALIZAR (opcional: token de administrador, todos os sites; 16+ caracteres).
// As rotas antigas sem /v1 (/status, /atualizar, PUT /sites/<d>/estoque) continuam funcionando.
const http = require('http');
const { idsSites } = require('../core/build');
const CL = require('./clientes');
const { criarFila } = require('./fila');
const { criarTrabalhador } = require('./trabalhador-fotos');
const { criarRotas } = require('./rotas');
const { Erro, enviar } = require('./http');

const PORT = +process.env.PORT || 8787;
const ADMIN = process.env.TOKEN_ATUALIZAR || '';

if (ADMIN && ADMIN.length < 16) { console.error('TOKEN_ATUALIZAR precisa ter pelo menos 16 caracteres.'); process.exit(1); }
let clientesIniciais;
try { clientesIniciais = CL.listarClientes(); } catch (e) { console.error(e.message); process.exit(1); }
if (!ADMIN && !clientesIniciais.length) {
  console.error('Nenhum token configurado. Crie um cliente: node api/cli.js cliente criar <nome> --sites "*"  (ou defina TOKEN_ATUALIZAR)');
  process.exit(1);
}

// fotos por URL em segundo plano; quando um site fica com fotos prontas, entra um pedido de build para ele
let fila = null;
const fotos = criarTrabalhador({ log: (m) => console.log(m), aoTerminar: (site) => fila.adicionar({ tipo: 'build', site, cliente: 'fotos' }) });
fila = criarFila({ atraso: +process.env.ATRASO_MS || 3000, publicar: /^(1|true|sim)$/i.test(process.env.PUBLICAR || ''), log: (m) => console.log(m), aoProcessarSite: (s) => fotos.agendar(s) });
for (const s of idsSites()) fotos.agendar(s); // o que ficou pendente (servidor caiu no meio das fotos)
const rotear = criarRotas({ fila });

const servidor = http.createServer(async (req, res) => {
  const t0 = Date.now();
  let quem = '-';
  res.on('finish', () => console.log(`${req.method} ${req.url.split('?')[0]} ${quem} → ${res.statusCode} (${Date.now() - t0} ms)`));
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/v1/')) url.pathname = `/v1${url.pathname}`; // rotas antigas (/status, /atualizar, /sites/...)
    if (req.method === 'GET' && url.pathname === '/v1/saude') return enviar(res, 200, { ok: true, api: 'v1' });
    const tk = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    let cliente = null;
    try { cliente = tk ? CL.autenticar(tk[1].trim(), { tokenAdmin: ADMIN }) : null; } catch (e) { throw new Erro(500, e.message); }
    if (!cliente) return enviar(res, 401, { erro: 'não autorizado (Authorization: Bearer <token>)' });
    quem = cliente.nome;
    await rotear(req, res, url, cliente);
  } catch (e) {
    if (res.headersSent) return;
    enviar(res, e instanceof Erro ? e.code : 500, { erro: e.message, ...(e.extra || {}) });
    if (!(e instanceof Erro)) console.error(e.stack);
  }
});
servidor.listen(PORT, () => console.log(`API em :${PORT} (clientes: ${clientesIniciais.map((c) => c.nome).join(', ') || 'nenhum'}${ADMIN ? ' + admin' : ''})`));

// desligar com calma: termina o que está processando; o que está na fila fica no disco e roda na volta
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => {
  servidor.close();
  const sair = () => (fila.rodando() || fotos.ocupado() ? setTimeout(sair, 200) : process.exit(0));
  sair();
});
