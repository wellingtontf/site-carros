# Visão geral

## O que é

- **Um site por domínio.** Cada revenda tem o seu site estático (só arquivos: HTML, CSS, JS, JSON), servido por CDN. Não
  há servidor de aplicação nem banco de dados atendendo o visitante.
- **Muitos sites, atualização prática.** A meta é 2500+ sites. Estoque, cadastro e páginas chegam pela API (ou por
  arquivo) e o build refaz **só o site que mudou** e, nele, **só as páginas que mudaram**.
- **Agnóstica.** A plataforma não conhece o sistema de origem (Revenda Mais, outro CRM, ERP): quem integra converte os
  dados para o formato da API.
- **Multi-tenant.** Vários inquilinos (Revenda Mais, Webmotors, terceiros), cada um com seus sites, tokens, temas e
  configuração de hospedagem.
- **Compatível com o Revenda Mais.** Os links já indexados no Google continuam valendo: página de carro no mesmo endereço
  (campo `link`), rotas da listagem com os nomes do Revenda Mais (`/multipla/revenda-cidade-nome/curitiba`).

## Como funciona, em uma figura

```
 sistema externo ──API /v1──▶ sites-config/<dominio>/     (a FONTE de cada site)
 (Revenda Mais...)             site.json  estoque.json  web/  componentes/  assets/
                                        │
          temas/<nome>/ ────────────┤
          componentes/<nome>/ ──────────┤   core/build.js  (incremental)
          core/motor/<versão>/ ─────────┘
                                        ▼
                               sites-public/<dominio>/    (a SAÍDA: o site pronto)
                                        │  node core/cli.js publicar (só o que mudou)
                                        ▼
                                 S3 + CloudFront ──▶ visitante
```

No navegador, a listagem (`/multipla/`) baixa o `estoque.json` do site e o **motor** (JavaScript) faz busca, filtros e
ordenação ali mesmo, sem servidor.

## Pastas

```
core/                      SÓ CÓDIGO, isolado (não importa nada de api/; um teste cobra)
  motor/rascunho/            o motor em desenvolvimento (único lugar onde se edita)
  motor/v1, v2, v3/          versões congeladas do motor (imutáveis; sha256 em versao.json)
  ui/                        código do navegador: ui-lista (listagem), rotas, link-carro, formato-estoque, ui-site...
  build.js                   gera os sites (incremental)
  cli.js                     status | testar | congelar | aplicar | reverter | historico | atualizar | publicar | sitemap | componentes | limpar-public | fotos
  caminhos.js                TODOS os caminhos do projeto (nada monta caminho fora daqui)
  sites.js                   repositório de sites: o ÚNICO que lê sites-config/
  componentes.js  paginas-livres.js  sitemap.js  robots.js  fotos.js  atualizar.js  operacoes.js  inquilinos.js ...
api/                       API HTTP (portas e adaptadores): só traduz HTTP ↔ core
sites-config/<dominio>/    A FONTE de cada site (o nome da pasta é o domínio e o id do site)
  site.json                  cadastro: tema, motor, configuracoes, textos, lojas, filtros, restrições...
  estoque.json               o ÚNICO arquivo de carros do site
  web/                       ESPELHO do site público: index.json (home), multipla.json (listagem), paginas/
  componentes/               opções dos componentes no site inteiro (<nome>.json)
  codigos/                   scripts do site (head.html, body.html): GTM, chat...; só depois do aceite de cookies
  assets/                    logo, banners, favicon, fontes
temas/<nome>/              UM TEMA, autocontido, estrutura do Shopify (barra-topo, lateral, template-basico)
  rascunho/  v1/  v2/        o designer edita o rascunho; vN são congeladas; o site fixa "versaoTema"
componentes/<nome>/        peças usadas por todos os temas e páginas (filtro, estoque, filtros-ativos)
inquilinos/<id>/           configuração e temas próprios de cada inquilino
config/                    configuração global (copie os .exemplo.json)
ferramentas/               servidor-local, auditar-sites, mover-paginas, migrar-temas, gerar-exemplo, scripts de infra
infra/                     Docker, Kubernetes, função de borda do CloudFront
docs/                      esta documentação
tests/                     testes automatizados (npm test)
```

Gerados e fora do git: `sites-public/` (sites prontos), `.estado/` (estado do build, fila da API, travas, pendências),
`dist-preview/` (prévia de motor rascunho), `s3-local/` (simula o bucket de fotos nos testes).

## Glossário

| Termo | O que é |
|---|---|
| **site** | uma pasta `sites-config/<dominio>/`; o domínio é o id |
| **fonte / saída** | `sites-config/` (o que se edita) / `sites-public/` (o que o build gera e vai para o ar) |
| **build** | `core/build.js`: transforma a fonte na saída ([passo a passo](como-o-build-funciona.md)) |
| **tema** | o visual de um grupo de sites (`temas/<nome>/`, estrutura do Shopify; ver [temas.md](temas.md)) |
| **configurações** | o que muda de uma revenda para outra dentro do tema: cor, fonte, logo (`"configuracoes"` no `site.json`); o tema declara o que aceita em `config/settings_schema.json` |
| **versão do tema** | `temas/<nome>/v1`, `v2`...: congeladas a partir do `rascunho/`; o site fixa a dele (`"versaoTema"`), como o motor |
| **layout** | a moldura comum de todas as páginas de um tema (`layout/tema.html`: head, cabeçalho, rodapé) |
| **template** | o arquivo de um tipo de página dentro do tema (`templates/home.html`...), encaixado no layout |
| **componente** | peça reutilizável com opções (`componentes/<nome>/`: filtro, estoque, filtros-ativos) |
| **seção** | pedaço de página (banner, vitrine, texto...), um HTML por tipo em `secoes/` do tema; as páginas listam em `"secoes"` |
| **snippet** | pedaço pequeno reaproveitado (head, cabeçalho, card), em `snippets/` (`{{> nome}}`) |
| **multipla** | a listagem do estoque, sempre em `/multipla/` |
| **rota** | filtros no endereço da listagem: `/multipla/marca/audi|bmw/revenda-estado-cod/pr` |
| **motor** | o JavaScript de busca e filtros (`core/motor/<versão>/engine.js`), versionado |
| **inquilino** | dono de um conjunto de sites (Revenda Mais, Webmotors...) |
| **rascunho** | site novo fora do Google (`site{n}.carro57.com.br`), promovido depois ao domínio final |
| **pendência** | o que mudou num site e ainda não foi publicado (`.estado/sites-public/pendentes/`) |

## Decisões de arquitetura (do Wellington)

- **Pastas são prioridade:** core isolado; cada site em `sites-config/<dominio>/` com subpastas; cada tema inteiro
  em `temas/<nome>/`; componentes numa pasta só; caminho novo vai em `core/caminhos.js`.
- **`sites-config` é a base de tudo que é gerado:** pasta em `sites-public/` sem site em `sites-config/` é sobra.
- **Um estoque por site:** `estoque.json` é o único arquivo de carros; cada carro diz a sua loja.
- **`web/` é o espelho do site público:** home, listagem e páginas ficam ali, como arquivos (o web designer cria uma página
  criando um arquivo). Páginas de conteúdo têm endereço `/paginas/<nome>/`; só a home fica na raiz.
- **Listagem sempre em `/multipla/`**, com os filtros como rota (nomes do Revenda Mais com `-`, valores minúsculos).
  O build não gera arquivo depois de `/multipla/`: a hospedagem entrega a listagem para qualquer rota.
- **Nomes do Shopify** (2026-11-08): tema, `templates/`, `secoes/`, `snippets/`, `assets/`, `config/settings_schema.json`; no `site.json`, `"tema"` e `"configuracoes"`.
- **Um arquivo por tipo de página no tema:** `home.html`, `multipla.html`, `carro.html`, `vendido.html`, `pagina.html`.
- **Páginas padrão (contato, LGPD...) são do tema**, não há pasta global.
- **Motor versionado:** edita-se só o rascunho; versões congeladas são imutáveis; cada site fixa a sua.
- **Fotos só no S3**, nunca no servidor.
- **Tudo é JSON**; não há mais feed XML.
- **Infra:** EKS na AWS, multi-tenant, escala horizontal (API e trabalhadores separados sobre EFS).

## Em aberto

1. Hospedagem dos 2500 domínios (CloudFront SaaS Manager é o caminho previsto) e o `comandoSite` da publicação.
2. Volume diário de mudanças de veículos (define se publicar só o que mudou basta).
3. Rollout do motor por ondas (canal estável/beta, percentual).
4. Script de exportação do Revenda Mais (precisa do formato da tabela de veículos).
5. Cadastro de cada domínio no Google Search Console e envio do sitemap (por API).
6. Textos legais oficiais (hoje são modelo provisório, até o jurídico mandar).
