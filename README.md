# Site de carros estático: um site por domínio, motor versionado e templates

```
core/                      O CORE (só código, isolado do resto)
  motor/rascunho/            o motor em desenvolvimento (único lugar onde se edita)
  motor/<v1, v2...>/         versões congeladas do motor (imutáveis)
  ui/                        liga o motor à página (listagem, página do carro, utilidades)
  caminhos.js                todos os caminhos do projeto num lugar só
  build.js  cli.js  atualizar.js  servidor.js
sites/<dominio>/           UM SITE POR DOMÍNIO (o nome da pasta é o domínio e o id do site)
  site.json                  configuração: template, tema, textos, filtros, lojas, motor...
  estoque.json               o ÚNICO JSON de carros do site (vem do Revenda Mais)
  assets/                    imagens próprias do site (logo, banner, favicon)
templates/<nome>/          UM VISUAL (o web designer mexe só aqui); cada template é autocontido
  template.json              nome e descrição
  paginas/                   index.html (listagem), carro.html, vendido.html e, se o template tiver blocos, pagina.html
  blocos/                    um HTML por tipo de bloco (banner, cartoes, texto, busca, vitrine...)
  parciais/                  pedaços reaproveitados com {{> nome}} (cabeçalho, rodapé, head)
  css/  js/  img/            arquivos do template
config/                    fontes.json, publicacao.json (copie dos .exemplo.json), historico.json
ferramentas/               gerar-exemplo.js, importar-trokey.py
```
Gerados (fora do git): `dist/<dominio>/` (pronto para publicar), `.estado/` (build incremental), `s3-local/` (simulação do bucket de fotos).

## Rodar
```
node ferramentas/gerar-exemplo.js   # estoques de teste dos 3 sites de exemplo
node core/build.js                  # gera todos os sites em dist/
node core/cli.js testar             # testa todos os sites
python3 -m http.server 8080 --directory dist
node core/cli.js status             # versões do motor e o que cada site usa
```
Os mesmos comandos existem como `npm run build`, `npm run testar`, `npm run status`, `npm run cli -- <comando>`.

## Testes
```
npm test               # tudo (~10 s): unidade, build, atualização, servidor, motor, sites reais e navegador
npm run test:rapido    # sem o navegador (Chrome)
```
| arquivo | o que garante |
|---|---|
| `tests/unidade-*.test.js` | link do carro, mini-renderer (escape/XSS), validação do estoque |
| `tests/build.test.js` | geração, incremental, vendidos e retenção, redirecionamentos, ordem, páginas, blocos, links relativos, segurança, erros de configuração |
| `tests/atualizar.test.js` | fontes HTTP (`${VAR}`, erro 500, JSON quebrado), trava de queda, estoque vazio, trava de execução, publicação incremental, injeção no shell |
| `tests/servidor.test.js` | API: token por cliente, 403 em site alheio, 422 com erros, estoque inteiro, carro avulso, rajada num build só, trava de queda (409), fila que sobrevive a reinício |
| `tests/fotos.test.js` | fotos por URL: baixa, converte, renumera as que deram certo, não baixa de novo, SSRF (inclusive por redirecionamento), falha de envio fica pendente, conversor real, caminho completo pela API |
| `tests/producao.test.js` | problemas de site estático no ar: 404, `?v=` nos css/js, canonical em página livre, publicação recusa fotos em localhost/http, auditoria |
| `tests/motor.test.js` | busca, busca aproximada, filtros em cascata, link da busca, ordens, WhatsApp — em **todas** as versões; e que as congeladas não foram editadas (`sha256` em `versao.json`) |
| `tests/sites-e-templates.test.js` | gera os sites reais e varre **todas** as páginas: link local quebrado, `{{marcador}}` sobrando, título/viewport, ids da listagem; todo template com o mínimo exigido |
| `tests/navegador.test.js` | Chrome headless em cada template: cards montados pelo JS, filtro vindo da URL, WhatsApp da página do carro, nenhum erro de JS |
| `tests/snapshot-html.test.js` | o HTML gerado só muda junto com `VERSAO_HTML` (veja abaixo) |

O GitHub roda tudo a cada push (`.github/workflows/testes.yml`).

**`VERSAO_HTML` (core/build.js):** mudar a versão refaz as páginas de **todos** os sites. Aumente só quando uma mudança no `build.js` alterar o HTML gerado; o teste de snapshot avisa nos dois sentidos. Depois de aumentar: `npm run test:snapshot`.

## O que vai para cada site gerado (`dist/<dominio>/`)
| no site gerado | vem de |
|---|---|
| `motor/engine.js`, `motor/ui-*.js` | `core/motor/<versao do site>/` e `core/ui/` |
| `css/`, `js/`, `img/`... | `templates/<nome>/` (tudo menos `paginas/` e `template.json`) |
| `assets/` | `sites/<dominio>/assets/` |
| `index.html` (home institucional) | página `""` de `paginas` (sem ela, o core gera uma home padrão: banner + vitrine) |
| `multipla/index.html` (listagem do estoque, **sempre** em `/multipla`) | `templates/<nome>/paginas/index.html` + blocos de `estoque.blocosAntes/blocosDepois` |
| `carros/<Marca>/<Modelo>/<Versao>/<...>-<id>.html` | `templates/<nome>/paginas/carro.html` (e `vendido.html`) |
| `<caminho>/index.html` de cada página de conteúdo | `templates/<nome>/paginas/pagina.html` + `blocos/<tipo>.html` |
| `carros.json`, `config.json`, `sitemap.xml`, `robots.txt` | gerados pelo build |

## Site (`sites/primeseminovos.exemplo.com.br/site.json`)
```json
{ "nome": "Prime Seminovos", "motor": "v1", "template": "lateral",
  "tema": { "cor": "#111827", "logo": "assets/logo.png" },
  "url": "https://primeseminovos.exemplo.com.br",
  "whatsapp": "5511955550000", "fotosBase": "https://fotos.seudominio.com.br/",
  "lojas": {
    "sp-centro": { "nome": "Prime Centro", "cidade": "São Paulo", "uf": "SP", "endereco": "Av. Paulista, 1000", "whatsapp": "5511999990001" },
    "rio":       { "nome": "Prime Rio", "cidade": "Rio de Janeiro", "uf": "RJ", "endereco": "Av. das Américas, 3000" }
  },
  "restricoes": { "precoMin": 90000 }, "busca": true,
  "filtros": [ { "campo": "cidade", "rotulo": "Onde" }, "marca",
               { "campo": "preco", "rotulo": "Faixa de preço", "opcoes": [100000, 150000, 200000, 300000] }, "ano" ],
  "ordenacao": ["recentes", "menor", "maior"],
  "vendedores": { "carlos": "5511966663333" } }
```
- O id do site é o nome da pasta (o domínio). Não existe campo `id`.
- `lojas`: cidade, UF e endereço da loja valem para os carros dela. O WhatsApp do carro é o da loja; sem ele, o do site.
- Imagens do `tema` (`logo`, `banner`, `favicon`...) com caminho relativo apontam para `sites/<dominio>/assets/`; o build ajusta o caminho em cada página. URL absoluta também funciona.

## Estoque (`sites/<dominio>/estoque.json`)
```json
{ "atualizado": "2026-11-07T12:00:00Z", "carros": [
  { "id": "BH0001", "loja": "sp-centro", "marca": "Fiat", "modelo": "Mobi", "versao": "Like 1.0", "ano": 2021,
    "preco": 49000, "km": 37300, "cor": "Prata", "cambio": "Automático",
    "combustivel": "Flex", "fotos": 6, "opcionais": ["Ar-condicionado"], "descricao": "..." } ]}
```
`loja` é o id de uma loja de `site.json`. Se o site tem uma loja só, pode omitir.
- `link` (opcional): o endereço da página do carro, ex. `"carros/Toyota/Corolla/Xei-20/Toyota-Corolla-Xei-20-2024-Curitiba-Parana-8644851.html"`. **Mande o link que o Revenda Mais já usa**: a página fica exatamente nele (as URLs indexadas no Google não mudam, sem 301). Sem `link`, vale a regra de `core/ui/link-carro.js`. Precisa começar com `carros/` e terminar com `.html`; `//` vira `/`.

Campos opcionais:
- `ordem` (inteiro ≥ 0): **ordem de exibição**; menor aparece primeiro. Sem `ordem`, vale a posição no arquivo. É a ordenação padrão do site ("Destaques", motor v2+) e a ordem da vitrine/listagem da home.
- `destaque` (true/false): marca o carro como destaque (contagem `estoque.destaques`; vitrine com `"somenteDestaques": true`).
- `carroceria` (texto: Hatch, Sedan, SUV, Utilitário, Moto...): vira filtro `carroceria` e os atalhos por tipo da home.

## Páginas de conteúdo e blocos
Além da listagem e das páginas dos carros, um site pode ter páginas de conteúdo (home institucional, "quero vender", lojas, política...). Cada página é uma lista de **blocos**; cada tipo de bloco é um HTML do template (`templates/<nome>/blocos/<tipo>.html`). Exemplo completo em `sites/trokey.com.br/site.json`.
```json
"cabecalho": { "menu": [ { "rotulo": "ESTOQUE", "link": "estoque/" }, { "rotulo": "FRANQUIA", "link": "https://..." } ],
               "botao": { "rotulo": "SEJA UM AUTO BROKER", "link": "https://..." } },
"rodape":    { "descricao": "...", "endereco": "...", "telefone": "...", "email": "...",
               "sociais": [ { "rede": "Instagram", "link": "https://..." } ], "copyright": "..." },
"estoque":   { "caminho": "estoque",
               "blocosAntes":  [ { "tipo": "banner", "imagem": "assets/banner-estoque.webp", "alt": "..." } ],
               "blocosDepois": [ { "tipo": "chamada", "titulo": "...", "botao": "...", "mensagem": "..." } ] },
"paginas": [
  { "caminho": "", "titulo": "Trokey Motors", "descricao": "...", "blocos": [
      { "tipo": "banner", "imagem": "assets/home-hero.webp", "alt": "..." },
      { "tipo": "vitrine", "titulo": "NOSSO ESTOQUE", "quantidade": 4, "botao": "VER ESTOQUE COMPLETO" } ] },
  { "caminho": "politica-privacidade", "titulo": "Política de Privacidade", "blocos": [
      { "tipo": "texto", "html": "<h3>...</h3><p>...</p>" } ] } ]
```
- A listagem do estoque fica **sempre** em `/multipla/` (`multipla` é reservado). A raiz é a home institucional: a página `"caminho": ""`; se o site não tiver uma, o core gera a home padrão.
- Um template pode mostrar o estoque já na home com o bloco `listagem` (o estoque interativo, com ou sem filtros, na ordem do estoque; os primeiros cards já saem no HTML). Só um por página.
- Dados do estoque disponíveis em qualquer página/bloco: `{{estoque.total}}`, `{{estoque.destaques}}`, `{{#estoque.cidades}}`, `{{#estoque.marcas}}`, `{{#estoque.carrocerias}}`, `{{#estoque.combustiveis}}` (cada item: `valor`, `total`, `link` para `/multipla/?campo=valor`, `chave` sem acento) e `{{#estoque.lojas}}`. Os nomes entram no hash das páginas de carro; as **contagens não**: nas páginas de carro use `.js-total` (o `config.json` traz `total`).
- Links e imagens relativos (`link`, `imagem`, `foto`, `logo`...) são relativos à raiz do site; o build ajusta para cada página.
- Página que sai do `site.json` tem o HTML apagado no próximo build. Todas entram no `sitemap.xml`.
- Blocos do template `trokey`:

| tipo | campos |
|---|---|
| `banner` | `imagem`, `alt`, `titulo`, `subtitulo`, `link` (sem imagem: faixa colorida com o título) |
| `cartoes` | `titulo`, `subtitulo`, `colunas`, `itens[{titulo, texto, imagem, link, botao}]` |
| `texto` | `html` (escrito por quem administra o site), `alinhamento` (`justificado`, `esquerda`, `centro`) |
| `busca` | `titulo`, `subtitulo`, `botao`, `botaoEstoque` — vai para a listagem com `?q=` e `?marca=` |
| `vitrine` | `titulo`, `subtitulo`, `quantidade`, `botao` — os carros mais novos já saem no HTML (bom para SEO) |
| `depoimentos` | `titulo`, `subtitulo`, `fundo`, `itens[{nome, local, texto, nota, foto}]` |
| `galeria` | `colunas`, `imagens[{imagem, alt}]` |
| `formulario` | `titulo`, `subtitulo`, `botao`, `aviso`, `mensagem`, `campos[{rotulo, tipo, obrigatorio, dica, meia, opcoes}]` — envia pelo WhatsApp (site estático não tem servidor) |
| `chamada` | `titulo`, `texto`, `botao`, `mensagem`, `fundo` — faixa com botão de WhatsApp |

Blocos do template `servopa`: `carrossel` (`slides[{imagem, alt, link | mensagem}]`), `carrocerias` (atalhos por tipo, vindos do estoque), `busca` (marca com total, modelo dependente, preço e ano dos filtros do site, `atalhos`), `listagem` (`titulo`, `subtitulo`, `quantidade`, `filtros`, `botao`), `vitrine`, `chamada` (`link` ou `mensagem`), `titulo`, `texto`, `banner`, `lojas` (as lojas do site, com endereço, telefone e estoque de cada uma) e `formulario`.

## Para o web designer: criar páginas sem mexer em nada do sistema
Você só cria **arquivos HTML** numa pasta. Sem JSON, sem configuração, sem programação.

| Quero uma página... | Onde coloco | Vira |
|---|---|---|
| só para **um site** | `sites/<dominio>/paginas/feirao.html` | `/feirao/` |
| para **todos os sites** de um template | `templates/<template>/paginas-extras/financiamento.html` | `/financiamento/` em cada site |
| com imagens e CSS próprios | uma pasta: `sites/<dominio>/paginas/feirao/index.html` + `faixa.jpg`, `estilo.css`… | `/feirao/` (a pasta vai inteira) |
| dentro de uma seção | `sites/<dominio>/paginas/promocoes/feirao/index.html` | `/promocoes/feirao/` |

- **Escreveu só o conteúdo** (sem `<html>`)? A página entra com o **cabeçalho e o rodapé do site**.
- **Escreveu o documento inteiro** (`<html>…</html>`)? Vira página **100% livre** (landing de campanha). O sistema só acrescenta o aviso de cookies e o que faltar para funcionar no celular.
- **Links para o site:** escreva como num site normal, `href="/multipla/"`, `href="/contato/"`. O sistema ajusta.
- **Imagens da pasta:** caminho relativo normal (`src="faixa.jpg"`). Dá para abrir o `index.html` direto no navegador e ver.
- **Título da página:** vem do `<title>` ou do primeiro `<h1>`. Nada a configurar.
- **Opcional**, comentários no começo do arquivo: `<!-- titulo: ... -->`, `<!-- descricao: ... -->`, `<!-- rotulo: Feirão -->` (põe um link no rodapé), `<!-- moldura: nenhuma -->` (página livre mesmo sem `<html>`).
- **Opcional**, dados do site: `{{site.nome}}`, `{{estoque.total}}`, `{{#estoque.marcas}}<a href="{{link}}">{{valor}}</a>{{/estoque.marcas}}`.
- Nome do arquivo: letras minúsculas, números e hífen (`feirao-de-novembro.html`). Não use `multipla`, `carros`, `motor`, `css`, `js`, `img`, `assets` (são do sistema).
- Um site **troca** a página do template criando uma com o mesmo nome em `sites/<dominio>/paginas/`, ou **desliga**: `"paginasPadrao": { "financiamento": false }` no `site.json`.
- Exemplos prontos: `sites/autocentral.exemplo.com.br/paginas/` (feirão com imagem; Black Friday livre) e `templates/barra-topo/paginas-extras/financiamento.html`.
- Gerar e ver: `node core/build.js` e abrir `dist/<dominio>/`. Arquivo apagado da pasta some do site no próximo build.

## Páginas padrão (todo site ganha): `paginas-padrao/`
`contato`, `financiamento`, `avaliacao`, `politica-de-privacidade`, `politica-de-cookies` e `lgpd` ficam em `paginas-padrao/<nome>.json` (mesmo formato de uma página do `site.json`) e são geradas em **todos** os sites, com os dados de cada um: `{{site.nome}}`, `{{site.dominio}}`, `{{site.url}}`, `{{site.whatsapp}}`, `{{empresa.razaoSocial}}`, `{{empresa.cnpj}}`, `{{empresa.email}}`, `{{empresa.encarregado}}` e `{{rel}}` (prefixo até a raiz, para links internos). O jurídico muda o texto em **um** arquivo e o build atualiza os 2500 sites.
- Dados legais por site: `"empresa": { "razaoSocial": "...", "cnpj": "...", "email": "dpo@...", "encarregado": "Fulano" }` no `site.json` (sem eles, o texto usa o nome do site e a página de contato).
- O site **substitui** uma página padrão criando em `paginas` uma de mesmo `caminho`, ou **desliga**: `"paginasPadrao": { "lgpd": false }`.
- Página com `"provisorio": true` gera um aviso no build (uma vez, não um por site) até o texto oficial chegar.
- Formulário: campo `"opcoesDe": "lojas"` lista as lojas do site.
- Páginas com `"rotulo"` entram em `{{#site.links}}` (rodapé de todos os templates).
- **Aviso de cookies** (core, `core/ui/ui-site.js`, em todas as páginas): texto em `textos.avisoCookies`, link para a política de cookies (ou de privacidade); `"avisoCookies": false` desliga. O mesmo arquivo trata os formulários `.js-form-zap` (enviam pelo WhatsApp).
- Todo template precisa dos blocos `banner`, `vitrine`, `titulo`, `texto`, `formulario`, `lojas` e de carregar `{{rel}}motor/ui-site.js` em todas as páginas (o build e os testes cobram).

### Filtros (configuráveis por site)
`filtros` é a lista, na ordem em que aparece. Sem `filtros`, usa todos. Cada item é um nome (`"marca"`) ou um objeto com `campo` e, se quiser, `rotulo`, `opcoes` e `sempre`.

| campo | tipo | observação |
|---|---|---|
| `estado`, `cidade`, `loja` | lista | em cascata: o estado reduz as cidades, e a cidade reduz as lojas |
| `marca`, `modelo` | lista | `modelo` mostra só os modelos da marca escolhida |
| `cambio`, `combustivel`, `cor`, `carroceria` | lista | valores vazios não viram opção |
| `ano` | mínimo | "a partir de"; `opcoes` = anos |
| `preco`, `km` | máximo | "até"; `opcoes` = valores |

Filtro de lista com um único valor no site some sozinho (`"sempre": true` mantém). `busca: false` esconde a caixa de busca. `ordenacao` aceita `destaque` (ordem do estoque, padrão a partir do motor v2), `recentes`, `menor`, `maior`, `km`; a primeira da lista é a padrão.

### Restrições (o que o site pode vender)
`precoMin`, `precoMax`, `anoMin`, `marcas`, `estados` (lista de UF), `cidades`. Independem dos filtros: o carro fora da restrição nem entra no site.

## Templates
Cada template fica inteiro em `templates/<nome>/` e precisa ter `paginas/index.html`, `paginas/carro.html` e `paginas/vendido.html` (e `paginas/pagina.html` + `blocos/` se for usado em sites com páginas de conteúdo).
Para criar um template novo: copie `templates/barra-topo/` para `templates/meu-template/` e ajuste.
- Referencie os arquivos sempre com `{{rel}}`: `{{rel}}css/style.css`, `{{rel}}js/meu.js`, `{{rel}}motor/engine.js`, `{{rel}}motor/ui-lista.js`.
- Marcadores do build: `{{site.nome}}`, `{{site.slogan}}`, `{{site.textos.*}}`, `{{site.cabecalho.*}}`, `{{site.rodape.*}}`, `{{tema.*}}`, `{{rel}}`, `{{inicioUrl}}`, `{{estoqueUrl}}`, `{{{temaCss}}}`, `{{{fonteLink}}}`, `{{base}}`; `{{#x}}...{{/x}}` mostra se tiver valor ou repete listas; `{{^x}}...{{/x}}` é o contrário; `{{> nome}}` inclui `parciais/nome.html`.
- Na listagem e nas páginas, o `<body>` precisa de `data-rel="{{rel}}"` (a listagem pode estar numa subpasta).
- O HTML de cada card fica em `<script type="text/html" id="tpl-card">` com `[[nome]] [[versao]] [[ano]] [[km]] [[cambio]] [[cor]] [[combustivel]] [[carroceria]] [[preco]] [[loja]] [[local]] [[lojaLocal]] [[href]] [[imgattrs]] [[zap]] [[id]]` (`[[zap]]` = link do WhatsApp do carro). `<div id="grade" data-pagina="8">` define quantos cards aparecem por vez (padrão 24).
- Ids que a listagem precisa ter: `q`, `filtros-dinamicos`, `ord`, `contagem`, `grade`, `mais`, `limpar`, `copiar`, `tpl-card`.
- A cor, o arredondamento, a fonte e as colunas vêm do tema pelas variáveis CSS `--cor`, `--fundo`, `--texto`, `--raio`, `--fonte`, `--colunas`.

## Versões do motor: rascunho → alguns sites → todos
Cada site fixa a versão em `"motor": "v1"`. Mudar o motor não afeta nenhum site até você aplicar.
```
# 1) mexa em core/motor/rascunho/engine.js
node core/cli.js testar --motor rascunho --sites trokey.com.br
node core/build.js --sites trokey.com.br --motor rascunho      # gera em dist-preview/ para você olhar

# 2) está bom: congele (a versão fica imutável)
node core/cli.js congelar v2 --nota "o que mudou"

# 3) aplique em 1, 2 ou 3 sites
node core/cli.js aplicar v2 --sites trokey.com.br,primeseminovos.exemplo.com.br
node core/build.js --sites trokey.com.br,primeseminovos.exemplo.com.br

# 4) deu certo: aplique em todos
node core/cli.js aplicar v2 --todos
node core/build.js

# se algo der errado
node core/cli.js reverter --sites trokey.com.br
node core/cli.js historico
```
- `aplicar` roda os testes antes e só grava se passarem (`--sem-teste` pula, `--dry` só mostra).
- Os testes rodam o motor em Node (sem navegador): busca, busca com erro de digitação, filtros, cascata estado→cidade, link da busca e páginas geradas.
- A versão aplicada fica registrada no `site.json` de cada site e em `config/historico.json`.

## Busca
Procura em marca, modelo, versão, ano, cor, câmbio, combustível, loja, cidade e UF. Ignora maiúsculas e acentos, aceita pedaço de palavra e exige todas as palavras digitadas.
Tolera erro de digitação: se nenhum carro tem a palavra exata, procura a parecida (`civc` → civic) e avisa "mostrando resultados para...". Tolera 1 letra errada (2 em palavras com 7 letras ou mais); palavras com menos de 4 letras e números são sempre exatos.

## SEO
- **Cards no HTML:** a `/multipla` e as páginas de filtro já saem com os primeiros carros (24, ou o `data-pagina` do `#grade`) montados pelo build com o próprio `tpl-card` do template. O Google vê os carros sem rodar JS; no navegador, a `ui-lista` assume.
- **Páginas fixas de filtro:** `/multipla/marca/toyota/`, `/multipla/cidade/curitiba/`, `/multipla/carroceria/suv/` (título, descrição e canonical próprios, carros no HTML, filtro já aplicado via `<body data-filtro>`). Padrão: marca, cidade e carroceria; `"paginasFiltro": ["marca", "cidade", "carroceria", "combustivel", "modelo"]` no `site.json` muda. Só são criadas para filtros que o motor do site tem e com 2+ valores (1 valor seria conteúdo duplicado). Marca que sai do estoque tem a página apagada. Links de `{{#estoque.marcas}}`, `cidades`, `carrocerias` apontam para elas.
- **`"formatoUrls": "revendamais"`** (site.json): as páginas de filtro ficam nos endereços do Revenda Mais (`/multipla/marca/caoa chery/`, `/multipla/revenda_cidade_nome/Curitiba/`, `/multipla/carroceria/suv/`, `/multipla/combustivel/Elétrico/`, `/multipla/modelo-marca/COROLLA/`). Espaço e acento vão codificados nos links e no sitemap. Na hospedagem, servir também sem a barra final (`/multipla/marca/toyota` → `/multipla/marca/toyota/`).
- **Sitemap com `<lastmod>`:** o dia em que cada página mudou de verdade (guardado no estado do build), não o dia do build.
- Templates: a listagem usa `{{listagem.titulo}}`, `{{listagem.descricao}}`, `{{{listagem.canon}}}`, `{{listagem.h1}}` e `<body ... data-filtro="{{listagem.filtro}}">`.

## Links personalizados
- Busca: `?estado=SP&cidade=Campinas&marca=Honda&preco=100000&ord=menor` (o botão "Copiar link da busca" gera isso).
- Carro: `/carros/<Marca>/<Modelo>/<Versao>/<Marca>-<Modelo>-<Versao>-<ano>-<Cidade>-<Estado>-<id>.html`, página estática com preview para WhatsApp.
  Ex.: `/carros/Toyota/Corolla/Cross-Xre-20-Flex-Aut/Toyota-Corolla-Cross-Xre-20-Flex-Aut-2024-Curitiba-Parana-8643966.html`.
  A regra fica só em `core/ui/link-carro.js` (usada pelo build, pela listagem no navegador e pelos testes). Cada parte: sem acento e pontuação, palavras com inicial maiúscula separadas por hífen; o estado vai por extenso.
  Se o link de um carro mudar (mudou marca/modelo/versão/cidade no estoque), o endereço antigo **redireciona** para o novo por `retencaoRedirecionamentoDias` (padrão 180, por site). Carro vendido: os links antigos dele apontam para a página "indisponível".
- Vendedor: `?v=carlos` em qualquer link manda o WhatsApp para o número dele (fica lembrado na navegação).

## Fotos (S3 + CloudFront)
`carros/<id>/<n>-<largura>.webp`, larguras 400, 800 e 1600. Ex.: `https://fotos.seudominio.com.br/carros/BH0001/1-400.webp`. Foto que não existe vira placeholder.

## Atualizar estoque (o dia a dia)
O Revenda Mais tem **uma** API que devolve o JSON de carros de um site (`{"carros":[...]}` ou a lista direta). Você chama quando quiser:

**1) Você puxa** (`config/fontes.json`, veja `config/fontes.exemplo.json`; chave = domínio do site):
```
node core/cli.js atualizar                          # todos os sites de fontes.json
node core/cli.js atualizar trokey.com.br            # só esse
node core/cli.js atualizar trokey.com.br --publicar # e já publica o que mudou
```
**2) Qualquer sistema manda** (API de integração, contrato completo em [docs/api.md](docs/api.md)):
```
node core/cli.js cliente criar revenda-mais --sites "*"    # token do sistema (aparece uma vez; só o hash fica salvo)
PUBLICAR=1 node core/servidor.js                           # API em :8787
PUT    /v1/sites/<dominio>/estoque        estoque inteiro            → 202 + número do pedido (422 se inválido)
PUT    /v1/sites/<dominio>/carros/<id>    inclui/altera um carro
DELETE /v1/sites/<dominio>/carros/<id>    carro vendido
POST   /v1/sites/<dominio>/build          refaz o site sem mudar o estoque
GET    /v1/pedidos/<id>                   andamento    (?esperar=30 nas rotas acima responde já com o resultado)
```
A plataforma é agnóstica: não conhece o sistema de origem, cada um converte para o mesmo formato. Cada token só mexe nos sites dele. Chamadas em sequência viram um build só (`ATRASO_MS`, padrão 3 s), na ordem em que chegaram; a fila fica em disco (`.estado/api/`) e sobrevive a reinício. `TOKEN_ATUALIZAR` (16+ letras) segue valendo como admin, e as rotas antigas (`/atualizar`, `/status`, `PUT /sites/<d>/estoque`) continuam.

O que acontece:
- Valida tudo (ids únicos, loja existente no site, preço, ano, km, fotos, campos de texto). **Qualquer erro → nada é gravado**, o estoque antigo segue valendo.
- **Trava de queda:** se o estoque cair mais de 50% (ex.: API devolveu lista vazia por engano), recusa. `--forcar` libera.
- Estoque igual ao anterior → nada acontece. Guarda cópia do anterior em `.estado/estoques-anteriores/<dominio>.json`.
- Só o site daquele estoque é refeito; nele só as páginas dos carros que mudaram (+ `carros.json`).
- Carro que saiu: a página vira "Este veículo não está mais disponível" por `retencaoVendidosDias` (padrão 30, por site) e depois é apagada.
- Carro que mudou de link: o endereço antigo vira um redirecionamento para o novo (`retencaoRedirecionamentoDias`, padrão 180).
- Mudar motor ou filtros não refaz nenhuma página de carro. Mudar template/tema/textos refaz as páginas desse site. `--completo` força tudo.
- O que mudou e ainda não foi publicado fica em `.estado/dist/pendente.json`. `node core/cli.js publicar` (ou `--publicar`) roda, por site, o comando de `config/publicacao.json` (placeholders `{site} {pasta} {lista} {removidos} {completo}`) e só limpa a pendência dos sites que deram certo.

## Publicar
Antes de publicar: `node ferramentas/auditar-dist.js` confere os problemas clássicos de site estático no ar (404, cache de css/js, localhost, conteúdo misto, charset, JSON-LD, sitemap...). A publicação **recusa** site com `url` sem https ou `fotosBase` em localhost/http.

Na hospedagem: `404.html` na raiz de cada site é a página de erro (links a partir da raiz do domínio); css/js vão com `?v=<hash>` e podem ter cache de 1 ano (`Cache-Control: public, max-age=31536000, immutable`); HTML com cache curto; `/pasta/` precisa servir `/pasta/index.html`.

Cada `dist/<dominio>/` vai para o seu domínio. `config/publicacao.json` define o comando que sobe um site (S3 sync, rclone, wrangler...). Com `{lista}` você pode enviar só os arquivos alterados em vez da pasta toda.
