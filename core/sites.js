// Cadastro de um site (sites/<dominio>/site.json): validar e gravar. Usado pela API (criar/atualizar site) e por
// quem mais precisar; o core não sabe quem chamou.
//   validarSite(obj, dominio) → [erros]   (vazio = pode gravar)
//   gravarSite(dominio, obj)  → { criado }  (guarda o anterior em .estado/sites-anteriores/<dominio>.json)
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');
const { ID_SITE } = require('./build');

const txt = (v) => typeof v === 'string' && v.trim() !== '';
const ID_LOJA = /^[a-z0-9][a-z0-9-]{0,40}$/;
const lerJSON = (p, padrao) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; } };

function validarSite(s, dominio) {
  const erros = [];
  const e = (m) => { if (erros.length < 30) erros.push(m); };
  if (!ID_SITE.test(String(dominio))) e(`domínio inválido "${dominio}" (ex.: minhaloja.com.br, só minúsculas)`);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [...erros, 'o cadastro precisa ser um objeto JSON'];
  if ('id' in s) e('"id" não vai no cadastro: o id do site é o domínio (o endereço da chamada)');
  if (!txt(s.nome)) e('"nome" vazio ou ausente');
  if (!txt(s.template)) e('"template" vazio ou ausente');
  else if (!/^[a-z0-9-]+$/.test(s.template) || !fs.existsSync(path.join(C.template(s.template), 'template.json'))) e(`template "${s.template}" não existe`);
  if (!txt(s.motor)) e('"motor" vazio ou ausente (ex.: "v2")');
  else if (!/^[a-z0-9]+$/.test(s.motor) || !fs.existsSync(path.join(C.motor(s.motor), 'engine.js'))) e(`motor "${s.motor}" não existe`);
  if (s.url != null && !(typeof s.url === 'string' && /^https:\/\/[^\s/]+\/?$/i.test(s.url))) e('"url" precisa ser https://dominio (sem caminho)');
  if (s.fotosBase != null && !(typeof s.fotosBase === 'string' && /^https?:\/\/\S+\/$/i.test(s.fotosBase))) e('"fotosBase" precisa ser uma URL terminada em "/"');
  if (s.whatsapp != null && !/^\d{10,15}$/.test(String(s.whatsapp))) e('"whatsapp" só com números, com DDI e DDD (ex.: 5541999990000)');
  for (const k of ['paginas', 'filtros', 'ordenacao']) if (s[k] != null && !Array.isArray(s[k])) e(`"${k}" deve ser lista`);
  // lojas: pelo menos uma; cada carro do estoque aponta para uma delas
  const lojas = s.lojas && typeof s.lojas === 'object' && !Array.isArray(s.lojas) ? s.lojas : null;
  if (!lojas || !Object.keys(lojas).length) e('"lojas" precisa ter pelo menos uma loja: { "matriz": { "nome", "cidade", "uf" } }');
  else for (const [id, l] of Object.entries(lojas)) {
    if (!ID_LOJA.test(id)) e(`loja "${id}": id só com minúsculas, números e hífen`);
    if (!l || !txt(l.nome) || !txt(l.cidade) || !/^[A-Z]{2}$/.test(String(l && l.uf))) e(`loja "${id}": precisa de "nome", "cidade" e "uf" (2 letras maiúsculas)`);
  }
  // blocos das páginas precisam existir no template (senão o build para)
  if (Array.isArray(s.paginas) && txt(s.template)) {
    s.paginas.forEach((p, i) => (p && Array.isArray(p.blocos) ? p.blocos : []).forEach((b) => {
      if (!b || !/^[a-z0-9-]+$/.test(String(b.tipo)) || !fs.existsSync(path.join(C.template(s.template), 'blocos', `${b.tipo}.html`))) e(`página ${i + 1}: bloco "${b && b.tipo}" não existe no template "${s.template}"`);
    }));
  }
  // o estoque que já está no ar precisa continuar válido com as lojas novas
  if (lojas && Object.keys(lojas).length) {
    const ids = Object.keys(lojas);
    const ruins = (lerJSON(C.estoque(dominio), { carros: [] }).carros || []).filter((c) => (c.loja != null ? !ids.includes(c.loja) : ids.length !== 1));
    if (ruins.length) e(`${ruins.length} carro(s) do estoque atual ficariam sem loja (ex.: ${ruins[0].id} → "${ruins[0].loja ?? '(sem loja)'}"); mande o estoque novo junto ou mantenha a loja`);
  }
  return erros;
}

function gravarSite(dominio, obj) {
  const arq = C.siteJson(dominio);
  const criado = !fs.existsSync(arq);
  if (!criado) {
    fs.mkdirSync(path.join(C.ESTADO, 'sites-anteriores'), { recursive: true });
    fs.copyFileSync(arq, path.join(C.ESTADO, 'sites-anteriores', `${dominio}.json`));
  }
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(`${arq}.tmp`, arq);
  return { criado };
}

module.exports = { validarSite, gravarSite };
