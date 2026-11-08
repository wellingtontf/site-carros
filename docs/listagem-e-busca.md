# Listagem, busca e rotas

A listagem do estoque fica **sempre em `/multipla/`**. É uma página estática: o navegador baixa o `estoque.json` do site e o
**motor** (JavaScript) faz busca, filtros e ordenação ali mesmo. Medido com 1000 carros num celular simulado: primeira
tela em 0,6 s, lista pronta em 1,2 s, busca em ~140 ms.

## Rotas: os filtros no endereço

Os filtros ficam no **caminho**, depois de `/multipla/`, em pares `nome/valor`, **em qualquer ordem**:

```
/multipla/revenda-estado-cod/pr|rs/revenda-cidade-nome/cascavel|curitiba/marca/audi|bmw/veic-anomodelo/2027/combustivel/alcool
/multipla/carroceria/moto?ord=menor
/multipla/marca/toyota?q=corolla&v=carlos
```

- `|` = vários valores no mesmo filtro (Audi **ou** BMW). No endereço ele também pode vir como `%7C`.
- Busca (`q`), ordem (`ord`) e vendedor (`v`) continuam na **query** (`?q=...&ord=...&v=...`).
- **Nomes:** os do Revenda Mais com `-` no lugar de `_`. Na leitura valem também com `_` (links antigos), e os nomes
  simples do motor:

| Filtro | Nome que o site escreve | Também aceita |
|---|---|---|
| estado | `revenda-estado-cod` | `revenda_estado_cod`, `revenda-estado`, `uf`, `estado` |
| cidade | `revenda-cidade-nome` | `revenda_cidade_nome`, `revenda-cidade`, `cidade` |
| ano | `veic-anomodelo` | `veic_anomodelo`, `veic-ano`, `ano-modelo`, `anomodelo`, `ano` |
| modelo | `modelo` | `modelo-marca`, `modelo-nome` |
| loja | `loja` | `revenda-nome`, `revenda` |
| marca, carroceria, câmbio, combustível, cor, preço, km | o próprio nome (`marca`, `cambio`...) | `marca-nome`, `cambio-nome`... |

- **Valores sempre minúsculos** no que o site escreve (`marca/audi`). Na leitura, maiúscula, acento, espaço e hífen não
  importam (`AUDI`, `audi`, `Audi` dão o mesmo resultado; `caoa-chery` acha "CAOA Chery"); se só uma opção começa com o
  valor, ela vale ("maring" → "Maringá", o bug de cidade sem a letra acentuada do Revenda Mais).
- **Ordem canônica:** ao mexer nos filtros, o endereço é reescrito sempre na ordem dos filtros do site (o mesmo conjunto
  de filtros = o mesmo endereço) e o `<link rel="canonical">` acompanha.
- **Links antigos com query** (`/multipla/?marca=Toyota`) continuam funcionando e são reescritos como rota.
- **Valor que não existe no estoque** (carro vendido, ano que não tem): o filtro fica e a lista mostra "Nenhum carro
  encontrado" (o filtro não é escondido para mostrar outra coisa). A etiqueta dele aparece nos filtros ativos, para tirar.

### Como é estático

O build gera **só** `multipla/index.html`. A hospedagem entrega esse mesmo arquivo para **qualquer** `/multipla/...` (é
um rewrite, a URL não muda):

| Onde | Regra |
|---|---|
| CloudFront | `infra/cloudfront/roteador.js` (testado em `tests/cloudfront.test.js`) |
| local | `node ferramentas/servidor-local.js 8080` (usa a mesma função) |
| nginx | `location /multipla/ { try_files $uri /multipla/index.html; }` |
| Apache | `RewriteEngine On` + `RewriteRule ^multipla/.+ /multipla/index.html [L]` |

Como a página é servida em endereços mais fundos, o build põe no `<head>` um script que cria `<base href=".../multipla/">`,
e css, js, `estoque.json` e links continuam certos. O `python -m http.server` não serve para testar (não faz o rewrite).

### Onde fica o código

| Arquivo | Faz |
|---|---|
| `core/ui/rotas.js` | regra única das rotas: `separar`, `ler`, `montar`, `daQuery`, nomes e apelidos. Roda no navegador, no build e nos testes |
| `core/ui/ui-lista.js` | lê a rota + a query, acerta maiúscula/acento, aplica no motor, desenha filtros, cards e filtros ativos, reescreve o endereço e o canonical |
| `core/build.js` | links do estoque (`{{estoque.marcas}}`...) como rota; `paraFiltro` converte links escritos à mão; script do `<base>` |

## Filtros

Quais filtros aparecem e em que ordem vem do `"filtros"` do `site.json` ([configurar-um-site.md](configurar-um-site.md)).
O visual (combos ou caixas de marcar) vem do componente `filtro` ([componentes.md](componentes.md)).

- **Cascata:** estado → cidade → loja; marca → modelo. As opções do filho são só as que existem nos pais escolhidos.
  Trocar um pai pela tela limpa os valores do filho que deixaram de existir; os outros filtros ficam.
- **Vários valores (motor v3):** dentro do mesmo filtro é **OU** (Audi ou BMW); entre filtros diferentes é **E** (Audi ou
  BMW, **e** no RS). Estado PR com cidades do RS: as cidades ficam no filtro, só não dão resultado dentro do PR.
- **Restrições** do site (`precoMin`, `marcas`...) tiram carros antes de tudo: nem entram no `estoque.json`.

## Busca

- Procura em marca, modelo, versão, ano, cor, câmbio, combustível, carroceria, loja, cidade e UF.
- Ignora maiúsculas e acentos, aceita pedaço de palavra e exige **todas** as palavras digitadas.
- **Erro de digitação:** só tenta aproximar quando nenhum carro tem a palavra exata. Palavras com 4 letras ou mais e não
  numéricas aceitam 1 erro (2 se tiverem 7 letras ou mais). Mostra "mostrando resultados para *corolla*".
- Números (ano, versão) e palavras curtas nunca são aproximados.

## Ordenação

`destaque` (a ordem do estoque: campo `ordem` ou a posição no arquivo), `recentes`, `menor`, `maior`, `km`. A primeira da
lista `ordenacao` do site é a padrão.

## Vendedor

`?v=carlos` em qualquer link manda o WhatsApp de todos os carros para o número do vendedor (`"vendedores"` no `site.json`),
e fica lembrado enquanto a pessoa navega.

## O arquivo `estoque.json` (o gerado)

- Chaves curtas (`i` id, `m` marca, `o` modelo, `v` versão, `a` ano, `p` preço, `k` km, `c` cor, `b` câmbio, `f`
  combustível, `n` fotos, `u` loja, `cd` cidade, `uf`, `r` ordem, `cr` carroceria, `l` link), já na ordem do site.
- `"formatoEstoque": "compacto"` no `site.json`: dicionário + colunas (`core/ui/formato-estoque.js`). Lojateste com 1500
  carros: 326 KB → 80 KB (gzip 33 → 24 KB). O navegador desempacota para a mesma lista antes de entregar ao motor: busca
  e filtros iguais, com qualquer versão do motor.
- A compressão gzip/brotli precisa estar ligada na CDN.

## O motor e suas versões

O motor (`core/motor/<versão>/engine.js`) não mexe em tela: roda no navegador e no Node (testes). Cada site fixa a versão
em `"motor"` no `site.json`; mudar o motor não afeta nenhum site até ele ser aplicado.

| Versão | O que trouxe |
|---|---|
| `v1` | busca com tolerância a erro, filtros em cascata, estado na URL, WhatsApp |
| `v2` | ordenação `destaque` (ordem do estoque) e filtro de carroceria |
| `v3` | **vários valores por filtro**, ano exato (lista), valor do link sem carro = "nenhum carro", trocar um filtro limpa só os dependentes |

Fluxo para mudar o motor:
```
# 1) edite SÓ core/motor/rascunho/engine.js
node core/cli.js testar --motor rascunho --sites lojateste.com.br
node core/build.js --sites lojateste.com.br --motor rascunho      # gera em dist-preview/ para olhar (nunca é publicado)

# 2) está bom: congele (a versão fica imutável; sha256 em versao.json)
node core/cli.js congelar v4 --nota "o que mudou"

# 3) aplique em alguns sites (roda os testes antes; --dry só mostra)
node core/cli.js aplicar v4 --sites lojateste.com.br
node core/build.js --sites lojateste.com.br

# 4) deu certo: todos
node core/cli.js aplicar v4 --todos && node core/build.js

# se algo der errado
node core/cli.js reverter --sites lojateste.com.br
node core/cli.js historico
```
- **Nunca edite uma versão congelada** (`v1`, `v2`, `v3`...): `tests/motor.test.js` falha se o `sha256` não bater.
- A versão aplicada fica no `site.json` de cada site e em `config/historico.json`.
- Site novo nasce com a última versão congelada.
- Os arquivos de `core/ui/` não são versionados: precisam funcionar com qualquer motor e com HTML antigo (ex.: caixas de
  marcar só aparecem com motor que tem `valores()`).
