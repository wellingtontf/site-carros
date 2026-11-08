# Documentação da plataforma

Plataforma que gera e mantém **milhares de sites estáticos de revendas de carros** (meta: 2500+ domínios), cada um no
seu domínio, com busca, filtros, páginas de carro e páginas institucionais. Tudo o que um site tem vem de arquivos JSON
(cadastro, estoque, páginas), que outros sistemas mandam pela API. Um **build** transforma isso em HTML pronto, que vai
para a CDN.

## Por onde começar

| Você é... | Leia |
|---|---|
| novo no projeto | [Visão geral](visao-geral.md) → [Como o build funciona](como-o-build-funciona.md) |
| quem configura um site (cadastro, lojas, filtros) | [Configurar um site](configurar-um-site.md) |
| web designer (páginas, visual) | [Páginas](paginas.md) → [Templates](templates.md) → [Componentes](componentes.md) |
| quem integra outro sistema (CRM, ERP) | [API](api.md) |
| dev do motor de busca / listagem | [Listagem, busca e rotas](listagem-e-busca.md) |
| quem cuida do dia a dia do estoque | [Estoque e atualização](estoque-e-atualizacao.md) |
| quem publica e cuida da hospedagem | [Publicação e hospedagem](publicacao-e-hospedagem.md) → [Infraestrutura](infraestrutura.md) |
| quem mexe no código | [Testes](testes.md) e as regras do [CLAUDE.md](../CLAUDE.md) |

## Todos os documentos

| Documento | Conteúdo |
|---|---|
| [visao-geral.md](visao-geral.md) | o que é, arquitetura, pastas, glossário, decisões |
| [como-o-build-funciona.md](como-o-build-funciona.md) | `sites-config/` → build → `sites-public/` → publicação, passo a passo |
| [configurar-um-site.md](configurar-um-site.md) | `site.json` campo a campo, lojas, filtros, restrições, formato do `estoque.json` |
| [paginas.md](paginas.md) | pasta `web/`: home, listagem e páginas; páginas de blocos, livres (designer) e padrão; blocos de cada template |
| [templates.md](templates.md) | os 5 arquivos de um template, marcadores, card, tema, como criar um template |
| [componentes.md](componentes.md) | filtro, estoque e filtros ativos: opções, camadas de configuração, como criar um |
| [listagem-e-busca.md](listagem-e-busca.md) | rotas da `/multipla/`, filtros com vários valores, busca, motor e suas versões |
| [estoque-e-atualizacao.md](estoque-e-atualizacao.md) | atualizar estoque, validações e travas, carros vendidos, links de carro, fotos |
| [api.md](api.md) | contrato da API `/v1` (para quem integra) |
| [publicacao-e-hospedagem.md](publicacao-e-hospedagem.md) | publicar, auditar, cache, servidor local, nginx/Apache |
| [infraestrutura.md](infraestrutura.md) | Kubernetes (EKS) na AWS, multi-tenant, CloudFront para 2500 domínios |
| [testes.md](testes.md) | o que cada teste garante, `VERSAO_HTML` e snapshot |
| [historico-da-conversa.md](historico-da-conversa.md) | backup do contexto: linha do tempo, decisões e todos os pedidos que construíram o projeto |

## Comandos do dia a dia

```
node core/build.js                         # gera todos os sites em sites-public/ (incremental)
node core/build.js --sites loja.com.br     # só um site
node core/cli.js testar                    # testa os sites gerados (motor, links, páginas)
node ferramentas/servidor-local.js 8080    # http://localhost:8080/<dominio>/ (mesmas regras da hospedagem)
npm test                                   # todos os testes (~1 min com o Chrome; npm run test:rapido sem ele)
node api/servidor.js                       # API em :8787
node core/cli.js status                    # versões do motor e o que cada site usa
```
