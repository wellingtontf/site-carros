# Temas

Um **tema** é o visual de vários sites: a estrutura das páginas, as seções, o CSS. A estrutura e os nomes seguem o padrão
do Shopify (decisão do Wellington, 2026-11-08), o mais conhecido do mercado para "muitos sites, poucos visuais".

Cada tema fica inteiro em `temas/<nome>/` (nada solto na raiz de `temas/`), sem base compartilhada com outros temas.
Hoje há um tema, o `template-basico` (o `barra-topo` e o `lateral`, que nenhum site usava, foram apagados em 2026-11-08;
estão no histórico do git). Um inquilino pode ter temas próprios em
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

Cada tema tem **versões**, como o motor: o designer edita só o `rascunho/`; `v1/`, `v2/`... são congeladas (imutáveis) e
cada site diz qual usa (`"versaoTema"`). Cada uma dessas pastas é o tema inteiro:

```
temas/<nome>/
  rascunho/                ← o ÚNICO lugar onde se edita
  v1/  v2/ ...             ← congeladas (versao.json com data, nota e sha256 de todos os arquivos)
```
```
temas/<nome>/<versão>/
  config/
    settings_schema.json   nome, descrição e TUDO que o site pode configurar (configurações, cabeçalho, rodapé)
  locales/
    pt-BR.json             textos padrão do tema (botão de WhatsApp, "voltar", aviso de cookies...)
  layout/
    tema.html              a moldura de todas as páginas (no Shopify, layout/theme.liquid)
  templates/               UM ARQUIVO POR TIPO DE PÁGINA (os 5 são obrigatórios), só com os blocos dele
  secoes/                  um HTML por tipo de seção (banner, vitrine, texto...)
  snippets/                pedaços reaproveitados com {{> nome}} (cabeçalho, rodapé, head)
  assets/                  css/, js/, img/: vão para a RAIZ do site gerado (assets/css/style.css → /css/style.css)
  paginas-padrao/          contato, financiamento, avaliação, privacidade, cookies, LGPD (JSON)
  paginas-extras/          páginas HTML que todo site do tema ganha
```

Comparando com o Shopify: `paginas-padrao/` e `paginas-extras/` não têm equivalente lá e continuam com esses nomes.

## Versões do tema (o fluxo do designer)

```
node core/cli.js tema status                                  versões de cada tema, quem usa cada uma, se o rascunho mudou
node core/build.js --sites loja.com.br --versao-tema rascunho prévia do rascunho em dist-preview/ (nada vai para o ar)
node core/cli.js tema testar template-basico rascunho         gera e testa os sites do tema com o rascunho
node core/cli.js tema congelar template-basico v2 --nota "rodapé novo"   rascunho → v2 (imutável)
node core/cli.js tema aplicar template-basico v2 --sites a.com.br        testa e passa esses sites para a v2 (ou --todos)
node core/cli.js tema reverter --sites a.com.br               volta para a versão anterior
node core/cli.js tema historico
```

1. Edite `temas/<nome>/rascunho/` e veja a prévia: `node core/build.js --sites loja.com.br --versao-tema rascunho` e
   `node ferramentas/servidor-local.js 8090 dist-preview` → `http://localhost:8090/loja.com.br/`.
2. Congele: o rascunho vira `vN`. Rascunho igual à última versão é recusado (nada para congelar).
3. Aplique em alguns sites (piloto), confira, e depois em todos (`--todos` = todos os sites daquele tema). O `aplicar` gera
   e testa os sites com a versão nova antes; se falhar (arquivo faltando, marcador `{{ }}` sobrando, motor), nada muda.
4. Deu problema no ar: `tema reverter`. Depois de aplicar ou reverter: `node core/build.js --sites ...` e publicar.

- **Versão congelada não se edita:** `versao.json` guarda o sha256 de todos os arquivos, e um teste falha se alguém mexer.
  Correção = editar o rascunho e congelar uma versão nova.
- **Tudo do tema está na versão**, inclusive as páginas padrão (textos legais): o texto oficial do jurídico entra numa
  versão nova e vai para os sites com `tema aplicar ... --todos`. Assim uma versão antiga nunca usa uma seção que ela não tem.
- O site fixa a versão (`"versaoTema": "v1"`), como o `"motor"`. Site novo nasce na última congelada. Pela API, um `PUT` do
  cadastro sem `versaoTema` mantém a versão atual (o sistema da revenda não precisa saber disso).
- Tema próprio de inquilino (`inquilinos/<id>/temas/<nome>/`) segue as mesmas regras; nos comandos, `--inquilino <id>`.
- Mudar de versão refaz as páginas dos sites que mudaram (o tema entra no hash).

Nome antigo (antes de 2026-11-08: `templates/<nome>/` com `template.json`, `paginas/`, `blocos/`, `parciais/`, `css/` na
raiz) dá erro claro no build. `node ferramentas/migrar-temas.js` converte tudo (temas, sites e inquilinos;
`--simular` só mostra). Tema sem versões (arquivos direto em `temas/<nome>/`) também: o script move para `v1/`, copia
para `rascunho/` e põe `"versaoTema": "v1"` nos sites.

## O que o site pode configurar (`config/settings_schema.json` e `locales/pt-BR.json`)

O tema **declara** o que aceita. Isso é o contrato entre o designer (que faz o tema) e quem configura cada site (pela API,
por um painel no futuro, ou à mão no `site.json`):

```json
{
  "nome": "Template básico",
  "descricao": "...",
  "configuracoes": {
    "cor":   { "tipo": "cor", "padrao": "#0b5fff", "rotulo": "Cor principal", "descricao": "botões, links (--cor)" },
    "raio":  { "tipo": "numero", "padrao": 12, "rotulo": "Arredondamento dos cantos (px)" },
    "logo":  { "tipo": "imagem", "rotulo": "Logo" }
  },
  "cabecalho": {
    "telefone": { "tipo": "texto", "rotulo": "Telefone/WhatsApp na faixa" },
    "menu":     { "tipo": "itens", "campos": { "rotulo": { "tipo": "texto" }, "link": { "tipo": "texto" } } }
  },
  "rodape": {
    "contato":  { "tipo": "item", "campos": { "rotulo": { "tipo": "texto" }, "link": { "tipo": "texto" } } }
  }
}
```
```json
// locales/pt-BR.json
{ "botaoWhatsapp": "Tenho interesse (WhatsApp)", "voltar": "Voltar ao estoque", "busca": "Buscar: ...", "rodape": "", "avisoCookies": "..." }
```

- **Grupos:** `configuracoes` (cores, fonte, logo, favicon...: vira `{{configuracoes.x}}` e as variáveis CSS), `cabecalho` e
  `rodape` (`{{site.cabecalho.x}}`, `{{site.rodape.x}}`). Os **textos** ficam no `locales/pt-BR.json` (`{{site.textos.x}}`).
- **Tipos:** `texto`, `numero`, `booleano`, `cor`, `lista` (texto separado por vírgula), `imagem` (caminho como
  `assets/logo.png` ou URL), `item` (um objeto, ex.: `{ "rotulo", "link" }`) e `itens` (lista de objetos, ex.: o menu).
  Em `item`/`itens`, `campos` diz o tipo de cada campo. `valores: [...]` restringe a uma lista.
- **Padrão:** `padrao` é o valor quando o site não manda nada. O site vale mais: `"configuracoes": { "cor": "#c00000" }`.
  O core só tem um último recurso para as 6 variáveis CSS (`--cor --fundo --texto --raio --fonte --colunas`), caso um
  tema não declare; os temas do projeto declaram todas (um teste cobra).
- **Regras** (decisão do Wellington): chave que o tema não declara = **aviso** (o site antigo não para; a API devolve em
  `avisos`); valor de tipo errado = **erro** (o build para e a API responde 422, nada gravado). Declaração errada no
  próprio schema (padrão com tipo errado, tipo que não existe) também para o build, apontando o arquivo.
- **Tudo que o HTML usa precisa estar declarado:** um teste varre os HTML de cada tema e exige que todo
  `{{configuracoes.x}}`, `{{site.cabecalho.x}}`, `{{site.rodape.x}}` e `{{site.textos.x}}` exista no schema/locale.
- **API:** `GET /v1/temas` lista os temas que o inquilino pode usar; `GET /v1/temas/<nome>` devolve o schema e os textos
  (é o que um painel precisa para montar a tela de configuração).

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
- Os nomes são livres: o template-basico usa `head`, `atributos`, `conteudo` e `scripts`.
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

O template-basico monta a listagem com componentes (resumido):
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

1. Copie o rascunho de um tema parecido: `mkdir temas/meu-tema && cp -r temas/template-basico/rascunho temas/meu-tema/rascunho`.
2. No rascunho, ajuste `config/settings_schema.json` (o que o site pode configurar), `locales/pt-BR.json` (textos), o
   `layout/tema.html` (cabeçalho, rodapé), os 5 arquivos de `templates/`, `assets/css/` e as seções.
3. Congele a primeira versão: `node core/cli.js tema congelar meu-tema v1`.
4. Use num site: `"tema": "meu-tema", "versaoTema": "v1"` no `site.json` (ou libere para o inquilino em `"temas"` do
   `inquilino.json`).
5. `npm test`: o teste de temas confere as versões (só `rascunho/` e `vN/`, nenhuma congelada editada), a estrutura, arquivos obrigatórios, seções, ids, links quebrados e marcadores
   sobrando em todos os temas.
