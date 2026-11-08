#!/usr/bin/env node
// Porta de entrada da plataforma. No Kubernetes, o MESMO código roda em dois papéis (PAPEL), escalados à parte:
//   PAPEL=api           recebe as chamadas (sem estado: qualquer número de pods atrás do balanceador)
//   PAPEL=trabalhador   processa a fila: builds, fotos, publicação (escala pelo tamanho da fila: /metrics)
//   PAPEL=tudo          os dois no mesmo processo (desenvolvimento, servidor único) — o padrão
// Os dois papéis só conversam pelo volume compartilhado (SITE_CARROS_RAIZ, EFS na AWS): fila, sites, estado.
//
// Arquitetura (portas e adaptadores): core/ é o domínio e não sabe que a API existe; api/ só traduz HTTP ↔ core.
//   api/servidor.js   liga tudo (este arquivo)       api/rotas.js        o que cada endereço faz
//   api/fila.js       pedidos em arquivos             api/trabalhador.js  processa a fila (N pods em paralelo)
//   api/clientes.js   tokens por inquilino            api/cli.js          tokens e inquilinos pela linha de comando
//   api/README.md     o contrato para quem integra
//
// Saúde (sem token): GET /v1/saude (liveness), GET /v1/pronto (readiness: volume gravável), GET /metrics (Prometheus).
// Variáveis: PAPEL, PORT (8787), ATRASO_MS (3000: junta chamadas seguidas), PARALELO (sites por trabalhador, 2),
// PUBLICAR=1 (publica depois de gerar), TOKEN_ATUALIZAR (admin da plataforma, 16+), LOG_JSON=1 (logs em JSON).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../core/caminhos');
const CL = require('./clientes');
const { criarFila } = require('./fila');
const { criarTrabalhador } = require('./trabalhador');
const { criarRotas } = require('./rotas');
const { Erro, enviar } = require('./http');

const PAPEL = process.env.PAPEL || 'tudo';
const PORT = +process.env.PORT || 8787;
const ADMIN = process.env.TOKEN_ATUALIZAR || '';
const ehApi = PAPEL === 'api' || PAPEL === 'tudo';
const ehTrabalhador = PAPEL === 'trabalhador' || PAPEL === 'tudo';
const log = process.env.LOG_JSON ? (m) => console.log(JSON.stringify({ em: new Date().toISOString(), papel: PAPEL, pod: os.hostname(), msg: m })) : (m) => console.log(m);

if (!['api', 'trabalhador', 'tudo'].includes(PAPEL)) { console.error(`PAPEL inválido "${PAPEL}" (api | trabalhador | tudo)`); process.exit(1); }
if (ADMIN && ADMIN.length < 16) { console.error('TOKEN_ATUALIZAR precisa ter pelo menos 16 caracteres.'); process.exit(1); }
let clientesIniciais = [];
if (ehApi) {
  try { clientesIniciais = CL.listarClientes(); } catch (e) { console.error(e.message); process.exit(1); }
  if (!ADMIN && !clientesIniciais.length) {
    console.error('Nenhum token configurado. Crie um cliente: node api/cli.js cliente criar <nome> --sites "*"  (ou defina TOKEN_ATUALIZAR)');
    process.exit(1);
  }
}

const fila = criarFila();
const trabalhador = ehTrabalhador ? criarTrabalhador({
  fila, atraso: +process.env.ATRASO_MS || 3000, publicar: /^(1|true|sim)$/i.test(process.env.PUBLICAR || ''), log,
  aoRenomear: (antigo, novo) => CL.renomearSiteNosClientes(antigo, novo), // tokens acompanham a troca de domínio
  aoRemover: (site) => CL.removerSiteDosClientes(site),
}) : null;
const rotear = ehApi ? criarRotas({ fila }) : null;

// readiness: o volume compartilhado responde e aceita escrita (sem ele, o pod não recebe tráfego)
function pronto() {
  try { fs.mkdirSync(C.ESTADO, { recursive: true }); const t = path.join(C.ESTADO, `.pronto-${os.hostname()}`); fs.writeFileSync(t, String(Date.now())); fs.rmSync(t); return true; } catch (e) { return false; }
}
function metricas() {
  const e = fila.estado();
  const t = trabalhador ? trabalhador.estado() : { ativos: [] };
  return [
    '# HELP site_carros_fila_pedidos Pedidos esperando na fila (o autoscaler de trabalhadores olha este número)',
    '# TYPE site_carros_fila_pedidos gauge',
    `site_carros_fila_pedidos{canal="principal"} ${e.naFila}`,
    `site_carros_fila_pedidos{canal="fotos"} ${e.fotosNaFila}`,
    '# TYPE site_carros_trabalhador_ativos gauge',
    `site_carros_trabalhador_ativos ${t.ativos.length}`,
    '# TYPE site_carros_uptime_segundos counter',
    `site_carros_uptime_segundos ${Math.round(process.uptime())}`,
  ].join('\n') + '\n';
}

const servidor = http.createServer(async (req, res) => {
  const t0 = Date.now();
  let quem = '-';
  res.on('finish', () => { if (!/^\/(v1\/(saude|pronto)|metrics)/.test(req.url)) log(`${req.method} ${req.url.split('?')[0]} ${quem} → ${res.statusCode} (${Date.now() - t0} ms)`); });
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/metrics') { res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }); return res.end(metricas()); }
    if (!url.pathname.startsWith('/v1/')) url.pathname = `/v1${url.pathname}`; // rotas antigas (/status, /atualizar, /sites/...)
    if (req.method === 'GET' && url.pathname === '/v1/saude') return enviar(res, 200, { ok: true, api: 'v1', papel: PAPEL });
    if (req.method === 'GET' && url.pathname === '/v1/pronto') return enviar(res, pronto() ? 200 : 503, { pronto: pronto(), papel: PAPEL });
    if (!rotear) return enviar(res, 404, { erro: `este pod é só "${PAPEL}"` });
    const tk = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    let cliente = null;
    try { cliente = tk ? CL.autenticar(tk[1].trim(), { tokenAdmin: ADMIN }) : null; } catch (e) { throw new Erro(500, e.message); }
    if (!cliente) return enviar(res, 401, { erro: 'não autorizado (Authorization: Bearer <token>)' });
    quem = cliente.inquilino ? `${cliente.inquilino}/${cliente.nome}` : cliente.nome;
    await rotear(req, res, url, cliente);
  } catch (e) {
    if (res.headersSent) return;
    enviar(res, e instanceof Erro ? e.code : 500, { erro: e.message, ...(e.extra || {}) });
    if (!(e instanceof Erro)) console.error(e.stack);
  }
});
servidor.listen(PORT, () => {
  log(`API em :${PORT} (papel ${PAPEL}${ehApi ? `; clientes: ${clientesIniciais.map((c) => c.nome).join(', ') || 'nenhum'}${ADMIN ? ' + admin' : ''}` : ''})`);
  if (trabalhador) trabalhador.iniciar({ paralelo: +process.env.PARALELO || 2 });
});

// desligar com calma (o Kubernetes manda SIGTERM): para de pegar trabalho novo e termina o que está fazendo.
// O que está na fila fica no volume e outro pod pega.
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => {
  servidor.close();
  if (trabalhador) trabalhador.parar();
  const sair = () => (trabalhador && trabalhador.ocupado() ? setTimeout(sair, 200) : process.exit(0));
  sair();
});
