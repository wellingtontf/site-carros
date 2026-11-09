# Testes

```
npm test               # tudo (~1 min com o Chrome): 320 testes
npm run test:rapido    # sem o navegador (Chrome)
npm run test:snapshot  # regrava o snapshot do HTML (depois de aumentar VERSAO_HTML)
npm run test:cobertura # quais linhas do código os testes executam (sem o Chrome)
node core/cli.js testar  # testa os sites reais gerados (motor com os dados de verdade, páginas, links)
```

O GitHub roda tudo a cada push (`.github/workflows/testes.yml`). Os testes usam uma pasta de dados temporária
(`SITE_CARROS_RAIZ`), nunca os sites de verdade, e uma data simulada (`construir({ hoje })` / `SITE_CARROS_HOJE`) para
testar retenção de vendidos e redirecionamentos. O ajudante comum é `tests/ajuda.js`.

**Cobertura (2026-11-08):** todo arquivo **JavaScript** de `core/`, `api/`, `ferramentas/` e `infra/` com **100% das linhas**
executadas pelos testes (`npm run test:cobertura`; o "all files" fica um pouco abaixo porque conta também as linhas dos próprios
testes, como os que pulam sem Chrome). O código que só roda no navegador (`core/ui/ui-lista.js`, `ui-site.js`,
`ui-carro.js`, o JS do tema) não entra nessa medição: ele é coberto pelo `navegador.test.js`, no Chrome, com cliques de
verdade. Os scripts `.sh` de infraestrutura são testados no `infra-scripts.test.js` (modo simulação), e o conversor de fotos
`core/converter-foto.py` no `fotos.test.js`; o `ferramentas/importar-trokey.py` (do site trokey, que saiu) não tem teste. Código novo entra com teste; a medição mostra o que ficou de fora (coluna "uncovered lines").

## O que cada arquivo garante

| Arquivo | Garante |
|---|---|
| `unidade-link-carro.test.js` | regra do link da página do carro (a mesma no build, no navegador e nos testes) |
| `unidade-render.test.js` | mini-renderer: `{{x}}` escapa (XSS), `{{{x}}}` cru, listas, condicionais |
| `unidade-validacao.test.js` | validação do estoque: qualquer erro → nada gravado |
| `motor.test.js` | busca, busca aproximada, filtros em cascata, vários valores (v3+), link da busca, ordens, WhatsApp — em **todas** as versões; e que as congeladas não foram editadas (`sha256`) |
| `rotas.test.js` | rotas da listagem (`core/ui/rotas.js`): nomes do Revenda Mais com `-` e `_`, `|`/`%7C`, minúsculas; motor v3; links do build como rota; servidor local = regras da hospedagem |
| `formato-estoque.test.js` | `estoque.json` compacto: menor e com o motor dando os mesmos resultados |
| `build.test.js` | geração, layout do tema (blocos `{{$...}}`), configurações do tema (padrão, aviso, tipo errado), scripts de terceiros (`codigos/`, integrações, rascunho), incremental, vendidos e retenção, redirecionamentos, ordem, `web/` (home, multipla, páginas), páginas livres, seções, links relativos, `paraFiltro`, migração (`mover-paginas.js` e `migrar-temas.js`: nome antigo dá erro claro e, migrado, sai idêntico), segurança, erros de configuração |
| `componentes.test.js` | componentes (barra-busca, filtro, estoque, filtros-ativos): camadas de opções (componente < tema < site < página), validação, CSS/scripts injetados sem repetir, ids únicos, opção `checkbox` do filtro, `web/multipla.json` |
| `sites-config-public.test.js` | contrato fonte → saída: cada parte de `sites-config/<d>/` aparece em `sites-public/<d>/` e o que sai da fonte sai da saída; sobras |
| `temas-versoes.test.js` | versões dos temas pela linha de comando: congelar (rascunho igual recusado, sha256), prévia do rascunho em `dist-preview/`, aplicar (testa antes, grava só `versaoTema`, `--todos` = sites do tema), versão com defeito não é aplicada, reverter, `versaoTema` obrigatória |
| `comandos.test.js` | os comandos de terminal rodando de verdade (processo separado): `core/cli.js` (status, testar, aplicar/reverter o motor, sitemap, limpar-public, publicar, atualizar com fotos, fotos), `api/cli.js` (inquilinos e tokens), `core/build.js`, `servidor-local.js`, `auditar-sites.js`, `gerar-exemplo.js`, `migrar-temas.js` (tudo de uma vez, com conflito) e `mover-paginas.js` |
| `contratos.test.js` | os arquivos de `core/ui` viram `window.Rotas`, `window.LinkCarro`, `window.FormatoEstoque` no navegador (iguais aos do Node); `congelar` do motor numa cópia (`SITE_CARROS_MOTOR`) |
| `sitemap.test.js` | `gerarSitemap(dominio)` igual ao do build |
| `xml-robots.test.js` | robots.txt por modelo e por site; `estoque.xml` e `carros.json` antigos são apagados e despublicados |
| `snapshot-html.test.js` | o HTML gerado só muda junto com `VERSAO_HTML` (veja abaixo); arquivos só copiados (`motor/`, `css/`, `componentes/`) ficam de fora |
| `atualizar.test.js` | fontes HTTP (`${VAR}`, erro 500, JSON quebrado), trava de queda, estoque vazio, trava de execução, publicação incremental, injeção no shell |
| `fotos.test.js` | fotos por URL: baixa, converte, renumera, não baixa de novo, SSRF (inclusive por redirecionamento), falha de envio fica pendente, caminho completo pela API |
| `producao.test.js` | problemas de site estático no ar: 404, `?v=` nos css/js, canonical em página livre, publicação recusa fotos em localhost/http, auditoria |
| `servidor.test.js` | API: `/v1/saude`, `/v1/pronto` e `/metrics` (Kubernetes), `GET /v1/pedidos`, `POST /v1/atualizar` (fonte ok e fonte com erro), `PUBLICAR=1` (publica e anota no pedido; build que quebra = pedido com erro), tokens por cliente, 403 em site alheio, 422 com erros, estoque inteiro, carro avulso, rajada num build só, trava de queda (409), fila que sobrevive a reinício, site novo |
| `api-ponta-a-ponta.test.js` | um site montado **só pela API** (cadastro, estoque, páginas, multipla, componentes, arquivos) gera tudo, sem link quebrado nem problema de produção |
| `sites-repositorio.test.js` | `core/sites.js` é o único que lista sites; site novo só com o domínio em todos os temas; troca de domínio que volta atrás se falhar |
| `inquilinos.test.js` | multi-tenant: cada inquilino só vê os seus sites, com configuração própria; domínio único na plataforma |
| `escala.test.js` | pods de API e de trabalhador separados, vários trabalhadores dividindo os sites, o mesmo site nunca em dois, travas que expiram |
| `cloudfront.test.js` | função de borda: índice de pasta, barra final, `//`, 301 de páginas antigas, **rotas da `/multipla/`**, prefixo por domínio |
| `infra-scripts.test.js` | scripts de infra (`SIMULAR=1`): comandos da AWS certos, rascunho sem certificado, definitivo com `www` |
| `sites-e-temas.test.js` | temas versionados (só `rascunho/` e `vN/`; versão congelada editada = falha pelo sha256); gera os sites reais e varre **todas** as páginas (link quebrado, `{{marcador}}` sobrando, título, ids); todo tema na estrutura do padrão Shopify, com layout nos 5 templates, tudo que o HTML usa declarado no schema/locale e o mínimo exigido (5 templates, seções, páginas legais, lugar das seções da multipla) |
| `navegador.test.js` | Chrome headless em **cada** tema: cards montados pelo JS, filtros pela URL e pela rota, caixas de marcar e filtros ativos com cliques de verdade, scripts de terceiros só depois do "Aceitar" (LGPD), barra de busca (marca/modelo em cascata, ordenação), WhatsApp da página do carro, nenhum erro de JS |

## `VERSAO_HTML` e snapshot

`VERSAO_HTML` (em `core/build.js`) entra no hash de todas as páginas: aumentar a versão **refaz as páginas de todos os
sites**. Aumente só quando uma mudança no build alterar o HTML/JSON gerado. O `snapshot-html.test.js` cobra nos dois
sentidos (saída mudou sem aumentar, ou aumentou sem a saída mudar). Depois de aumentar: `npm run test:snapshot`.

## Regras ao mexer no código

- Rodar `npm test` antes de entregar. Bug corrigido → teste de regressão junto.
- Depois de mudar o `core/build.js`, rodar `node core/build.js` duas vezes: a segunda deve dizer "sem mudanças".
- Nunca editar versões congeladas do motor; só o `core/motor/rascunho`.
- Caminho novo vai em `core/caminhos.js`. `core/` nunca importa de `api/` (um teste cobra).
