// Componentes: pedaços prontos do site (filtro, estoque...) que QUALQUER tema e QUALQUER página usam, todos da
// mesma pasta (componentes/<nome>/), altamente customizáveis por opções (cores, layout, textos, o que aparece).
//
//   componentes/<nome>/componente.json   { "nome", "descricao", "opcoes": { "<opcao>": { "padrao", "tipo", "valores", "css", "descricao" } } }
//   componentes/<nome>/<nome>.html       o HTML (mini-renderer: {{op.<opcao>}}, {{#op.x}}...{{/op.x}}, e tudo do site: {{site.nome}}...)
//   componentes/<nome>/<nome>.css        opcional: entra sozinho no <head> da página que usa o componente
//   componentes/<nome>/<nome>.js         opcional: entra sozinho no fim do <body>
//   "scripts" no componente.json         scripts do site que o componente precisa (ex.: o motor do estoque): o build põe
//                                        no fim do <body> se a página ainda não tiver (funciona em qualquer tema)
//
// Como chamar:
//   tema:      {{componente estoque colunas=280 whatsapp=false titulo="{{listagem.h1}}"}}   (valor pode ter {{ }} do site)
//   página:    { "tipo": "componente", "nome": "estoque", "opcoes": { "porPagina": 8 } }
//   site:      sites-config/<dominio>/componentes/estoque.json  { "cor": "#c00000" }  (vale para todas as páginas do site)
// Camadas (cada uma vale mais que a anterior): padrão do componente < tema < site (componentes/<nome>.json) < página.
//
// Tipos de opção: "texto" (padrão), "numero", "booleano", "cor" (#rgb, #rrggbb, rgb(), hsl(), var(--x)), "lista" (texto
// separado por vírgula, vira lista para {{#op.x}}). "valores": [...] restringe. "css": "--c-cor" põe o valor numa variável
// CSS do próprio componente (style="--c-cor:#c00"): cores mudam SÓ naquele componente, sem mexer no resto da página.
// Opção desconhecida ou valor inválido: erro claro (erro de digitação não passa em silêncio).
const fs = require('fs');
const path = require('path');
const C = require('./caminhos');

const NOME_OK = /^[a-z0-9][a-z0-9-]*$/;
const COR_OK = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|var\(--[a-z0-9-]+\)|transparent|currentColor)$/i;
const cache = new Map();

const listar = () => (fs.existsSync(C.COMPONENTES) ? fs.readdirSync(C.COMPONENTES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(C.COMPONENTES, e.name, 'componente.json'))).map((e) => e.name).sort() : []);
const existe = (nome) => NOME_OK.test(String(nome)) && fs.existsSync(path.join(C.COMPONENTES, nome, 'componente.json'));

function carregar(nome) {
  if (cache.has(nome)) return cache.get(nome);
  if (!existe(nome)) throw new Error(`componente "${nome}" não existe (componentes/${nome}/componente.json; existem: ${listar().join(', ') || 'nenhum'})`);
  const dir = path.join(C.COMPONENTES, nome);
  const def = JSON.parse(fs.readFileSync(path.join(dir, 'componente.json'), 'utf8'));
  const arq = (ext) => (fs.existsSync(path.join(dir, `${nome}.${ext}`)) ? path.join(dir, `${nome}.${ext}`) : null);
  if (!arq('html')) throw new Error(`componente "${nome}": falta componentes/${nome}/${nome}.html`);
  const c = { nome, def, opcoes: def.opcoes || {}, html: fs.readFileSync(arq('html'), 'utf8'), css: arq('css'), js: arq('js') };
  cache.set(nome, c);
  return c;
}
const limparCache = () => cache.clear();

// confere e converte UM valor de opção → [valor, erro]
function conferir(nome, chave, def, v) {
  const tipo = def.tipo || (typeof def.padrao === 'boolean' ? 'booleano' : typeof def.padrao === 'number' ? 'numero' : 'texto');
  if (tipo === 'booleano') { if (v === 'true') v = true; if (v === 'false') v = false; if (typeof v !== 'boolean') return [v, `${nome}.${chave}: use true ou false`]; }
  else if (tipo === 'numero') { if (typeof v === 'string' && v.trim() !== '' && !isNaN(v)) v = Number(v); if (typeof v !== 'number' || !isFinite(v)) return [v, `${nome}.${chave}: precisa ser número`]; }
  else if (tipo === 'cor') { if (v !== '' && !COR_OK.test(String(v))) return [v, `${nome}.${chave}: cor inválida "${v}" (ex.: #c00000)`]; }
  else if (tipo === 'lista') { if (Array.isArray(v)) v = v.join(','); if (typeof v !== 'string') return [v, `${nome}.${chave}: lista separada por vírgula (ex.: "ano,km")`]; }
  else if (typeof v !== 'string') v = String(v);
  if (Array.isArray(def.valores)) {
    const itens = tipo === 'lista' ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : [v];
    const fora = itens.filter((x) => !def.valores.includes(x));
    if (fora.length) return [v, `${nome}.${chave}: "${fora.join(', ')}" não vale (use: ${def.valores.join(', ')})`];
  }
  return [v, null];
}

// junta as camadas de opções (cada uma vale mais que a anterior) → { op, erros }
function mesclar(nome, camadas) {
  const c = carregar(nome);
  const op = Object.fromEntries(Object.entries(c.opcoes).map(([k, d]) => [k, d.padrao]));
  const erros = [];
  for (const { origem, opcoes } of camadas) {
    for (const [k, v] of Object.entries(opcoes || {})) {
      if (!c.opcoes[k]) { erros.push(`${origem}: o componente "${nome}" não tem a opção "${k}" (tem: ${Object.keys(c.opcoes).join(', ')})`); continue; }
      const [valor, erro] = conferir(nome, k, c.opcoes[k], v);
      if (erro) erros.push(`${origem}: ${erro}`); else op[k] = valor;
    }
  }
  return { op, erros };
}

// valida as opções de um componente sem renderizar (cadastro do site, página pela API)
function validar(nome, opcoes, origem = 'opções') {
  if (!existe(nome)) return [`componente "${nome}" não existe (existem: ${listar().join(', ') || 'nenhum'})`];
  if (opcoes != null && (typeof opcoes !== 'object' || Array.isArray(opcoes))) return [`${origem}: as opções do componente "${nome}" precisam ser um objeto`];
  return mesclar(nome, [{ origem, opcoes }]).erros;
}

// atributos de {{componente nome a=1 b="x" c=true}} → objeto (valores entre aspas passam pelo renderizador: aceitam {{site.nome}})
function lerAtributos(txt, renderTexto) {
  const r = {};
  for (const m of String(txt || '').matchAll(/([a-zA-Z][\w]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g)) {
    r[m[1]] = m[4] !== undefined ? m[4] : renderTexto(m[2] !== undefined ? m[2] : m[3]);
  }
  return r;
}

// HTML de um componente: opções finais em {{op.*}}, variáveis CSS do componente em {{{componente.estilo}}}
function renderizar(nome, camadas, ctx, render, onde) {
  const c = carregar(nome);
  const { op, erros } = mesclar(nome, camadas);
  if (erros.length) throw new Error(`${onde}: ${erros.join('; ')}`);
  const estilo = Object.entries(c.opcoes).filter(([k, d]) => d.css && op[k] !== '' && op[k] != null)
    .map(([k, d]) => `${d.css}:${String(op[k]).replace(/[<>{};"]/g, '')}${d.tipo === 'numero' && d.unidade ? d.unidade : ''}`).join(';');
  // listas viram arrays (para {{#op.campos}}...{{/op.campos}}); cada item também como { item: true } para testar presença
  const opRender = { ...op };
  for (const [k, d] of Object.entries(c.opcoes)) if (d.tipo === 'lista') {
    const itens = String(op[k] || '').split(',').map((x) => x.trim()).filter(Boolean);
    opRender[k] = itens;
    opRender[`${k}Tem`] = Object.fromEntries(itens.map((x) => [x, true]));
    opRender[`${k}Texto`] = itens.join(','); // a lista como texto (para data-* que o JS lê)
  }
  return render(c.html, { ...ctx, op: opRender, componente: { nome, estilo } });
}

// troca cada {{componente ...}} do texto do tema pelo HTML do componente → { texto, usados }
const TAG = /\{\{componente\s+([a-z0-9-]+)((?:\s+[a-zA-Z]\w*=(?:"[^"]*"|'[^']*'|[^\s"'}]+))*)\s*\}\}/g;
// camadas: tema (atributos) < site (componentes/<nome>.json) < página (opcoesPagina: ex. web/multipla.json "componentes")
function expandir(texto, ctx, render, { opcoesSite = {}, opcoesPagina = {}, ondePagina = 'página', onde = 'tema' } = {}) {
  const usados = new Set();
  const saida = texto.replace(TAG, (_, nome, atributos) => {
    usados.add(nome);
    const doTemplate = lerAtributos(atributos, (t) => render(t, ctx));
    return renderizar(nome, [{ origem: onde, opcoes: doTemplate }, { origem: `componentes/${nome}.json do site`, opcoes: opcoesSite[nome] },
      { origem: ondePagina, opcoes: opcoesPagina[nome] }], ctx, render, onde);
  });
  return { texto: saida, usados };
}

// <link> do css e <script> do js dos componentes usados (o build põe no <head> / fim do <body>)
function arquivosDe(usados) {
  const css = [], js = [], scripts = [];
  for (const n of usados) {
    const c = carregar(n);
    if (c.css) css.push(`componentes/${n}.css`);
    for (const s of c.def.scripts || []) if (!scripts.includes(s)) scripts.push(s);
    if (c.js) js.push(`componentes/${n}.js`);
  }
  return { css, js: [...scripts, ...js] };
}

module.exports = { conferir,  listar, existe, carregar, mesclar, validar, renderizar, expandir, arquivosDe, lerAtributos, limparCache, TAG };
