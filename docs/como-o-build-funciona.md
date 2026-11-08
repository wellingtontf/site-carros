# Como o build gera os sites

> Parte da [documentação](README.md). Veja também: [visão geral](visao-geral.md), [páginas](paginas.md), [componentes](componentes.md), [listagem e rotas](listagem-e-busca.md).

Este documento explica, passo a passo e na ordem em que o código executa, como `core/build.js` (função `construir`)
transforma a **fonte** de um site (`sites-config/<dominio>/`) no **site pronto** (`sites-public/<dominio>/`), e o que
acontece depois até o site estar no ar.

**Resumo em uma linha:**
`sites-config/<d>/` (site.json + estoque.json + web/ + componentes/ + assets/) + `templates/<nome>/` + `componentes/` +
`core/motor/<versão>/` → **`core/build.js`** → `sites-public/<d>/` + `.estado/` (o que mudou) → publicação → CloudFront.

---

## 0. Quem dispara o build

| Origem | Comando / caminho | O que gera |
|---|---|---|
| Na mão | `node core/build.js` | todos os sites |
| Na mão, alguns sites | `node core/build.js --sites a.com.br,b.com.br` | só esses |
| API | o trabalhador da fila (`api/trabalhador.js`) recebe estoque, página ou `site.json` novo | só o site que mudou |
| Atualização de estoque | `node core/cli.js atualizar [dominios]` | só o site cujo estoque mudou |

Cada site tem uma **trava** (`core/trava.js`, em `.estado/travas/`): o mesmo site nunca é gerado duas vezes ao mesmo
tempo; sites diferentes rodam em paralelo.

---

## 1. Descobrir quais sites gerar

1. **Lista dos sites:** `Sites.listar()` (`core/sites.js`) lê as pastas de `sites-config/`. Cada pasta é um domínio, e o
   nome da pasta é o id do site (não existe campo `id`).
2. **Nome confere:** pasta que não parece domínio dá erro ("Pasta de site inválida").
3. **Sobras:** pasta em `sites-public/` sem site em `sites-config/` só gera aviso. Quem apaga é
   `node core/cli.js limpar-public --aplicar`.

### E o "www"?

- A pasta é sempre o domínio **sem** `www` (`lojateste.com.br`).
- O build não gera nada diferente para `www`: quem trata é a hospedagem. O CloudFront atende `www.loja.com.br` e
  `loja.com.br` com a mesma pasta (`infra/cloudfront/roteador.js` tira o `www`).
- Qual dos dois é o endereço **oficial** (canonical, sitemap, links do JSON-LD) vem do campo `url` do `site.json`:
  `"url": "https://www.loja.com.br"` faz tudo sair com `www`.

---

## 2. Ler e validar a configuração do site

1. **`site.json`:** template, motor, tema, textos, lojas, filtros, restrições, `url`, `fotosBase`, inquilino.
2. **Inquilino:** decide de onde vem o template. Template próprio do inquilino (`inquilinos/<id>/templates/<nome>/`)
   vale mais que o de `templates/` com o mesmo nome.
3. **Template completo?** Precisa dos 5 arquivos de `paginas/` (`home.html`, `multipla.html`, `carro.html`,
   `vendido.html`, `pagina.html`) e dos blocos obrigatórios. Faltou: o build para com "falta paginas/x.html".
4. **Motor:** confere que `core/motor/<versao>/engine.js` existe.
5. **Recusas com explicação** (a mensagem manda rodar `node ferramentas/mover-paginas.js`):
   - `"paginas"` ou `"estoque"` dentro do `site.json`;
   - a pasta antiga `sites-config/<d>/paginas/`;
   - home em `web/paginas/index.json` (a home fica em `web/index.json`).

---

## 3. Montar a lista de páginas de conteúdo

A pasta `sites-config/<d>/web/` é o **espelho do site público**: cada arquivo vira um endereço.

```
sites-config/<dominio>/web/
  index.json              →  /                 (home)
  multipla.json           →  /multipla/        (blocos antes/depois da lista + opções dos componentes)
  paginas/lojas.json      →  /paginas/lojas/   (página de blocos)
  paginas/feirao.html     →  /paginas/feirao/  (HTML livre do designer)
  paginas/feirao/index.html (com imagens/css junto) → /paginas/feirao/
```

1. **Listagem:** lê `web/multipla.json`. Arquivo vazio = sem configuração.
2. **Páginas de blocos do site:** `web/index.json` (home) e `web/paginas/**/*.json`.
3. **Páginas livres (HTML do designer).** Mesmo nome em dois lugares: vale o primeiro.
   1. `web/paginas/*.html` ou `web/paginas/<nome>/index.html` (deste site);
   2. `templates/<nome>/paginas-extras/` (todos os sites do template).
4. **Páginas padrão do template** (`templates/<nome>/paginas-padrao/`: contato, financiamento, avaliação, privacidade,
   cookies, LGPD):
   - entram se o site não tem uma página com o mesmo nome e não desligou (`"paginasPadrao": { "lgpd": false }`);
   - são preenchidas com `{{site.nome}}`, `{{empresa.cnpj}}`...
5. **Home padrão:** sem `web/index.json`, o core usa uma home com banner e vitrine.
6. **Validações:** caminho válido, nada reservado (`multipla`, `carros`, `assets`...), nada repetido.

---

## 4. Preparar o estoque

1. **Junta os dados:** cada carro de `estoque.json` recebe os dados da loja dele (cidade, UF, WhatsApp).
2. **Restrições do site** (`restricoes` no `site.json`): `precoMin`, `precoMax`, `anoMin`, marcas, estados e cidades
   tiram carros. Ex.: a primeseminovos tem 400 carros no estoque e mostra 297.
3. **Ordem:** campo `ordem` ou a posição no arquivo. É a ordenação "Destaques".
4. **Fotos:** carro que mandou fotos como URLs só conta as que já foram convertidas e estão no S3 (`core/fotos.js`).

---

## 5. Decidir o que precisa ser refeito (build incremental)

1. **Estado anterior:** `.estado/sites-public/<dominio>.json` guarda o que foi gerado da última vez (hash de cada carro,
   links, vendidos, redirecionamentos, datas).
2. **Hash do visual (`baseHash`):** template, componentes, opções dos componentes, nome, tema, textos, cabeçalho,
   rodapé, lojas e `VERSAO_HTML`.
   - Mudou → refaz **todas** as páginas de carro ("visual/config mudou: 1500 páginas refeitas").
   - Não mudou → refaz **só** os carros cujo hash mudou.
3. **Não refazem páginas de carro:** trocar o motor ou os filtros.

---

## 6. Copiar os arquivos que não são gerados

| De | Para | O quê |
|---|---|---|
| `core/motor/<versão>/engine.js` + `core/ui/` | `motor/` | motor da versão do site, `ui-lista.js`, `rotas.js`, `link-carro.js`, `formato-estoque.js`... |
| `templates/<nome>/` | `css/`, `js/`, `img/` | tudo do template, menos `paginas/`, `blocos/`, `parciais/` e `template.json` |
| `sites-config/<d>/assets/` | `assets/` | logo, banners e fontes do site |
| `componentes/<nome>/<nome>.css` | `componentes/` | CSS dos componentes usados |

css e js saem com `?v=<hash do conteúdo>` no endereço: a CDN guarda por muito tempo sem servir versão velha.

---

## 7. Gerar os dados que o navegador lê

1. **`estoque.json`:** os carros com chaves curtas, na ordem do site. Com `"formatoEstoque": "compacto"` no `site.json`
   sai em dicionário + colunas (~4x menor); o navegador desempacota (`core/ui/formato-estoque.js`).
2. **`config.json`:** filtros, ordenações, lojas, WhatsApp, vendedores, motor e total.
3. **Nomes antigos:** apaga `carros.json` e `estoque.xml` que tenham sobrado de versões anteriores.

---

## 8. Montar o contexto que os templates usam

1. **`estoque.*`:** total, destaques, listas de marcas, cidades, carrocerias, combustíveis e lojas, cada item com o link
   da rota (`multipla/marca/audi`).
2. **`site.*`:** nome, slogan, textos, cabeçalho e rodapé (links ajustados), links das páginas legais.
3. **Links escritos à mão são ajustados:**
   - `"contato/"` → `paginas/contato/` (`paraPagina`);
   - `"multipla/?carroceria=Moto"` → `multipla/carroceria/moto` (`paraFiltro`).

---

## 9. Gerar as páginas HTML

### 9.1 Listagem: `multipla/index.html`

1. Usa `templates/<nome>/paginas/multipla.html`.
2. **Expande os componentes** (`{{componente filtro}}`, `{{componente filtros-ativos}}`, `{{componente estoque}}`).
   As opções se somam, valendo mais a última:
   1. padrão do componente (`componentes/<nome>/componente.json`);
   2. template (atributos na chamada);
   3. site (`sites-config/<d>/componentes/<nome>.json`);
   4. página (`"componentes"` do `web/multipla.json`).
3. Põe os blocos de `web/multipla.json` (`blocosAntes` e `blocosDepois`).
4. **Injeta sozinho:**
   - o CSS dos componentes no `<head>` e os scripts no fim do `<body>`, sem repetir;
   - o script do `<base>`, que faz as rotas fundas (`/multipla/a/b/c`) acharem css, js e `estoque.json`.
5. **Cards no HTML:** os primeiros 24 já saem prontos (Google e quem está sem JS).
6. **Conferência:** id repetido na página (dois estoques, por exemplo) dá erro.

> Só existe esse arquivo dentro de `multipla/`. As **rotas** (`/multipla/marca/audi|bmw/revenda-cidade-nome/curitiba`)
> são o mesmo arquivo, entregue pela hospedagem; quem lê os filtros do endereço é o navegador (`core/ui/rotas.js`).

### 9.2 Páginas de conteúdo

1. A home usa `home.html`; as outras usam `pagina.html` (a moldura).
2. Cada bloco é renderizado com `templates/<nome>/blocos/<tipo>.html`.
3. Página livre: o HTML do designer, com links `/x` ajustados e moldura opcional.
4. Canonical com a `url` do site.

### 9.3 `404.html`

A do site (`pagina404` no `site.json`) ou a padrão, com `noindex`.

---

## 10. Limpar o que saiu

1. **Arquivos copiados** que não existem mais na origem (css tirado do template, imagem de página do designer).
2. **Páginas que deixaram de existir** (arquivo removido de `web/paginas/`, páginas fixas de filtro antigas).
3. **Redirecionamentos HTML antigos na raiz.**

Tudo o que é apagado entra na lista **"removidos"**, para sair também da hospedagem.

---

## 11. Páginas dos carros

1. **Endereço:** o `link` que veio no estoque (o do Revenda Mais, idêntico ao já indexado) ou a regra de
   `core/ui/link-carro.js`: `carros/<Marca>/<Modelo>/<Versao>/<Marca>-<Modelo>-<Versao>-<ano>-<Cidade>-<UF>-<id>.html`.
2. **Gera só as que mudaram** (passo 5), com `carro.html`, JSON-LD (`Car` + `Offer`), canonical, `og:image` (preview
   no WhatsApp) e descrição.
3. **Carro que saiu do estoque:**
   - a página vira "Este veículo não está mais disponível" (`vendido.html`, `noindex`) por `retencaoVendidosDias`
     (padrão 30);
   - depois disso é apagada.
4. **Carro que mudou de link** (mudou versão, cidade...): o endereço antigo redireciona para o novo por
   `retencaoRedirecionamentoDias` (padrão 180).

---

## 12. Sitemap e robots

1. **`sitemap.xml`** (`core/sitemap.js`): home, `/multipla/`, páginas e carros no ar, com `<lastmod>` = dia em que cada
   página mudou de verdade. Só é gerado quando o site tem `url`.
2. **`robots.txt`** (`core/robots.js`): o modelo do inquilino (`config/robots.txt`) ou o `"robots"` do site.
   Rascunho (`"rascunho": true`) sai fechado, com `noindex` em tudo.

---

## 13. Guardar e avisar

1. **Estado novo:** `.estado/sites-public/<dominio>.json` (base do próximo build incremental).
2. **Pendências de publicação:** `.estado/sites-public/pendentes/<dominio>.json` com os arquivos escritos e removidos.
3. **Índice local:** `sites-public/index.html` (lista de sites do servidor local).
4. **Log:**
   ```
   lojateste.com.br: 1500 carros · +0 novos ~2 alterados -1 saíram · 7 arquivo(s) escrito(s) · template template-basico · motor v3 · estoque.json 80 KB
   ```
   Rodar de novo sem mudar nada diz **"sem mudanças"**.

---

## 14. Depois do build: publicar

1. **Comando:** `node core/cli.js publicar` (ou `PUBLICAR=1` na API).
2. **O que faz:** lê as pendências e roda o `comandoSite` de `config/publicacao.json` (ex.: `aws s3 sync`), enviando só
   os arquivos alterados (`{lista}`) e apagando os removidos.
3. **Recusa:** site com problema de produção (`url` sem https, fotos em localhost) não é publicado.
4. **No ar:** o CloudFront entrega `sites-public/<dominio>/` e aplica as regras de `infra/cloudfront/roteador.js`:
   - `index.html` de pasta e barra final;
   - **rotas da listagem:** qualquer `/multipla/...` entrega `multipla/index.html`;
   - 301 de endereços antigos de página para `/paginas/...`;
   - `//` dos links antigos do Revenda Mais.

Para testar igual à produção na máquina: `node ferramentas/servidor-local.js 8080` → `http://localhost:8080/<dominio>/`
(usa a mesma função de borda; o `python -m http.server` não serve, porque não faz as rotas).

---

## Onde mexer para cada coisa

| Quero mudar... | Arquivo |
|---|---|
| dados do site (nome, lojas, tema, filtros) | `sites-config/<d>/site.json` |
| carros | `sites-config/<d>/estoque.json` (ou a API) |
| home, páginas, listagem | `sites-config/<d>/web/` |
| opções de um componente no site inteiro | `sites-config/<d>/componentes/<nome>.json` |
| logo, banners | `sites-config/<d>/assets/` |
| visual de todos os sites de um template | `templates/<nome>/` |
| filtro, estoque, filtros ativos (todos os templates) | `componentes/<nome>/` |
| busca e filtros (lógica) | `core/motor/rascunho/` → `node core/cli.js congelar vN` → `aplicar vN` |
| regras do endereço (rotas, 301) | `infra/cloudfront/roteador.js` e `core/ui/rotas.js` |
