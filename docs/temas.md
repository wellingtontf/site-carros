# Temas

Um **tema** é o visual de vários sites: a estrutura das páginas, as seções, o CSS. A estrutura e os nomes seguem o padrão
do Shopify (decisão do Wellington, 2026-11-08), o mais conhecido do mercado para "muitos sites, poucos visuais".

Cada tema fica inteiro em `temas/<nome>/` (nada solto na raiz de `temas/`), sem base compartilhada com outros temas.
Hoje há `barra-topo`, `lateral` e `template-basico`. Um inquilino pode ter temas próprios em
`inquilinos/<id>/temas/<nome>/`, que valem só para ele e substituem o de mesmo nome.

## Tema × configurações × template

| Palavra | O que é | Onde mora |
|---|---|---|
| **tema** | o pacote visual inteiro (o web designer faz) | `temas/<nome>/`; o site escolhe com `"tema": "<nome>"` |
| **configurações** | o que muda de uma revenda para outra dentro do tema: cor, fonte, logo, raio | `"configuracoes"` no `site.json` (no Shopify, `settings_data.json`) |
| **layout** | a moldura comum a todas as páginas: head, cabeçalho, rodapé, scripts | `temas/<nome>/layout/tema.html` |
| **template** | o arquivo de UM tipo de página (home, listagem, carro...): só o que é dele | `temas/<nome>/templates/` |
| **seção** | um pedaço configurável de página (banner, vitrine, texto...) | `temas/<nome>/secoes/`; as páginas listam em `"secoes"` |
| **snippet** | um pedaço pequeno reaproveitado (head, cabeçalho, card) | `temas/<nome>/snippets/` (`{{> nome}}`) |

## Estrutura

```
temas/<nome>/
  config/
    settings_schema.json   nome e descrição do tema (e, em breve, as opções que ele aceita)
  layout/
    tema.html              a moldura de todas as páginas (no Shopify, layout/theme.liquid)
  templates/               UM ARQUIVO POR TIPO DE PÁGINA (os 5 são obrigatórios), só com os blocos dele
  secoes/                  um HTML por tipo de seção (banner, vitrine, texto...)
  snippets/                pedaços reaproveitados com {{> nome}} (cabeçalho, rodapé, head)
  assets/                  css/, js/, img/: vão para a RAIZ do site gerado (assets/css/style.css → /css/style.css)
  paginas-padrao/          contato, financiamento, avaliação, privacidade, cookies, LGPD (JSON)
  paginas-extras/          páginas HTML que todo site do tema ganha
```

Comparando com o Shopify: `locales/` (textos padrão) ainda não existe aqui (próxima etapa); `paginas-padrao/` e `paginas-extras/` não têm equivalente lá e continuam com esses nomes.

Nome antigo (antes de 2026-11-08: `templates/<nome>/` com `template.json`, `paginas/`, `blocos/`, `parciais/`, `css/` na
raiz) dá erro claro no build. `node ferramentas/migrar-temas.js` converte tudo (temas, sites e inquilinos;
`--simular` só mostra).

## O layout (`layout/tema.html`)

O layout é a página inteira com **espaços** que cada template preenche. É a herança de templates do Mustache (a mesma
família de `{{ }}` que o build já usa):

```html
<!-- layout/tema.html -->
<!doctype html>
<html lang="pt-BR">
<head>
{{> head}}
{{$head}}{{/head}}
</head>
<body{{$atributos}} data-page="pagina" data-base="{{base}}" data-rel="{{rel}}"{{/atributos}}>
{{> cabecalho}}
{{$conteudo}}{{/conteudo}}
{{> rodape}}
<script src="{{rel}}motor/engine.js"></script>
{{$scripts}}<script src="{{rel}}motor/ui-util.js"></script>
{{/scripts}}<script src="{{rel}}js/template-basico.js"></script>
</body>
</html>
```
```html
<!-- templates/pagina.html: só o que é desta página -->
{{$head}}<title>{{pagina.titulo}}</title>
<meta name="description" content="{{pagina.descricao}}">
{{{canon}}}{{/head}}
{{$conteudo}}<main class="conteudo">
{{{conteudo}}}
</main>{{/conteudo}}
```

- `{{$nome}}...{{/nome}}` no layout marca um espaço; o que está dentro é o **padrão** (vale quando o template não preenche).
  Ex.: o `{{$atributos}}` acima já traz os atributos do `<body>` das páginas de conteúdo; o `carro.html` troca pelos dele.
- No template, cada `{{$nome}}...{{/nome}}` preenche o espaço de mesmo nome. O conteúdo vale **exatamente** como foi
  escrito (quebras de linha inclusive).
- Os nomes são livres: os temas de hoje usam `head`, `atributos`, `cabecalho` (barra-topo e lateral), `conteudo` e `scripts`.
- Erros claros: texto fora dos blocos no template (ele sumiria), bloco que o layout não tem, bloco repetido, template com
  blocos num tema sem `layout/tema.html`.
- Template **sem nenhum** `{{$...}}` é o documento inteiro e não usa o layout (como o `layout none` do Shopify): serve para
  uma página que foge da moldura. Os temas do projeto usam o layout nos 5 (um teste cobra).
- Mudar o layout muda **todas** as páginas do tema: cabeçalho, rodapé ou um script novo se editam num lugar só.

## Os 5 arquivos de `templates/`

| Arquivo | Página do site |
|---|---|
| `home.html` | a página principal (`/`), com as seções de `web/index.json` em `{{{conteudo}}}` |
| `multipla.html` | a listagem do estoque (`/multipla/` e todas as rotas `/multipla/...`) |
| `carro.html` | a página de cada carro |
| `vendido.html` | o carro que saiu ("não está mais disponível", `noindex`) |
| `pagina.html` | a moldura das páginas de conteúdo (`/paginas/...`) e da 404 |

Faltou algum, o `config/settings_schema.json` ou uma das seções obrigatórias (`banner`, `vitrine`, `titulo`, `texto`,
`formulario`, `lojas`): o build para com "falta templates/x.html". Todas as páginas precisam carregar
`{{rel}}motor/ui-site.js` (aviso de cookies, formulários).

## A listagem (`multipla.html`)

Os 3 temas montam a listagem com componentes:
```html
<body data-page="lista" data-base="{{base}}" data-rel="{{rel}}">
{{{secoesAntes}}}
<main>
  {{componente filtro layout="lateral" titulo="Filtrar"}}
  <section>{{componente filtros-ativos}}{{componente estoque titulo="{{listagem.h1}}" tituloTag="h1" porPagina=24}}</section>
</main>
{{{secoesDepois}}}
```
- `{{{secoesAntes}}}` e `{{{secoesDepois}}}` são obrigatórios (as seções de `web/multipla.json`; um teste cobra).
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
| `{{> nome}}` | inclui `snippets/nome.html` |
| `{{componente nome op=valor}}` | um componente ([componentes.md](componentes.md)) |

Dados disponíveis: `{{site.nome}}`, `{{site.slogan}}`, `{{site.url}}`, `{{site.textos.*}}`, `{{site.cabecalho.*}}`,
`{{site.rodape.*}}`, `{{#site.links}}` (páginas com `rotulo`), `{{configuracoes.*}}` (logo, cores... do site),
`{{rel}}` (prefixo até a raiz), `{{inicioUrl}}`, `{{estoqueUrl}}`, `{{base}}` (fotosBase), `{{{temaCss}}}`,
`{{{fonteLink}}}`, `{{motor}}` e `{{estoque.*}}` (total, destaques, marcas, cidades, carrocerias, combustíveis e lojas,
cada item com `valor`, `total`, `link`, `chave`). Dentro de uma seção, os campos dela (`{{titulo}}`, `{{imagem}}`...).

## Regras ao escrever um tema

- Referencie arquivos sempre com `{{rel}}`: `{{rel}}css/style.css`, `{{rel}}motor/engine.js`. A página pode estar em
  qualquer profundidade. (O arquivo mora em `assets/css/style.css`, mas sai na raiz do site: `css/style.css`.)
- Imagens das configurações com caminho relativo (`assets/logo.png`, os arquivos do SITE) já chegam com o prefixo certo
  em `{{configuracoes.logo}}`.
- Cores, cantos, fonte e colunas por variáveis CSS: `--cor`, `--fundo`, `--texto`, `--raio`, `--fonte`, `--colunas`
  (vêm das `configuracoes` do site via `{{{temaCss}}}`).
- css e js do tema saem com `?v=<hash>` e entram no hash das páginas: mudar o css refaz as páginas do site com o
  `?v` novo. Os do core (`motor/`) não entram, por isso a `core/ui` precisa continuar funcionando com HTML antigo.
- Editar `paginas-padrao/` ou `paginas-extras/` não refaz as páginas de carro (ficam fora do hash).

## Criar um tema

1. Copie um tema parecido: `cp -r temas/barra-topo temas/meu-tema`.
2. Ajuste `config/settings_schema.json`, o `layout/tema.html` (cabeçalho, rodapé), os 5 arquivos de `templates/`,
   `assets/css/` e as seções.
3. Use num site: `"tema": "meu-tema"` no `site.json` (ou libere para o inquilino em `"temas"` do `inquilino.json`).
4. `npm test`: o teste de temas confere a estrutura, arquivos obrigatórios, seções, ids, links quebrados e marcadores
   sobrando em todos os temas.
