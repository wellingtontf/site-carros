// Versões congeladas do motor (core/motor/v1, v2...). O rascunho fica de fora: site nenhum roda com ele em produção.
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');

const versoesMotor = () => fs.readdirSync(C.MOTOR).filter((v) => v !== 'rascunho' && fs.existsSync(path.join(C.motor(v), 'engine.js')))
  .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
const ultimaVersao = () => versoesMotor().pop() || null;

module.exports = { versoesMotor, ultimaVersao };
