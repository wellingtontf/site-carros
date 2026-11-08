# Componentes

Peças prontas que **qualquer tema e qualquer página** usam, todas da pasta `componentes/` (não existe componente por
tema). Cada componente é configurável por opções: cores, layout, textos e o que aparece.

| Componente | O que é |
|---|---|
| `filtro` | busca e filtros do estoque (quais filtros aparecem vem do `"filtros"` do `site.json`); combos ou caixas de marcar |
| `estoque` | a lista de carros (cards), com contagem, ordenação e "carregar mais" |
| `filtros-ativos` | as etiquetas ("chips") dos filtros aplicados, com ✕ para tirar cada um e "Limpar busca" |

Os 3 temas usam os três na `/multipla/`. Para ver as opções no terminal: `node core/cli.js componentes`.

## Como usar

**No tema** (`temas/<nome>/templates/*.html`):
```html
{{componente filtro layout="topo" cor="#c00000"}}
{{componente estoque titulo="{{listagem.h1}}" tituloTag="h1" colunas=280 campos="ano,km,cambio" estiloCampos="chips"}}
```
Texto vai entre aspas e pode usar dados do site (`"{{site.nome}}"`). Número e `true`/`false` vão sem aspas.

**Numa página de seções** (`web/index.json`, `web/paginas/<nome>.json`, ou `PUT /v1/sites/<d>/paginas/<nome>`):
```json
{ "titulo": "Home", "secoes": [
  { "tipo": "componente", "nome": "estoque", "opcoes": { "titulo": "Destaques", "porPagina": 8, "ordenacao": false, "botaoEstoque": "Ver estoque completo" } }
] }
```

**Na listagem** (`web/multipla.json`, ou `PUT /v1/sites/<d>/multipla`): opções só desta página para os componentes que o
tema põe na `/multipla/`:
```json
{ "componentes": { "filtro": { "checkbox": "estado,cidade,marca,modelo,carroceria" }, "filtros-ativos": { "rotulos": true } } }
```

**No site inteiro** (`sites-config/<dominio>/componentes/<nome>.json`, ou `PUT /v1/sites/<d>/componentes/<nome>`):
```json
{ "preco": "#0533ce", "whatsapp": false }
```

### Quem vale mais

**padrão do componente < tema < site (`componentes/<nome>.json`) < página** (seção da página, ou `"componentes"` do
`web/multipla.json`). Exemplo: o tema pede 24 carros por vez, o site pede 6 e a home pede 2 → a listagem mostra 6 e
a home mostra 2.

### O build cuida sozinho de

- pôr o CSS do componente no `<head>` e os scripts que ele precisa no fim do `<body>`, sem repetir;
- parar com mensagem clara se uma opção não existe, se um valor é inválido (cor errada, layout que não existe) ou se a
  página ficou com dois componentes que não podem se repetir (dois `estoque`, por exemplo);
- validar as opções também na API (422) e no `web/multipla.json`.

## Filtro com caixas de marcar

A opção `checkbox` do `filtro` lista os campos que deixam de ser combo e viram **caixas de marcar** (escolher mais de um:
Audi **e** BMW). Vale para estado, cidade, loja, marca, modelo, carroceria, ano, câmbio, combustível e cor (preço e km
continuam "até X"). Precisa do **motor v3**; com motor antigo, o campo continua combo.

- Cada campo vira um quadro com o nome e o número de marcados ("Marca 2 ▴"), que abre e fecha. `checkboxAberto: true`
  deixa todos abertos; `checkboxAltura` (px) limita a altura de cada lista.
- As escolhas vão para o endereço como rota (`/multipla/marca/audi|bmw`); quem chega por um link assim encontra as caixas
  marcadas e o quadro aberto.
- Valor do link sem carro no estoque aparece marcado (a lista mostra "Nenhum carro encontrado").
- Exemplo real: a lojateste usa caixas em estado, cidade, marca, modelo e carroceria (no `web/multipla.json` dela), e a
  primeseminovos, com o mesmo tema, continua com combos.

## Filtros ativos ("chips")

O `filtros-ativos` mostra uma etiqueta para cada filtro aplicado (cada valor: Curitiba, Audi, BMW...) e para o texto
buscado. O ✕ tira só aquele valor; "Limpar busca" tira todos. Fica **sincronizado** com o `filtro`: tirar a etiqueta
desmarca a caixa/zera o combo, e mexer no filtro atualiza as etiquetas e o endereço. Some quando não há filtro.

- Os 3 temas o põem logo acima do estoque: `<section>{{componente filtros-ativos}}{{componente estoque ...}}</section>`.
- Para tirar de um site: `{ "mostrar": false }` em `componentes/filtros-ativos.json` (site inteiro) ou
  `{ "componentes": { "filtros-ativos": { "mostrar": false } } }` no `web/multipla.json`. Para todos os sites de um tema:
  apagar a chamada do `multipla.html`, ou `{{componente filtros-ativos mostrar=false}}`.

## Todas as opções

### `filtro`
| Opção | Padrão | Tipo / valores | O que faz |
|---|---|---|---|
| `layout` | "lateral" | texto: lateral, topo | lateral = coluna ao lado da lista; topo = barra acima da lista |
| `titulo` | "Filtrar" | texto | título do quadro ("" esconde) |
| `busca` | true | booleano | campo de busca por texto |
| `checkbox` | "" | lista: estado, cidade, loja, marca, modelo, carroceria, ano, cambio, combustivel, cor | campos que viram caixas de marcar (escolher mais de um), separados por vírgula: "estado,cidade,marca". Precisa do motor v3; com motor antigo o campo continua um combo |
| `checkboxAberto` | false | booleano | caixas de marcar já abertas (true) ou fechadas até clicar no nome do filtro (false) |
| `checkboxAltura` | (vazio) | numero (px) | altura máxima de cada lista de caixas, em px (vazio = 220; rola quando passa) |
| `textoBusca` | "" | texto | texto de dica da busca (vazio = textos.busca do site) |
| `botaoLimpar` | "Limpar filtros" | texto | texto do botão ("" esconde) |
| `botaoCopiar` | "Copiar link da busca" | texto | texto do botão ("" esconde) |
| `cor` | "" | cor | botão principal e destaque (vazio = cor do tema) |
| `fundo` | "" | cor | fundo do quadro |
| `texto` | "" | cor | cor do texto |
| `borda` | "" | cor | cor das bordas |
| `raio` | (vazio) | numero (px) | arredondamento dos cantos, em px (vazio = do tema) |

### `estoque`
| Opção | Padrão | Tipo / valores | O que faz |
|---|---|---|---|
| `titulo` | "" | texto | título acima da lista ("" esconde; aceita {{listagem.h1}}) |
| `tituloTag` | "h2" | texto: h1, h2, h3 | h1 na página do estoque (SEO), h2 dentro de outras páginas |
| `contagem` | true | booleano | mostra "60 carros" |
| `ordenacao` | true | booleano | mostra o seletor de ordenação |
| `rotuloOrdenacao` | "Ordenar por" | texto | texto ao lado do seletor de ordenação |
| `porPagina` | 24 | numero | cards por vez ("carregar mais" traz os próximos) |
| `botaoMais` | "Carregar mais veículos" | texto | texto do botão que traz mais cards |
| `botaoEstoque` | "" | texto | link para o estoque completo ("" esconde; útil na home) |
| `colunas` | 250 | numero (px) | largura mínima de cada card, em px (menor = mais colunas) |
| `foto` | true | booleano | mostra a foto do carro |
| `versao` | true | booleano | mostra a versão (XEi 2.0...) |
| `campos` | "ano,km,cambio,combustivel" | lista: ano, km, cambio, combustivel, cor, carroceria | informações do card, na ordem |
| `estiloCampos` | "linha" | texto: linha, chips | linha = separadas por ponto; chips = etiquetas |
| `local` | true | booleano | mostra loja/cidade |
| `botaoDetalhes` | "Ver detalhes" | texto | texto do botão ("" esconde) |
| `whatsapp` | true | booleano | botão de WhatsApp em cada card |
| `cor` | "" | cor | botões (vazio = cor do tema) |
| `preco` | "" | cor | cor do preço |
| `fundo` | "" | cor | fundo dos cards |
| `texto` | "" | cor | cor do texto |
| `borda` | "" | cor | borda dos cards |
| `raio` | (vazio) | numero (px) | arredondamento dos cards, em px |

### `filtros-ativos`
| Opção | Padrão | Tipo / valores | O que faz |
|---|---|---|---|
| `mostrar` | true | booleano | false tira o componente da página (ex.: web/multipla.json de um site que não quer) |
| `rotulos` | false | booleano | mostra o nome do filtro na etiqueta ("Marca: Audi") em vez de só o valor ("Audi") |
| `maiusculas` | true | booleano | etiquetas em letras maiúsculas |
| `busca` | true | booleano | o texto buscado também vira etiqueta |
| `textoLimpar` | "Limpar busca" | texto | texto do botão que tira todos os filtros ("" esconde) |
| `cor` | "" | cor | botão de limpar (vazio = cor do tema) |
| `fundo` | "" | cor | fundo das etiquetas |
| `texto` | "" | cor | texto das etiquetas |
| `raio` | (vazio) | numero (px) | arredondamento das etiquetas, em px (vazio = do tema) |


## Criar um componente

```
componentes/<nome>/
  componente.json   { "nome", "descricao", "scripts": [...], "opcoes": { "<opcao>": { "padrao", "tipo", "valores", "css", "unidade", "descricao" } } }
  <nome>.html       o HTML, com as opções em {{op.<opcao>}} e {{#op.<opcao>}}...{{/op.<opcao>}}, e tudo do site ({{site.nome}}, {{estoque.total}}...)
  <nome>.css        opcional; use classes com prefixo c-<nome> para não brigar com o tema
  <nome>.js         opcional
```

- **Toda opção precisa de `padrao`** (um teste cobra).
- **Tipos de opção:** `texto` (padrão), `numero`, `booleano`, `cor` (#rgb, #rrggbb, rgb(), hsl(), var(--x)), `lista`
  (texto separado por vírgula; vira lista em `{{#op.x}}`, presença em `{{#op.xTem.valor}}` e texto em
  `{{op.xTexto}}`). `"valores"` restringe o que é aceito.
- **Cores por componente:** `"css": "--c-cor"` põe o valor numa variável CSS só daquele componente (use
  `style="{{{componente.estilo}}}"` no elemento principal). No CSS, `var(--c-cor, var(--cor))`: sem a opção, vale a cor do tema.
- **Componente nunca precisa mexer no core:** o que ele precisa do site (motor, dados) vai em `"scripts"`. A lógica da
  listagem (filtro, estoque, filtros ativos) mora na `core/ui/ui-lista.js`, que liga as peças pelos ids.
- `README.md` na raiz de `componentes/` fica fora do hash: editar não refaz páginas. Mexer numa pasta de componente
  refaz as páginas dos sites que o usam.
