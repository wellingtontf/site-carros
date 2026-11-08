# Páginas: a pasta `web/`

`sites-config/<dominio>/web/` é o **espelho do site público**: cada arquivo ali vira um endereço. O `site.json` não tem
lista de páginas: criar uma página é criar um arquivo.

```
sites-config/<dominio>/web/                       →  site publicado (sites-public/<dominio>/)
  index.json                (home, seções)         →  /
  multipla.json             (listagem)             →  /multipla/   (e todas as rotas /multipla/...)
  paginas/lojas.json        (página de seções)     →  /paginas/lojas/
  paginas/sobre/nos.json                           →  /paginas/sobre/nos/
  paginas/feirao.html       (HTML livre)           →  /paginas/feirao/
  paginas/feirao/index.html (com imagens e css)    →  /paginas/feirao/   (a pasta vai inteira)
```

Regras gerais:
- **Toda página de conteúdo fica em `/paginas/<nome>/`**, inclusive as padrão (`/paginas/lgpd/`, `/paginas/contato/`).
  Só a home fica na raiz. A raiz do site tem só a home, `multipla/`, `carros/`, `paginas/` e arquivos.
- **Links escritos do jeito simples valem:** `"link": "contato/"` (cadastro, seções) e `href="/lojas/"` (HTML do designer)
  viram `/paginas/...` no build. Links de filtro (`"multipla/?carroceria=Moto"`, `"multipla/revenda_cidade_nome/X"`) viram
  a rota canônica (`multipla/carroceria/moto`).
- **Endereço antigo de página** (`/contato`, `/financiamento`, do site do Revenda Mais) recebe **301 da hospedagem** para
  `/paginas/...` (`infra/cloudfront/roteador.js`; o servidor local faz igual).
- Arquivo apagado: a página some no próximo build (e da hospedagem, na publicação).
- `x.json` e `x.html` com o mesmo nome é erro (uma página por endereço). Nomes: minúsculas, números e hífen.
- Reservados (não podem ser nome de página): `multipla`, `carros`, `carro`, `paginas`, `motor`, `css`, `js`, `img`, `assets`.
- Pela API: `PUT /v1/sites/<d>/paginas/<nome>` (`index` = home) e `PUT /v1/sites/<d>/multipla` ([api.md](api.md)).

## Home: `web/index.json`

```json
{ "titulo": "Loja Teste Seminovos", "descricao": "Seminovos com garantia.", "secoes": [
    { "tipo": "carrossel", "slides": [ { "imagem": "assets/banner-1.webp", "alt": "...", "link": "multipla/" } ] },
    { "tipo": "carrocerias", "titulo": "Encontre por tipo" },
    { "tipo": "componente", "nome": "estoque", "opcoes": { "titulo": "Destaques", "porPagina": 8, "botaoEstoque": "Ver estoque completo" } }
] }
```
Sem `web/index.json`, o core usa a **home padrão** (banner + vitrine). A home usa o template `home.html` do tema.

## Listagem: `web/multipla.json`

```json
{ "secoesAntes":  [ { "tipo": "banner", "imagem": "assets/banner-estoque.webp", "alt": "..." } ],
  "secoesDepois": [ { "tipo": "chamada", "titulo": "Não achou?", "botao": "Fale com a gente", "mensagem": "Procuro um carro" } ],
  "componentes":  { "filtro": { "checkbox": "estado,cidade,marca,modelo,carroceria" } } }
```
- `secoesAntes` / `secoesDepois`: seções do tema antes e depois da lista.
- `componentes`: opções **só desta página** para os componentes que o tema põe na listagem (filtro, estoque,
  filtros-ativos). Valem mais que as do tema e as do site ([componentes.md](componentes.md)).
- Arquivo vazio ou `{}` = sem configuração. A listagem fica **sempre** em `/multipla/`.

## Páginas de seções: `web/paginas/<nome>.json`

```json
{ "titulo": "Nossas lojas", "descricao": "Endereços e horários.", "rotulo": "Lojas",
  "secoes": [ { "tipo": "titulo", "titulo": "Nossas lojas" }, { "tipo": "lojas" } ] }
```
- `rotulo` põe um link para a página no rodapé de todos os temas (`{{#site.links}}`).
- Cada `tipo` de seção é um arquivo do tema (`temas/<nome>/secoes/<tipo>.html`). Seção que o tema não tem é
  erro (no build e na API). O nome antigo `"blocos"` dá erro claro (`node ferramentas/migrar-temas.js` converte).
- A seção `componente` põe um componente na página: `{ "tipo": "componente", "nome": "estoque", "opcoes": {...} }`.
- Links e imagens relativos (`link`, `imagem`, `foto`, `logo`...) são relativos à raiz do site; o build ajusta para cada página.
- Dados do estoque em qualquer seção ou página: `{{estoque.total}}`, `{{estoque.destaques}}`, `{{#estoque.marcas}}`,
  `{{#estoque.cidades}}`, `{{#estoque.carrocerias}}`, `{{#estoque.combustiveis}}` (cada item: `valor`, `total`, `link` para
  a rota da listagem, `chave` sem acento) e `{{#estoque.lojas}}`.

### Seções de cada tema

| Tema | Seções |
|---|---|
| todos | `banner`, `vitrine`, `titulo`, `texto`, `formulario`, `lojas` (obrigatórios) e `componente` |
| `template-basico` | + `carrossel` (`slides[{imagem, alt, link \| mensagem}]`), `carrocerias` (atalhos por tipo, do estoque), `busca` (marca, modelo, preço, ano, `atalhos`), `listagem` (o estoque interativo na página; um por página), `chamada` (`link` ou `mensagem`) |

Campos das seções mais usadas:

| Seção | Campos |
|---|---|
| `banner` | `imagem`, `alt`, `titulo`, `subtitulo`, `link` (sem imagem: faixa colorida com o título) |
| `vitrine` | `titulo`, `subtitulo`, `quantidade`, `botao`, `somenteDestaques` (os carros já saem no HTML) |
| `texto` | `html`, `alinhamento` (`justificado`, `esquerda`, `centro`) |
| `formulario` | `titulo`, `subtitulo`, `botao`, `aviso`, `mensagem`, `campos[{rotulo, tipo, obrigatorio, dica, meia, opcoes, opcoesDe: "lojas"}]`: envia pelo WhatsApp |
| `lojas` | as lojas do site com endereço, telefone e estoque de cada uma |
| `chamada` | `titulo`, `texto`, `botao`, `mensagem`, `fundo`: faixa com botão de WhatsApp |

## Para o web designer: páginas em HTML, sem mexer no sistema

Você só cria **arquivos HTML** numa pasta. Sem JSON, sem configuração, sem programação.

| Quero uma página... | Onde coloco | Vira |
|---|---|---|
| só para **um site** | `sites-config/<dominio>/web/paginas/feirao.html` | `/paginas/feirao/` |
| com imagens e CSS próprios | `sites-config/<dominio>/web/paginas/feirao/index.html` + `faixa.jpg`, `estilo.css`… | `/paginas/feirao/` |
| dentro de uma seção | `sites-config/<dominio>/web/paginas/promocoes/feirao/index.html` | `/paginas/promocoes/feirao/` |
| para **todos os sites** de um tema | `temas/<tema>/paginas-extras/financiamento.html` | `/paginas/financiamento/` em cada site |

- **Escreveu só o conteúdo** (sem `<html>`)? A página entra com o cabeçalho e o rodapé do site.
- **Escreveu o documento inteiro** (`<html>…</html>`)? Vira página 100% livre (landing de campanha). O sistema só
  acrescenta o aviso de cookies e o que faltar para funcionar no celular.
- **Links para o site:** escreva como num site normal: `href="/multipla/"`, `href="/contato/"`,
  `href="/multipla/marca/toyota"`. O sistema ajusta.
- **Imagens da pasta:** caminho relativo normal (`src="faixa.jpg"`). Dá para abrir o `index.html` direto no navegador.
- **Título:** vem do `<title>` ou do primeiro `<h1>`.
- **Opcional**, comentários no começo do arquivo: `<!-- titulo: ... -->`, `<!-- descricao: ... -->`,
  `<!-- rotulo: Feirão -->` (link no rodapé), `<!-- moldura: nenhuma -->` (página livre mesmo sem `<html>`).
- **Opcional**, dados do site: `{{site.nome}}`, `{{estoque.total}}`,
  `{{#estoque.marcas}}<a href="{{link}}">{{valor}}</a>{{/estoque.marcas}}`.
- Ver o resultado: `node core/build.js --sites <dominio>` e `node ferramentas/servidor-local.js 8080`.

**Prioridade quando há páginas com o mesmo nome:** `web/paginas/` do site > `paginas-extras/` do tema >
`paginas-padrao/` do tema.

## Páginas padrão (todo site ganha): `temas/<nome>/paginas-padrao/`

`contato`, `financiamento`, `avaliacao`, `politica-de-privacidade`, `politica-de-cookies` e `lgpd` ficam **no tema**
(cada tema é autocontido; não há pasta global). Todo tema precisa ter pelo menos contato, privacidade, cookies e
LGPD (um teste cobra).

- São geradas em todos os sites do tema com os dados de cada um: `{{site.nome}}`, `{{site.dominio}}`, `{{site.url}}`,
  `{{site.whatsapp}}`, `{{empresa.razaoSocial}}`, `{{empresa.cnpj}}`, `{{empresa.email}}`, `{{empresa.encarregado}}` e
  `{{rel}}` (prefixo até a raiz).
- O jurídico muda o texto no `paginas-padrao/` do tema e o build atualiza os sites dele **sem refazer as páginas de
  carro** (essa pasta fica fora do hash do tema).
- O site **substitui** uma criando em `web/paginas/` uma de mesmo nome (ex.: `contato.json`), ou **desliga**:
  `"paginasPadrao": { "lgpd": false }` no `site.json`.
- `"provisorio": true` na página gera um aviso no build até o texto oficial chegar. **Hoje os textos legais são modelo
  provisório.**
- **Aviso de cookies** e formulários `.js-form-zap` (enviam pelo WhatsApp) ficam no core (`core/ui/ui-site.js`), em todas
  as páginas de todos os temas. Texto em `textos.avisoCookies`; `"avisoCookies": false` desliga. Quando o site tem
  scripts de terceiros (GTM, GA4, Pixel, `codigos/`), o aviso pede **Aceitar** ou **Recusar** e eles só rodam depois do
  aceite ([configurar-um-site.md](configurar-um-site.md#scripts-gtm-ga4-pixel-da-meta-chat-corecodigosjs)).

## Migração de sites antigos

Site com `"paginas"` ou `"estoque"` no `site.json`, ou com a pasta antiga `sites-config/<dominio>/paginas/`: o build
recusa e explica. `node ferramentas/mover-paginas.js [dominios]` leva tudo para `web/` (não sobrescreve nada).
