# Componentes

Pedaços prontos do site que **qualquer template e qualquer página** usam, todos daqui. Cada componente é altamente
customizável por opções: cores, layout, textos e o que aparece.

| Componente | O que é |
|---|---|
| `filtro` | busca e filtros do estoque (quais filtros aparecem vem do `"filtros"` do site.json) |
| `estoque` | a lista de carros (cards), com contagem, ordenação e "carregar mais" |

Para ver **todas as opções** de cada um, com padrão e valores aceitos: `node core/cli.js componentes`.

## Como usar

**No template** (`templates/<nome>/paginas/*.html`):

```html
{{componente filtro layout="topo" cor="#c00000"}}
{{componente estoque titulo="{{listagem.h1}}" tituloTag="h1" colunas=280 campos="ano,km,cambio" estiloCampos="chips"}}
```

Texto vai entre aspas e pode usar dados do site (`"{{site.nome}}"`). Número e `true`/`false` vão sem aspas.

**Numa página** (`sites-config/<dominio>/paginas/<nome>.json`, ou `PUT /v1/sites/<d>/paginas/<nome>` pela API):

```json
{ "titulo": "Home", "blocos": [
  { "tipo": "componente", "nome": "estoque", "opcoes": { "titulo": "Destaques", "porPagina": 8, "ordenacao": false, "botaoEstoque": "Ver estoque completo" } }
] }
```

**No site inteiro** (`site.json`, ou `PATCH /v1/sites/<d>` pela API):

```json
"componentes": { "estoque": { "preco": "#0533ce", "whatsapp": false } }
```

**Quem vale mais:** padrão do componente < template < `site.json` < página. Exemplo: o template pede 24 carros por vez, o site
pede 6 e a home pede 2 → a listagem mostra 6 e a home mostra 2.

O build sozinho: põe o CSS do componente no `<head>`, põe os scripts que ele precisa (o motor do estoque) no fim do `<body>`
sem repetir, e para com mensagem clara se uma opção não existe, se um valor é inválido (cor errada, layout que não existe)
ou se a página ficou com dois componentes que não podem se repetir (dois `estoque`, por exemplo).

## Criar um componente

```
componentes/<nome>/
  componente.json   { "nome", "descricao", "scripts": [...], "opcoes": { "<opcao>": { "padrao", "tipo", "valores", "css", "unidade", "descricao" } } }
  <nome>.html       o HTML, com as opções em {{op.<opcao>}} e {{#op.<opcao>}}...{{/op.<opcao>}}, e tudo do site ({{site.nome}}, {{estoque.total}}...)
  <nome>.css        opcional; use classes com prefixo c-<nome> para não brigar com o template
  <nome>.js         opcional
```

- **Tipos de opção:** `texto` (padrão), `numero`, `booleano`, `cor`, `lista` (texto separado por vírgula; vira lista em `{{#op.x}}`). `"valores"` restringe o que é aceito.
- **Cores por componente:** `"css": "--c-cor"` põe o valor numa variável CSS só daquele componente (`style="--c-cor:#c00"` no elemento principal: use `style="{{{componente.estilo}}}"`). No CSS, use `var(--c-cor, var(--cor))`: sem a opção, vale a cor do tema do site.
- **Componente nunca precisa mexer no core:** o que ele precisa do site (motor, dados) vai em `"scripts"`.
