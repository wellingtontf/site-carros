# Configurar um site

Tudo de um site fica em `sites-config/<dominio>/`. O nome da pasta é o domínio **sem `www`** e é o id do site (não existe
campo `id`). Pela API, cada parte tem a sua rota ([api.md](api.md)).

```
sites-config/loja.com.br/
  site.json          cadastro (este documento)
  estoque.json       os carros (formato abaixo)
  web/               home, listagem e páginas (paginas.md)
  componentes/       opções dos componentes no site inteiro (componentes.md)
  assets/            logo, banners, favicon, fontes
```

## `site.json`

Exemplo:
```json
{
  "inquilino": "revenda-mais",
  "nome": "Loja Teste Seminovos",
  "slogan": "Seminovos com 1 ano de garantia",
  "tema": "template-basico",
  "motor": "v3",
  "url": "https://lojateste.com.br",
  "whatsapp": "5541999990000",
  "fotosBase": "https://fotos.plataforma.com.br/",
  "configuracoes": { "cor": "#0533ce", "logo": "assets/logo.webp", "fonteGoogle": "Montserrat" },
  "lojas": {
    "matriz": { "nome": "Matriz", "cidade": "Curitiba", "uf": "PR", "endereco": "Rua X, 100", "whatsapp": "5541999990001" },
    "sul":    { "nome": "Loja Sul", "cidade": "Porto Alegre", "uf": "RS" }
  },
  "filtros": ["estado", "cidade", "marca", "modelo", "carroceria", "ano", { "campo": "preco", "rotulo": "Até" }, "km"],
  "ordenacao": ["destaque", "menor", "maior", "recentes", "km"],
  "restricoes": { "precoMin": 20000 },
  "vendedores": { "carlos": "5541966663333" },
  "empresa": { "razaoSocial": "Loja Teste LTDA", "cnpj": "12.345.678/0001-90", "email": "dpo@lojateste.com.br" }
}
```

### Campos

| Campo | Obrigatório | O que é |
|---|---|---|
| `nome` | sim | nome do site (títulos, rodapé, textos legais) |
| `tema` | sim | nome do tema: pasta em `temas/` (ou do inquilino); ver [temas.md](temas.md) |
| `motor` | sim | versão do motor de busca (`v1`, `v2`, `v3`); ver [listagem-e-busca.md](listagem-e-busca.md) |
| `inquilino` | não | dono do site; sem ele, `padrao` |
| `slogan` | não | aparece no cabeçalho de alguns temas e nas descrições |
| `url` | para produção | endereço oficial **com https** (`https://loja.com.br` ou `https://www.loja.com.br`). Sem ele não há sitemap, canonical nem JSON-LD, e a publicação recusa |
| `whatsapp` | não | número com DDI e DDD; vale para carros de loja sem WhatsApp próprio |
| `fotosBase` | não | onde ficam as fotos (`<fotosBase>carros/<id>/<n>-<400\|800\|1600>.webp`). Precisa terminar em `/`; localhost ou http é recusado na publicação |
| `configuracoes` | não | o que o **tema** aceita (`config/settings_schema.json` dele): em todos, `cor`, `fundo`, `texto`, `raio` (px), `colunas` (px do card), `fonte`, `fonteGoogle`, `logo`, `favicon`; no template-basico também `logoRodape`. Imagens com caminho relativo (`assets/logo.png`) apontam para `assets/` do site |
| `textos` | não | troca os textos padrão do tema (`locales/pt-BR.json`): `busca` (dica da caixa de busca), `rodape`, `avisoCookies`, `botaoWhatsapp`, `voltar` |
| `cabecalho`, `rodape` | não | o que o tema declara (no template-basico: faixa do topo, telefone, menus, redes sociais, links institucionais...). Links relativos à raiz; `"contato/"` vira `/paginas/contato/` |
| `lojas` | para ter estoque | `{ "<id>": { nome, cidade, uf, endereco, whatsapp, telefone } }`. Cidade/UF da loja valem para os carros dela |
| `filtros` | não | quais filtros aparecem e em que ordem (abaixo). Sem ele, todos |
| `ordenacao` | não | ordens oferecidas; a primeira é a padrão (abaixo) |
| `busca` | não | `false` esconde a caixa de busca |
| `restricoes` | não | o que o site pode vender (abaixo) |
| `vendedores` | não | `{ "carlos": "5541..." }`: `?v=carlos` em qualquer link manda o WhatsApp para ele |
| `empresa` | não | `razaoSocial`, `cnpj`, `email`, `encarregado`: preenchem as páginas legais (LGPD, privacidade) |
| `paginasPadrao` | não | desliga páginas padrão do tema: `{ "financiamento": false }` |
| `pagina404` | não | página de erro própria (mesmo formato de uma página de seções: `{ "titulo", "secoes": [...] }`) |
| `avisoCookies` | não | `false` desliga o aviso de cookies |
| `retencaoVendidosDias` | não | quantos dias a página de carro vendido fica no ar (padrão 30) |
| `retencaoRedirecionamentoDias` | não | quantos dias o link antigo de carro redireciona (padrão 180) |
| `robots` | não | robots.txt próprio (vale mais que o modelo do inquilino) |
| `formatoEstoque` | não | `"compacto"`: o `estoque.json` gerado sai ~4x menor (dicionário + colunas), sem mudar a busca |
| `rascunho` | não | `true`: nada entra no Google (`noindex` em tudo, robots fechado) e nenhum script de terceiros |
| `integracoes` | não | `gtm`, `ga4`, `pixelMeta`: o build põe o código oficial em todas as páginas, só depois do aceite de cookies (ver "Scripts" abaixo) |

**O tema decide o que vale** em `configuracoes`, `cabecalho`, `rodape` e `textos` ([temas.md](temas.md#o-que-o-site-pode-configurar-configsettings_schemajson-e-localespt-brjson)):
chave que o tema não usa volta como **aviso** (provável erro de digitação, ou o tema não tem aquilo); valor do tipo
errado (cor inválida, texto onde vai número, objeto onde vai lista) é **recusado** com o lugar do erro.
`GET /v1/temas/<nome>` mostra tudo o que um tema aceita.

Não vão no `site.json` (o build e a API recusam com explicação): `paginas` (são arquivos em `web/`), `estoque` (a
listagem é `web/multipla.json`) e `componentes` (são arquivos em `componentes/`). Campo desconhecido não impede a
gravação, mas volta como aviso na API (provável erro de digitação).

Nomes antigos (antes de 2026-11-08) são recusados com explicação: `"template"` (agora `"tema"`), o objeto `"tema"` com
cores e logo (agora `"configuracoes"`) e `"blocos"` nas páginas (agora `"secoes"`). `node ferramentas/migrar-temas.js`
converte.

### Filtros

`filtros` é a lista, na ordem em que aparecem. Cada item é um nome (`"marca"`) ou um objeto com `campo` e, se quiser,
`rotulo`, `opcoes`, `tipo` e `sempre`.

| Campo | Tipo | Observação |
|---|---|---|
| `estado`, `cidade`, `loja` | lista | em cascata: o estado reduz as cidades, a cidade reduz as lojas |
| `marca`, `modelo` | lista | `modelo` mostra só os modelos das marcas escolhidas |
| `carroceria`, `cambio`, `combustivel`, `cor` | lista | valor vazio não vira opção |
| `ano` | lista (motor v3) | o ano **exato**, do mais novo ao mais velho, um ou vários. `{ "campo": "ano", "tipo": "minimo" }` volta ao "a partir de" (com `opcoes`). No v1/v2 é sempre "a partir de" |
| `preco`, `km` | máximo | "até X"; `opcoes` = os valores da lista |

- Filtro de lista com um valor só no site some sozinho (`"sempre": true` mantém).
- No motor v3, todo filtro de lista aceita **vários valores** (Audi **ou** BMW). Na tela, isso aparece quando o componente
  filtro usa caixas de marcar ([componentes.md](componentes.md)); pelo endereço, sempre ([listagem-e-busca.md](listagem-e-busca.md)).

### Ordenação

`destaque` (a ordem do estoque; padrão a partir do motor v2), `recentes`, `menor` (preço), `maior` (preço), `km` e, no
motor v4, `anoMenor`, `anoMaior`, `az`, `za` e `publicacao` (data de publicação). A primeira da lista do site é a padrão;
o combo da `barra-busca` só mostra as que estão aqui.

### Restrições

`precoMin`, `precoMax`, `anoMin`, `marcas` (lista), `estados` (lista de UF), `cidades` (lista). Independem dos filtros: o
carro fora da restrição nem entra no site. Ex.: a primeseminovos tem 400 carros no estoque e, com `precoMin: 90000`,
mostra 297.

## Scripts: GTM, GA4, Pixel da Meta, chat... (`core/codigos.js`)

Entram em **todas** as páginas do site (home, listagem, carros, páginas, 404), no fim do `<head>` e no fim do `<body>`,
sem mexer no tema. Três lugares, nesta ordem:

| Onde | O quê |
|---|---|
| `site.json` → `"integracoes": { "gtm": "GTM-XXXX", "ga4": "G-XXXX", "pixelMeta": "123456789" }` | o build gera o código oficial de cada um (o ID tem o formato conferido; formato errado é recusado) |
| `inquilinos/<id>/codigos/head.html` e `body.html` | código livre de **todos** os sites do inquilino (ex.: um GTM do Revenda Mais) |
| `sites-config/<dominio>/codigos/head.html` e `body.html` | código livre **do site** (chat, outro pixel...). Pela API: `PUT /v1/sites/<d>/codigos/head` (ou `body`) com o HTML |

- Mande só o trecho (`<script>`, `<noscript>`...), sem `<html>`, `<head>` ou `<body>`. Até 100 KB por arquivo.
- **LGPD:** nada disso roda antes do aceite de cookies. O build põe o código dentro de `<template data-lgpd>` (que o
  navegador não executa); quando a página tem esses scripts, o aviso de cookies mostra **Aceitar** e **Recusar**, e só o
  "Aceitar" ativa os scripts (nas próximas páginas, a escolha já vale). Com `"avisoCookies": false` (o site desligou o
  aviso), os scripts rodam na hora: aí a responsabilidade pelo consentimento é do site.
- **Rascunho** (`"rascunho": true`) não recebe nenhum script: não suja as estatísticas do site definitivo. Ao promover,
  os scripts entram.
- Mudar um código refaz as páginas do site (ele entra no hash).

## `estoque.json`

```json
{ "atualizado": "2026-11-08T12:00:00Z", "carros": [
  { "id": "ABC123", "loja": "matriz",
    "marca": "Toyota", "modelo": "Corolla", "versao": "XEi 2.0 Flex Aut.", "ano": 2022,
    "preco": 129900, "km": 35000, "cor": "Prata", "cambio": "Automático", "combustivel": "Flex",
    "fotos": 12, "opcionais": ["Ar-condicionado"], "descricao": "Único dono.",
    "ordem": 1, "destaque": true, "carroceria": "Sedan",
    "link": "carros/Toyota/Corolla/Xei-20/Toyota-Corolla-Xei-20-2022-Curitiba-Parana-ABC123.html" } ] }
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id` | sim | único no site; letras, números, `.`, `-`, `_` |
| `marca`, `modelo`, `versao`, `cor`, `cambio`, `combustivel` | sim | texto não vazio |
| `ano` | sim | de 1950 até o ano atual + 2 |
| `preco` | sim | maior que 0 |
| `km` | sim | 0 ou mais |
| `fotos` | sim | quantidade (já estão no armazenamento) **ou** lista de URLs (a plataforma baixa e converte); até 60 |
| `loja` | se o site tem mais de uma loja | id de uma loja do `site.json` |
| `ordem` | não | menor aparece primeiro ("Destaques"); sem ele, vale a posição no arquivo |
| `destaque` | não | marca o carro como destaque (vitrine com `somenteDestaques`) |
| `carroceria` | não | Hatch, Sedan, SUV, Picape, Moto, Utilitário... (vira filtro) |
| `publicado` | não | data de publicação, `AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM` (ordenação "Data de publicação"); sem ela, vale o dia em que o carro apareceu no site |
| `opcionais`, `descricao` | não | aparecem na página do carro |
| `link` | não | endereço da página do carro já indexado (o do Revenda Mais): a página fica **exatamente** nele. Começa com `carros/` e termina com `.html`; `//` vira `/` |

Qualquer erro no estoque → **nada é gravado** e o estoque anterior continua valendo. Validações e travas em
[estoque-e-atualizacao.md](estoque-e-atualizacao.md).

## Site novo, rascunho e troca de domínio

- `POST /v1/sites` sem domínio cria o próximo **rascunho** da sequência do inquilino (`site1.carro57.com.br`,
  `site2...`; número nunca reutilizado), com o modelo `inquilinos/<id>/config/site-modelo.json`.
- `POST /v1/sites/<rascunho>/promover` com `{"dominio": "loja.com.br"}` leva o site ao domínio definitivo, gerado do
  zero e de volta ao Google.
- `POST /v1/sites/<d>/dominio` troca o domínio de um site **já no ar**, levando o histórico de SEO (com 301 na hospedagem).
- `DELETE /v1/sites/<d>?confirmar=<d>` remove o site (recuperável em `.estado/removidos/`).

Detalhes em [api.md](api.md).
