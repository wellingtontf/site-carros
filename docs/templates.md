# Templates

Um template é **um visual** usado por vários sites. Fica inteiro em `templates/<nome>/` (nada solto na raiz de
`templates/`), sem base compartilhada com outros templates. Hoje há `barra-topo`, `lateral`, `trokey` e `template-basico`.
Um inquilino pode ter templates próprios em `inquilinos/<id>/templates/<nome>/`, que valem só para ele e substituem o de
mesmo nome.

```
templates/<nome>/
  template.json        nome e descrição
  paginas/             UM ARQUIVO POR TIPO DE PÁGINA (os 5 são obrigatórios)
  blocos/              um HTML por tipo de bloco (banner, vitrine, texto...)
  parciais/            pedaços reaproveitados com {{> nome}} (cabeçalho, rodapé, head)
  paginas-padrao/      contato, financiamento, avaliação, privacidade, cookies, LGPD (JSON)
  paginas-extras/      páginas HTML que todo site do template ganha
  css/  js/  img/      arquivos do template (vão para o site como estão)
```

## Os 5 arquivos de `paginas/`

| Arquivo | Página do site |
|---|---|
| `home.html` | a página principal (`/`), com os blocos de `web/index.json` em `{{{conteudo}}}` |
| `multipla.html` | a listagem do estoque (`/multipla/` e todas as rotas `/multipla/...`) |
| `carro.html` | a página de cada carro |
| `vendido.html` | o carro que saiu ("não está mais disponível", `noindex`) |
| `pagina.html` | a moldura das páginas de conteúdo (`/paginas/...`) e da 404 |

Faltou algum, ou um dos blocos obrigatórios (`banner`, `vitrine`, `titulo`, `texto`, `formulario`, `lojas`): o build para
com "falta paginas/x.html". Todas as páginas precisam carregar `{{rel}}motor/ui-site.js` (aviso de cookies, formulários).

## A listagem (`multipla.html`)

Os 4 templates montam a listagem com componentes:
```html
<body data-page="lista" data-base="{{base}}" data-rel="{{rel}}">
{{{blocosAntes}}}
<main>
  {{componente filtro layout="lateral" titulo="Filtrar"}}
  <section>{{componente filtros-ativos}}{{componente estoque titulo="{{listagem.h1}}" tituloTag="h1" porPagina=24}}</section>
</main>
{{{blocosDepois}}}
```
- `{{{blocosAntes}}}` e `{{{blocosDepois}}}` são obrigatórios (os blocos de `web/multipla.json`; um teste cobra).
- `data-rel="{{rel}}"` no `<body>` é obrigatório: é por ele que o JS acha `estoque.json` e `config.json`.
- Marcadores da listagem: `{{listagem.titulo}}`, `{{listagem.descricao}}`, `{{{listagem.canon}}}`, `{{listagem.h1}}`.
- O build põe sozinho, no `<head>`, o script que acerta o `<base>` nas rotas (`/multipla/a/b/c`) e o CSS dos
  componentes, e no fim do `<body>` os scripts que eles precisam.

Sem componentes (HTML antigo) também funciona: a `core/ui/ui-lista.js` procura os ids `grade` e `tpl-card`
(obrigatórios) e, se existirem, `q`, `filtros-dinamicos`, `ord`, `contagem`, `mais`, `limpar`, `copiar` e
`filtros-ativos`. Peça que falta simplesmente não aparece. Um id repetido na página é erro no build.

## O card

O HTML de cada card fica em `<script type="text/html" id="tpl-card">` (o componente `estoque` já traz um), com os campos
entre colchetes duplos:

`[[nome]] [[versao]] [[ano]] [[km]] [[cambio]] [[cor]] [[combustivel]] [[carroceria]] [[preco]] [[loja]] [[local]]
[[lojaLocal]] [[href]] [[imgattrs]] [[zap]] [[id]]` (`[[zap]]` = link do WhatsApp do carro).

O build monta os primeiros cards (24, ou o `data-pagina` do `#grade`) com esse mesmo modelo, direto no HTML (Google e quem
está sem JS); no navegador, a `ui-lista` assume.

## Marcadores

| Marcador | O quê |
|---|---|
| `{{x}}` | texto, escapado |
| `{{{x}}}` | HTML cru (só o que o build gera) |
| `{{#x}}...{{/x}}` | mostra se tiver valor; repete se for lista |
| `{{^x}}...{{/x}}` | mostra se NÃO tiver valor |
| `{{> nome}}` | inclui `parciais/nome.html` |
| `{{componente nome op=valor}}` | um componente ([componentes.md](componentes.md)) |

Dados disponíveis: `{{site.nome}}`, `{{site.slogan}}`, `{{site.url}}`, `{{site.textos.*}}`, `{{site.cabecalho.*}}`,
`{{site.rodape.*}}`, `{{#site.links}}` (páginas com `rotulo`), `{{tema.*}}`, `{{rel}}` (prefixo até a raiz),
`{{inicioUrl}}`, `{{estoqueUrl}}`, `{{base}}` (fotosBase), `{{{temaCss}}}`, `{{{fonteLink}}}`, `{{motor}}` e `{{estoque.*}}`
(total, destaques, marcas, cidades, carrocerias, combustíveis e lojas, cada item com `valor`, `total`, `link`, `chave`).

## Regras ao escrever um template

- Referencie arquivos sempre com `{{rel}}`: `{{rel}}css/style.css`, `{{rel}}motor/engine.js`. A página pode estar em
  qualquer profundidade.
- Imagens do tema com caminho relativo (`assets/logo.png`) já chegam com o prefixo certo em `{{tema.logo}}`.
- Cores, cantos, fonte e colunas por variáveis CSS: `--cor`, `--fundo`, `--texto`, `--raio`, `--fonte`, `--colunas`
  (vêm do `tema` do site via `{{{temaCss}}}`).
- css e js do template saem com `?v=<hash>` e entram no hash das páginas: mudar o css refaz as páginas do site com o
  `?v` novo. Os do core (`motor/`) não entram, por isso a `core/ui` precisa continuar funcionando com HTML antigo.
- Editar `paginas-padrao/` ou `paginas-extras/` não refaz as páginas de carro (ficam fora do hash).

## Criar um template

1. Copie um template parecido: `cp -r templates/barra-topo templates/meu-template`.
2. Ajuste `template.json`, os 5 arquivos de `paginas/`, `css/` e os blocos.
3. Use num site: `"template": "meu-template"` no `site.json` (ou libere para o inquilino em `inquilino.json`).
4. `npm test`: o teste de templates confere arquivos obrigatórios, blocos, ids, links quebrados e marcadores sobrando
   em todos os templates.
