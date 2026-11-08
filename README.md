# Site de carros: plataforma de sites estáticos de revendas

Gera e mantém milhares de sites estáticos de revendas de carros (meta: 2500+ domínios), cada um no seu domínio, com busca,
filtros, página de cada carro e páginas institucionais. Cadastro, estoque e páginas chegam pela API (ou por arquivo); o
**build** gera o HTML pronto, refazendo só o site que mudou e, nele, só as páginas que mudaram; a publicação manda só o
que mudou para a CDN.

**Documentação completa: [docs/](docs/README.md)** — visão geral, como o build funciona passo a passo, configurar um site,
páginas, temas, componentes, listagem e rotas, estoque, API, publicação, infraestrutura e testes.

## Pastas

```
core/                      só código, isolado: build, motor de busca (versionado), código do navegador (core/ui)
api/                       API HTTP /v1 (porta de entrada; o core nunca depende dela)
sites-config/<dominio>/    A FONTE de cada site: site.json, estoque.json, web/ (home, listagem, páginas), componentes/, assets/
temas/<nome>/              um visual por pasta (estrutura do Shopify), com versões: rascunho/ (edita) e v1/, v2/ (congeladas)
componentes/<nome>/        filtro, estoque, filtros-ativos (usados por todos os temas)
inquilinos/<id>/           configuração e temas de cada inquilino (multi-tenant)
config/  ferramentas/  infra/  tests/  docs/
```
Gerados (fora do git): `sites-public/<dominio>/` (o site pronto), `.estado/` (estado do build, fila, travas), `s3-local/`.

## Rodar

```
npm test                                   # todos os testes (Node 20+; Chrome opcional)
node core/build.js                         # gera todos os sites em sites-public/
node ferramentas/servidor-local.js 8080    # http://localhost:8080/<dominio>/ (mesmas regras da hospedagem)
node core/cli.js testar                    # testa os sites gerados
node api/servidor.js                       # API em :8787 (token: node api/cli.js cliente criar <nome> --sites "*")
node core/cli.js status                    # versões do motor e o que cada site usa
node core/cli.js tema status               # versões dos temas (rascunho → v1, v2...) e o que cada site usa
```
Também como `npm run build`, `npm run testar`, `npm run status`, `npm run api`, `npm run cli -- <comando>`.

## Sites de teste no repositório

| Site | Tema | Estoque |
|---|---|---|
| `lojateste.com.br` | template-basico | 100 carros de teste (URLs de foto longas; já teve 1500 para os testes de tamanho); filtro com caixas de marcar; `estoque.json` compacto |
| `primeseminovos.exemplo.com.br` | template-basico | 400 carros (`node ferramentas/gerar-exemplo.js`), 297 no site por `precoMin` |

Exemplos de rota: `http://localhost:8080/lojateste.com.br/multipla/revenda-estado-cod/pr|rs/marca/audi|bmw`.
