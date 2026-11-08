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

**Numa página** (`sites-config/<dominio>/web/paginas/<nome>.json` (a home: `web/index.json`), ou `PUT /v1/sites/<d>/paginas/<nome>` pela API):

```json
{ "titulo": "Home", "blocos": [
  { "tipo": "componente", "nome": "estoque", "opcoes": { "titulo": "Destaques", "porPagina": 8, "ordenacao": false, "botaoEstoque": "Ver estoque completo" } }
] }
```

**Na listagem (`/multipla/`)**: os componentes que o template põe na página (filtro, estoque) recebem opções só desta página
em `sites-config/<dominio>/web/multipla.json` (pela API: `PUT /v1/sites/<d>/multipla`):

```json
// sites-config/lojateste.com.br/web/multipla.json: estes filtros viram caixas de marcar (várias escolhas)
{ "componentes": { "filtro": { "checkbox": "estado,cidade,marca,modelo,carroceria" } } }
```

**Filtro com caixas de marcar:** a opção `checkbox` do componente `filtro` lista os campos que deixam de ser combo e viram
caixas de marcar (escolher mais de um: Audi **e** BMW). Vale para estado, cidade, loja, marca, modelo, carroceria, ano,
câmbio, combustível e cor (preço e km continuam "até X"). Precisa do motor v3 (com motor antigo o campo continua combo).
`checkboxAberto: true` deixa as listas abertas; `checkboxAltura` (px) limita a altura de cada lista. As escolhas vão para o
endereço como rota (`/multipla/marca/audi|bmw`), e quem chega por um link assim vê as caixas já marcadas.

**No site inteiro**: um arquivo por componente em `sites-config/<dominio>/componentes/<nome>.json` (pela API: `PUT /v1/sites/<d>/componentes/<nome>`):

```json
// sites-config/lojateste.com.br/componentes/estoque.json
{ "preco": "#0533ce", "whatsapp": false }
```

**Quem vale mais:** padrão do componente < template < `sites-config/<dominio>/componentes/<nome>.json` < página (bloco da página, ou `componentes` do `web/multipla.json`). Exemplo: o template pede 24 carros por vez, o site
pede 6 e a home pede 2 → a listagem mostra 6 e a home mostra 2.

O build sozinho: põe o CSS do componente no `<head>`, põe os scripts que ele precisa (o motor do estoque) no fim do `<body>`
sem repetir, e para com mensagem clara se uma opção não existe, se um valor é inválido (cor errada, layout que não existe)
ou se a página ficou com dois componentes que não podem se repetir (dois `estoque`, por exemplo).

## Filtros ativos ("chips")
O componente `filtros-ativos` mostra uma etiqueta para cada filtro aplicado (e para o texto buscado), com um X que tira só
aquele, e o botão "Limpar busca" que tira todos. Fica sincronizado com o `filtro`: tirar a etiqueta desmarca a caixa/zera o
combo, e mexer no filtro atualiza as etiquetas e o endereço. Some quando não há filtro. Os 4 templates já o põem logo acima
do estoque na `/multipla/`. Opções: `rotulos` ("Marca: Audi"), `maiusculas`, `busca`, `textoLimpar`, cores (`cor`,
`fundo`, `texto`, `raio`) e `mostrar: false` para tirar (ex.: no `web/multipla.json` de um site).

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
