# Contexto do projeto: plataforma de sites estáticos de carros

Responda em português informal. Dono do projeto: Wellington (dev PHP/Yii, trabalha no CRM Revenda Mais).

## Objetivo
Plataforma com ~2500 sites estáticos de revendas de carros, cada um em um domínio próprio. Os sites têm busca, filtros e links personalizados. As atualizações precisam ser muito práticas, porque são muitos sites.

## Decisões de arquitetura (já tomadas)
1. **Um site por domínio, um estoque por site:** `sites/<dominio>/` tem `site.json` (template, tema, textos, filtros, restrições, motor, vendedores, fotosBase, url e as `lojas` do site), `estoque.json` (o ÚNICO JSON de carros do site; cada carro diz sua `loja`, opcional se o site tem uma loja só) e `assets/` (logo, banner...). O nome da pasta é o domínio e o id do site (não há campo `id`). Não existe mais estoque nem loja compartilhados entre sites (decisão do Wellington: "sempre será passado só um json de estoque de carros").
2. **Core isolado, visual separado:**
   - `core/` é só código: `motor/<versao>/engine.js` (busca, filtros em cascata, estado na URL e WhatsApp; não mexe em DOM, roda no navegador e no Node), `ui/` (liga o motor à página), `caminhos.js` (todos os caminhos), `build.js`, `cli.js`, `atualizar.js`, `sites.js` (validar/gravar cadastro), `fotos.js`.
   - `api/` é a porta de entrada HTTP (portas e adaptadores): só traduz HTTP ↔ core. **`core/` nunca importa de `api/`** (um teste cobra).
   - `templates/<nome>/` é autocontido: `template.json`, `paginas/{index,carro,vendido}.html`, `css/`, `js/`, `img/`. Hoje há `barra-topo`, `lateral`, `trokey` e `servopa`. Não existe base compartilhada entre templates.
   - Páginas de conteúdo (home institucional, vender, lojas, política) são listas de **blocos** em `site.json` → `paginas`; cada tipo de bloco é `templates/<nome>/blocos/<tipo>.html`, a moldura é `paginas/pagina.html`, e pedaços comuns ficam em `parciais/` (`{{> nome}}`). `estoque.caminho` põe a listagem numa subpasta (Trokey: `/estoque/`). `cabecalho` e `rodape` também vêm do `site.json`. Hoje só o template `trokey` tem blocos.
   - **A listagem do estoque fica SEMPRE em `/multipla/`** (constante `CAMINHO_ESTOQUE` no build); a raiz é a home institucional (página `""` de `paginas`, ou a `HOME_PADRAO` do core: banner + vitrine). Todo template precisa de `paginas/pagina.html` e dos blocos `banner` e `vitrine`. O bloco `listagem` põe o estoque interativo dentro de uma página (ex.: home da Servopa).
   - **Compatível com o Revenda Mais (migração sem perder SEO):** campo `link` no carro (o link que o Revenda Mais já usa; tem regras/bugs próprios como cidade sem a letra acentuada "Maring", "//" e "R/t", impossíveis de recalcular) e `"formatoUrls": "revendamais"` no site (`/multipla/marca/<minúsculo>`, `/multipla/revenda_cidade_nome/<Cidade>`...). Endereços com espaço/acento vão codificados (função `url()` no build). Sitemap real da Servopa: só home, /multipla, /financiamento, /avaliacao, /contato, /multipla/marca/* e os carros.
   - **Ordem de exibição vem do estoque:** campo `ordem` (ou a posição no arquivo) → `carros.json` sai nessa ordem (campo `r`) e o motor v2 tem a ordenação `destaque` (padrão). Campos opcionais do carro: `ordem`, `destaque`, `carroceria`.
   - **Páginas padrão** (`paginas-padrao/*.json`: contato, política de privacidade, cookies, LGPD) entram em TODO site, preenchidas com `{{site.*}}`/`{{empresa.*}}`/`{{rel}}`; o site substitui (mesmo `caminho`) ou desliga (`paginasPadrao`). Textos legais estão como MODELO PROVISÓRIO até o jurídico do Revenda Mais mandar o oficial. Aviso de cookies e formulários por WhatsApp ficam no core (`core/ui/ui-site.js`), carregado por todas as páginas de todos os templates.
   - **Páginas livres dos designers** (HTML normal, sem JSON): `sites/<dominio>/paginas/` (só aquele site) e `templates/<nome>/paginas-extras/` (todos os sites do template). Lógica em `core/paginas-livres.js`. Prioridade de mesmo caminho: `site.json` > pasta do site > template > `paginas-padrao/`. Editar `paginas-extras` NÃO refaz páginas de carro (fica fora do hash do template). O designer não pode precisar mexer no core: tudo que ele fizer de comum (links "/x", título, imagens na pasta) o build resolve.
   - O web designer mexe só nos templates e nas pastas de páginas.
3. **Motor versionado, com rollout:** `core/motor/rascunho` é o único lugar onde se edita. `congelar vN` copia o rascunho para `core/motor/vN`, que passa a ser imutável. `aplicar vN --sites a,b` ou `--todos` roda os testes antes. Existem `reverter` e `historico`. O site fixa a versão em `"motor": "v1"`.
4. **Filtros configuráveis por site:** estado, cidade, loja, marca, modelo, ano, preço, km, câmbio, combustível e cor. Estado, cidade e loja funcionam em cascata, e marca filtra modelo. Dá para mudar rótulos, opções e ordem, e há `restricoes` (precoMin, precoMax, anoMin, marcas, estados, cidades).
5. **Busca com tolerância a erro de digitação:** só tenta aproximar quando não há resultado exato. Palavras com 4 letras ou mais e não numéricas aceitam 1 erro (2 erros se tiver 7 letras ou mais). Ignora acento e maiúsculas, aceita pedaço de palavra e exige todas as palavras digitadas.
6. **Fotos no AWS S3:** `carros/<id>/<n>-<400|800|1600>.webp`, via `fotosBase`. Se a foto falhar, aparece um placeholder. O carro pode mandar `fotos` como número (já estão no armazenamento) ou como lista de URLs (`core/fotos.js` baixa e converte em segundo plano; o build conta só as fotos prontas, então o carro entra sem foto e a página dele é refeita quando elas ficam prontas). `node core/cli.js fotos [sites]` processa na mão.
7. **Links:** `?estado=SP&cidade=...&marca=...&ord=menor` (estado da busca), `/carros/<Marca>/<Modelo>/<Versao>/<Marca>-<Modelo>-<Versao>-<ano>-<Cidade>-<Estado>-<id>.html` (página estática por carro, com preview de WhatsApp; regra ÚNICA em `core/ui/link-carro.js`, usada no build, no navegador e nos testes) e `?v=carlos` (roteia o WhatsApp para o vendedor). Link de carro que muda (dados do estoque mudaram) vira redirecionamento para o novo por 180 dias (`retencaoRedirecionamentoDias`); o estado guarda `links`, `vendidos {data, link}` e `redirecionados` por site.
8. **Origem dos carros:** vêm de outro sistema (Revenda Mais). Ele terá UMA API que gera o JSON de carros de um estoque, e o Wellington chama quando achar melhor (gatilho manual, não é webhook obrigatório).

## Multi-tenant e Kubernetes (decisão do Wellington: escalar para 2500+ sites, EKS na AWS, vários inquilinos)
- **Inquilinos:** `inquilinos/<id>/inquilino.json` (nome, templates liberados, `rascunhos.padrao`) + `inquilinos/<id>/config/` (fotos, infra, publicacao, robots.txt, site-modelo). Site diz `"inquilino"` no site.json; sem ele = `padrao` (usa `config/` global). `core/inquilinos.js` resolve config do inquilino → global. Os 5 sites atuais são `revenda-mais` (rascunho `site{n}.carro57.com.br`).
- **Tokens por inquilino** (`api/clientes.js`): `"*"` = todos os sites DO inquilino; só `TOKEN_ATUALIZAR` (admin) atravessa. Domínio único na plataforma.
- **Escala:** `PAPEL=api|trabalhador|tudo` (api/servidor.js). Fila em arquivos no volume compartilhado (`api/fila.js`: pedidos, marcas por site, lotes); `api/trabalhador.js` reserva um site por vez (trava `fila-<canal>-<site>`), N pods em paralelo; canal `fotos` separado. Travas por site em `core/trava.js` (`.estado/travas/`, expiram em 30 min). Pendências de publicação por site (`core/pendentes.js`, reserva atômica). "Todos" = lote com um pedido por site.
- **Remover site:** `DELETE /v1/sites/<d>?confirmar=<d>` (core: `Ops.removerSite` → `Sites.arquivarArquivos`): arquivos para `.estado/removidos/<d>-<data>/` (recuperável), saída apagada, fotos apagadas (`Fotos.apagarFotosDoSite`), tokens atualizados, infra `remover`. O `autocentral.exemplo.com.br` foi removido assim em 2026-11-08 (os exemplos de páginas livres dele ficaram no git).
- **Templates do inquilino:** `inquilinos/<id>/templates/<nome>/` (no EFS, sem deploy) valem só para ele e substituem o da imagem de mesmo nome (`Inq.dirTemplate`). Travas renovadas durante o trabalho (`renovarMinhas` no laço do build), expiram em 5 min. Índice de pedidos por site/cliente.
- **Scripts de infra:** `ferramentas/infra/{criar,promover,renomear,remover}.sh` (CloudFront SaaS Manager + S3; `SIMULAR=1`), chamados pelo `infra.json` do inquilino com os IDs dele.
- **Infra:** `infra/docker/Dockerfile` (código na imagem; dados em /dados = EFS; `SITE_CARROS_TEMPLATES`/`SITE_CARROS_PAGINAS_PADRAO`), `infra/k8s/` (kustomize: EFS RWX, api + HPA, trabalhador + KEDA pela métrica `site_carros_fila_pedidos`, ALB, IRSA), `infra/cloudfront/roteador.js` (função de borda: index.html, barra final, `//`). `/v1/pronto` e `/metrics` para o Kubernetes. Nada aplicado numa conta AWS ainda.

## Estrutura de arquivos
```
core/                         SÓ CÓDIGO (isolado)
  caminhos.js                 todos os caminhos do projeto (nada monta caminho fora daqui)
  build.js                    build incremental (estado em .estado/<pasta>/<dominio>.json, pendências em pendente.json)
  cli.js                      status | congelar | testar | aplicar | reverter | historico | atualizar | publicar
  atualizar.js                valida, grava sites/<dominio>/estoque.json e reconstrói só aquele site; publicarPendentes()
  robots.js                   modelo do robots.txt (config/robots.txt; site.json "robots" vale mais), validação com trava
                              contra Disallow: / ; atualizar.reescreverRobots() reescreve só o robots.txt de todos os sites
  sites.js                    REPOSITÓRIO DE SITES: o único que lê sites/ (listar, existe, carregar, carregarTodos, lojas, estoque,
                              resumo, resumos, validarSite, cadastroNovo, gravarSite, criarArquivos, renomearArquivos). Nada mais
                              lista sites por conta própria (um teste cobra)
  operacoes.js                criarSite (estrutura + build + infra "criar"), promoverSite (RASCUNHO → definitivo: domínio final, tira
                              "rascunho", gera do zero sem o histórico, infra "promover") e renomearSite (site já no ar: leva o histórico
                              de SEO, infra "renomear" com 301), com volta atrás. "rascunho": true = noindex em tudo + robots fechado.
                              Rascunhos em sequência site{n}.carro57.com.br (config/rascunhos.json; contador em .estado/rascunhos.json,
                              número nunca reutilizado; Sites.proximoRascunho/ehDominioRascunho); config/infra.json liga à hospedagem; config/site-modelo.json = padrão de site novo
  trava.js, versoes.js        trava de execução (.estado/atualizar.lock) e versões congeladas do motor
  fotos.js                    fotos por URL: baixa (anti-SSRF), converte (converter-foto.py/Pillow ou comando de config/fotos.json),
                              "enviar" sobe para a S3 a partir de pasta temporária (nada fica no servidor), "apagar" tira as de
                              carro que saiu; sem "enviar" grava em "pasta" (teste local). Estado em .estado/fotos/<dominio>.json
api/                          API de integração (contrato: api/README.md). Depende do core; o core nunca depende dela
  servidor.js                 liga tudo: token, HTTP, fila, trabalhador de fotos
  rotas.js                    /v1: POST sites (site novo só com domínio), POST sites/<d>/dominio (troca domínio), PUT site (cria se não existe), POST estoques (1..N sites), PUT estoque, PUT/DELETE carro,
                              POST build (lista ou todos), PUT/DELETE robots (todos os sites), POST atualizar (fontes), GET pedidos
  fila.js                     pedidos em disco (.estado/api/): aplica na ordem, valida um a um, 1 build por site por lote
  clientes.js, cli.js         tokens por sistema externo (config/clientes.json, só sha256): node api/cli.js cliente criar <nome> --sites a,b|*
  trabalhador-fotos.js        fotos em segundo plano; quando ficam prontas, pede o build do site
  http.js                     utilidades HTTP
  motor/rascunho, motor/vN    engine.js (vN imutável)
  ui/                         ui-util.js, ui-lista.js, ui-carro.js → vão para <site>/motor/ no build
sites/<dominio>/              site.json, estoque.json, assets/
templates/<nome>/             template.json, paginas/, css/, js/, img/
config/                       fontes.exemplo.json, publicacao.exemplo.json (copiar sem .exemplo; ignorados no git), historico.json
ferramentas/                  gerar-exemplo.js, importar-trokey.py (teste de migração), auditar-dist.js (problemas de site estático no ar)
```
Saída: `dist/<dominio>/` com `motor/` (core), `css/ js/ img/` (template), `assets/` (site), `index.html`, `404.html` (links a partir da raiz; `pagina404` no site.json), `estoque.xml` (feed XML de compatibilidade; `feedXml` no site.json), `carro/<id>/`, `carros.json`, `config.json`, `sitemap.xml`, `robots.txt`.
**Pastas de saída:** `dist/` é a ÚNICA que vale (build, API, publicação). `dist-preview/` = `build.js --motor rascunho` (para olhar um motor novo; nunca publicada). `node core/cli.js testar` gera numa pasta temporária em `.estado/` e apaga no fim; os testes automáticos usam pastas temporárias fora do projeto. Uma `dist-teste/` na raiz é sobra antiga: pode apagar.
Gerados e fora do git: `dist*/`, `.estado/`, `s3-local/` (simula o bucket de fotos; servido em :8081 nos testes locais).

## Como a atualização funciona (já implementado e testado)
- `node core/cli.js atualizar [dominios] [--publicar] [--forcar] [--completo]` busca em `config/fontes.json` (`{dominio: url | {url, headers}}`, aceita `${VAR}` de ambiente, timeout de 30 s).
- **Validação:** ids únicos, `loja` existente em `site.json` (obrigatória se o site tem mais de uma loja), marca/modelo/versão/cor/câmbio/combustível preenchidos, ano de 1950 até o ano atual + 2, preço > 0, km ≥ 0, fotos de 0 a 60. Qualquer erro → nada é gravado, e o estoque antigo continua valendo.
- **Trava de queda:** se o estoque cair mais de 50% (a partir de 10 carros), recusa. `--forcar` libera.
- Estoque igual ao anterior → nada acontece. O anterior é guardado em `.estado/estoques-anteriores/`.
- Só o site daquele estoque é refeito, e nele só as páginas dos carros que mudaram, mais o `carros.json`.
- **Carro que saiu:** a página vira "Este veículo não está mais disponível" (noindex) por `retencaoVendidosDias` (padrão 30, por site) e depois é apagada. Os links antigos dele apontam para essa página.
- Trocar motor ou filtros não refaz páginas. Trocar template, tema ou textos refaz as páginas do site.
- **Publicação:** `config/publicacao.json` = `{paralelo, comandoSite}`, com os placeholders `{site} {pasta} {lista} {removidos} {completo}`. Só limpa a pendência dos sites publicados com sucesso.
- Há trava de execução simultânea (`.estado/atualizar.lock`, expira em 30 min).
- **API agnóstica** (`api/`, contrato em api/README.md): qualquer sistema cria/atualiza sites e manda estoque (1 ou N sites por chamada, inteiro ou carro avulso) com o token dele (`node api/cli.js cliente criar <nome> --sites a,b|*`). Criar site e refazer todos exigem `*`. Valida na hora (422), devolve número de pedido (`?esperar=N` responde com o resultado), junta rajadas (`ATRASO_MS`, 3000 ms) num build por site, e a fila fica em disco. Aceita até 100 MB no PUT do estoque.
- css/js saem com `?v=<hash do conteúdo>` (cache longo na CDN). Os do template entram no hash das páginas; os do core (`motor/`) não, então `core/ui` precisa continuar funcionando com HTML antigo.
- `problemasProducao(site)` no build: `url` sem https ou `fotosBase` em localhost/http → o build avisa e a publicação recusa o site (a Trokey usa localhost:8081 de propósito, para o teste local).

## Medições (site de 1000 carros)
- `carros.json`: 186 KB (15 KB com gzip). Motor + CSS + JS: ~25 KB (~10 KB com gzip). Página de carro: 4 KB. Pasta do site: 12 MB (1000 páginas).
- Chrome simulando celular (4G rápido, CPU 4x mais lenta): primeira tela 0,6 s, lista pronta 1,2 s, ~263 KB baixados, CLS 0.
- Em 3G lento (CPU 6x): primeira tela 0,8 s, lista pronta 1,8 s.
- Busca respondeu em ~140 ms.
- SEO: a `/multipla` e as páginas fixas de filtro (`/multipla/marca/<x>/`, `/cidade/<x>/`, `/carroceria/<x>/`, campo `paginasFiltro`) já saem com os primeiros cards no HTML (montados pelo build com o `tpl-card` do template). Sitemap com `<lastmod>` real (dia em que a página mudou, guardado em `.estado`). O build gera `sitemap.xml`, `robots.txt` e JSON-LD (`Car` + `Offer`) quando o site tem `url`. As páginas de carro têm title, description, canonical e og:image.
- A compressão (gzip/brotli) precisa estar ligada no servidor/CDN.

## Regras ao mexer no código
- **Arquitetura de pastas é prioridade do Wellington:** core isolado em `core/`; cada site em `sites/<dominio>/` com subpastas; cada template inteiro dentro de `templates/<nome>/` (nada solto na raiz de `templates/`). Caminho novo → adicionar em `core/caminhos.js`.
- Nunca editar versões congeladas do motor (`core/motor/v1`, ...). Só `core/motor/rascunho`.
- Rodar `npm test` antes de entregar mudanças (139+ testes, ~10 s; `npm run test:rapido` pula o Chrome). Bug corrigido → teste de regressão junto. O GitHub Actions roda os testes a cada push.
- `VERSAO_HTML` em `core/build.js`: aumentar SÓ quando mudar o HTML/JSON gerado pelo build (refaz as páginas de todos os sites). O `tests/snapshot-html.test.js` cobra; depois de aumentar, `npm run test:snapshot`.
- Versões congeladas do motor têm `sha256` em `versao.json` (o `congelar` grava); `tests/motor.test.js` falha se alguém editar uma.
- Os testes usam `SITE_CARROS_RAIZ` (pasta de dados temporária) e `construir({ hoje })` / `SITE_CARROS_HOJE` (data simulada para retenção).
- Build incremental: depois de mudar o `core/build.js`, rodar `node core/build.js` duas vezes. A segunda deve dizer "sem mudanças".
- Nos templates, referenciar arquivos sempre com `{{rel}}` (`{{rel}}css/style.css`, `{{rel}}motor/engine.js`). Imagens do `tema` com caminho relativo (`assets/logo.png`) já chegam com o prefixo certo em `{{tema.logo}}`.
- O template mini-renderer usa `{{x}}` (escapa), `{{{x}}}` (HTML cru, só gerado pelo build), `{{#x}}…{{/x}}` e `{{^x}}…{{/x}}`. Os cards ficam em `<script type="text/html" id="tpl-card">` com tokens `[[campo]]`.
- Tema por variáveis CSS: `--cor --fundo --texto --raio --fonte --colunas`.
- Ids que a listagem exige: `q, filtros-dinamicos, ord, contagem, grade, mais, limpar, copiar, tpl-card`.
- O motor é criado com `Motor.criar({dados:'carros.json', config:'config.json', carregar})`.

## Ainda em aberto
1. **Hospedagem dos 2500 domínios:** S3+CloudFront, Cloudflare Pages ou outro? Isso define o `comandoSite` do `publicacao.json`. Com `--delete` em `aws s3 sync`, cuidado com a publicação incremental; use `{lista}` para enviar só os arquivos alterados.
2. **Volume diário de mudanças de veículos:** define se publicar só o que mudou basta ou se precisa de outra abordagem.
3. **Rollout por ondas:** campo `canal` (estável/beta), `--percentual`, `--grupo`, e roteador por domínio. Não implementado.
4. ~~Páginas fixas de cidade/marca~~ feito: `/multipla/marca|cidade|carroceria/<x>/`. Falta mapear as URLs antigas do Revenda Mais (`/multipla/marca/TOYOTA`, `/multipla/revenda_cidade_nome/...`) com 301 na hospedagem.
5. **Script de exportação do Revenda Mais:** precisa de um exemplo do formato de exportação, ou da estrutura da tabela de veículos (campos de data de atualização e status).
6. Cadastrar cada domínio no Google Search Console e enviar o sitemap (por API, dado o volume).
7. Builds em paralelo para muitos sites, se o tempo ficar alto.

## Primeiro pedido
Leia este arquivo e o README.md. Rode `node ferramentas/gerar-exemplo.js`, `node core/build.js` (duas vezes) e `node core/cli.js testar`, e me diga se está tudo certo. Depois me ajude a configurar a publicação e a `fontes.json`.