// Scripts de infra (ferramentas/infra/*.sh) em modo SIMULAR=1: os comandos da AWS saem certos, rascunho não pede
// certificado, definitivo pede (domínio + www), promover tira o rascunho do ar e domínio inválido é recusado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'ferramentas', 'infra');
const roda = (script, args, env = {}) => spawnSync('/bin/sh', [path.join(DIR, script), ...args], { encoding: 'utf8', env: { ...process.env, SIMULAR: '1', DISTRIBUICAO: 'E1TESTE', BUCKET: 'sites-teste', RASCUNHO_RE: '^site[0-9]+\\.carro57\\.com\\.br$', ...env } });

test('criar: rascunho só com o endereço (certificado curinga); definitivo com www e certificado gerenciado', () => {
  const r = roda('criar.sh', ['site7.carro57.com.br']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /create-distribution-tenant --distribution-id E1TESTE --name site7-carro57-com-br --domains Domain=site7\.carro57\.com\.br --parameters Name=pasta,Value=site7\.carro57\.com\.br/);
  assert.doesNotMatch(r.stdout, /managed-certificate/);
  const f = roda('criar.sh', ['lojax.com.br']);
  assert.match(f.stdout, /--domains Domain=lojax\.com\.br Domain=www\.lojax\.com\.br/);
  assert.match(f.stdout, /--managed-certificate-request ValidationTokenHost=cloudfront/);
});

test('promover: cria o definitivo e tira o rascunho (tenant + arquivos)', () => {
  const r = roda('promover.sh', ['site7.carro57.com.br', 'lojax.com.br']);
  assert.equal(r.status, 0, r.stderr);
  const linhas = r.stdout.split('\n');
  assert.ok(linhas.findIndex((l) => /create-distribution-tenant.*lojax-com-br/.test(l)) < linhas.findIndex((l) => /delete-distribution-tenant --id site7-carro57-com-br/.test(l)), 'cria antes de tirar');
  assert.match(r.stdout, /aws s3 rm s3:\/\/sites-teste\/site7\.carro57\.com\.br\/ --recursive/);
});

test('remover e validações: domínio inválido e variável faltando são recusados', () => {
  assert.match(roda('remover.sh', ['lojax.com.br']).stdout, /s3 rm s3:\/\/sites-teste\/lojax\.com\.br\//);
  assert.equal(roda('criar.sh', ['../../etc']).status, 2);
  assert.equal(roda('criar.sh', ['lojax.com.br'], { DISTRIBUICAO: '' }).status, 2);
  assert.equal(roda('remover.sh', ['x.com.br; rm -rf /']).status, 2);
});
