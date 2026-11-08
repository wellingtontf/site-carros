# API de estoque (v1)

Contrato para qualquer sistema que mande carros para os sites da plataforma: Revenda Mais, outro CRM, ERP ou script. A plataforma não conhece o sistema de origem. Quem integra converte os dados para o formato abaixo, e a plataforma valida, grava e reconstrói **só o site afetado** (e nele só as páginas que mudaram).

## Acesso

A plataforma é **multi-tenant**: cada site pertence a um **inquilino** (Revenda Mais, Webmotors, um terceiro...), e cada sistema recebe um **token próprio, de um inquilino**. Ele só enxerga e altera os sites desse inquilino; `--sites "*"` significa todos os sites **do inquilino**. Quem administra a plataforma cria o token:

```
node api/cli.js inquilino criar webmotors --nome "Webmotors" --rascunho "loja{n}.previa.com.br"
node api/cli.js cliente criar crm-x --inquilino webmotors --sites loja1.com.br,loja2.com.br   # ou --sites "*" 
node api/cli.js cliente listar
node api/cli.js cliente remover crm-x                                    # o token deixa de valer na hora
```

O token aparece uma vez só (`sc_...`). A plataforma guarda apenas o hash dele. Envie o token em toda chamada:

```
Authorization: Bearer sc_xxxxxxxxxxxxxxxx
```

| Código | Quando |
|---|---|
| 401 | sem token, token errado ou cliente desativado |
| 403 | o token não tem acesso a esse site |
| 404 | site, carro, pedido ou rota não existe |

O site é identificado pelo **domínio** (ex.: `loja1.com.br`), que é o nome da pasta `sites/<dominio>/`.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/v1/saude` | sem token: diz se a API está de pé |
| GET | `/v1/lotes/{lote}` | andamento de uma operação em vários sites (contagem por status e problemas) |
| GET | `/v1/sites` | sites que o token pode alterar, com o total de carros e a data da última atualização |
| POST | `/v1/sites` | **cria um site novo com toda a estrutura**: sem domínio = próximo rascunho (`siteN.carro57.com.br`); ou `{"dominio": "novaloja.com.br"}` (ver "Site novo") |
| PUT | `/v1/sites/{dominio}` | **grava o `site.json` inteiro**: cria o site, se não existir, ou substitui o cadastro (ver "Cadastro do site"), e gera o site |
| PATCH | `/v1/sites/{dominio}` | **grava só os campos enviados** do `site.json`; o resto fica como está (ver "Cadastro do site") |
| POST | `/v1/sites/{dominio}/promover` | **rascunho → site definitivo**: `{"dominio": "lojafinal.com.br"}` (ver "Rascunho e promoção") |
| POST | `/v1/sites/{dominio}/dominio` | site **já no ar** troca de domínio, levando tudo junto: `{"novo": "outro.com.br"}` (ver "Trocar o domínio") |
| DELETE | `/v1/sites/{dominio}?confirmar={dominio}` | **remove o site** (recuperável: vai para `.estado/removidos/`); fotos saem do armazenamento; roda o `remover` da infra. Token `*`; 409 se houver pedidos na fila |
| POST | `/v1/sites/{dominio}/infra` | refaz o passo de hospedagem: `{"acao": "criar"}`, ou `{"acao": "promover" \| "renomear", "antigo": "..."}` |
| GET | `/v1/sites/{dominio}` | resumo: cadastro, total de carros, fotos pendentes/com erro, últimos pedidos |
| POST | `/v1/estoques` | **estoque de 1 ou N sites numa chamada** (ver "Vários sites numa chamada") |
| POST | `/v1/build` | **reconstrói sites** sem mudar estoque: `{"sites":["a.com.br","b.com.br"]}`; vazio = **todos** (token com `*`). `"completo": true` regera todas as páginas |
| GET | `/v1/sites/{dominio}/estoque` | o estoque atual (para conferir ou reconciliar) |
| PUT | `/v1/sites/{dominio}/estoque` | **troca o estoque inteiro**: `{"carros":[...]}` (a lista pura também vale) |
| GET | `/v1/sites/{dominio}/carros/{id}` | um carro |
| PUT | `/v1/sites/{dominio}/carros/{id}` | **inclui ou altera um carro** (corpo = o carro; o `id` vem do endereço) |
| DELETE | `/v1/sites/{dominio}/carros/{id}` | **tira um carro** (vendido) |
| POST | `/v1/sites/{dominio}/build` | reconstrói o site sem mudar o estoque (`{"completo": true}` regera todas as páginas) |
| GET | `/v1/robots` | o modelo de robots.txt em uso |
| PUT | `/v1/robots` | **troca o robots.txt de todos os sites** (ver "robots.txt"; token com `*`) |
| DELETE | `/v1/robots` | volta todos os sites ao robots.txt padrão |
| POST | `/v1/atualizar` | puxa o estoque das URLs cadastradas em `config/fontes.json`: `{"sites":["loja1.com.br"]}` |
| GET | `/v1/pedidos/{pedido}` | andamento de um pedido |
| GET | `/v1/pedidos?site={dominio}&limite=20` | últimos pedidos do token |

Parâmetros das rotas que alteram dados:

- `?esperar=30`: segura a resposta até o pedido terminar (máximo de 120 s). Sem ele, a resposta é imediata (202) e você acompanha o pedido.
- `?forcar=1`: libera a trava de queda de estoque (ver abaixo).

## Site novo

`POST /v1/sites` com `{"dominio": "novaloja.com.br"}` cria **toda a estrutura** de um site: a pasta com cadastro, o estoque vazio, `assets/` e `paginas/`. Em seguida gera o site (home, estoque, páginas padrão, sitemap, robots.txt, estoque.xml) e roda o comando `criar` da infraestrutura (hospedagem, certificado, DNS). Exige token com acesso a todos os sites (`*`).

- **Só o domínio é obrigatório.** O resto vem do modelo da casa (`config/site-modelo.json`): nome = domínio, url = `https://<domínio>`, motor = a última versão. Para já mandar mais coisa, use `{"dominio": "...", "cadastro": {"nome": "...", "template": "servopa", "lojas": {...}}}` (o mesmo formato de "Cadastro do site"); isso vale mais que o modelo.
- O site pode nascer **sem lojas**. Nesse caso, ele sobe sem estoque, e o estoque só é aceito depois que as lojas forem cadastradas (`PUT /v1/sites/{dominio}`).
- Nasce em **rascunho** (fora do Google) se o modelo disser `"rascunho": true` (o padrão). Para criar já definitivo, mande `"cadastro": {"rascunho": false}`.
- Respostas: **202** aceito; com `?esperar`, **201** criado. **409** se o domínio já existe e **422** se o domínio ou o cadastro forem inválidos (nada é criado).
- Se a infra falhar, o site fica pronto, mas o pedido termina como `erro` com o motivo. Corrija e chame `POST /v1/sites/{dominio}/infra`.

## Rascunho e promoção

O fluxo normal de um site novo: ele nasce como **rascunho** num endereço provisório da sequência `site1.carro57.com.br`, `site2.carro57.com.br`, `site3.carro57.com.br`...

```
POST /v1/sites                     {"cadastro": {"nome": "Loja do João", "template": "servopa"}}   (ou corpo vazio)
→ 202 { "pedido": "...", "site": "site14.carro57.com.br", ... }
```

- O número segue a sequência e **nunca é reutilizado**: depois que o `site3` é promovido, o próximo é o `site15`, nunca o 3 de novo (o endereço pode ter sido compartilhado). Cadastro inválido não gasta número.
- O padrão fica em `config/rascunhos.json` (`"padrao": "site{n}.carro57.com.br"`).
- Endereço do padrão é **sempre rascunho**, mesmo com `"rascunho": false`. Promover para um endereço do padrão, ou no próprio endereço de rascunho, é recusado (422): informe o domínio definitivo.

Lá o time monta e confere tudo. Lá o time monta e confere tudo. Quando estiver pronto, ele é **promovido** para o domínio definitivo.

- **Rascunho (`"rascunho": true` no cadastro; é o padrão de `POST /v1/sites`)**: nenhuma página entra no Google. Todas saem com `noindex` e o `robots.txt` fecha o site inteiro (`Disallow: /`), mesmo que o modelo de robots de todos os sites diga outra coisa.
- **Promover**: `POST /v1/sites/{rascunho}/promover` com `{"dominio": "lojafinal.com.br"}`. Opcionalmente, `"url": "https://www.lojafinal.com.br"` define o endereço público. Sem `dominio`, o site só deixa de ser rascunho no próprio endereço.
  - O site vai para o domínio definitivo (cadastro, estoque, páginas, fotos, tokens e `fontes.json` vão junto) e deixa de ser rascunho: volta ao Google com robots e sitemap normais.
  - É **gerado do zero**: o histórico do rascunho (páginas de vendido e redirecionamentos dos testes) não vai para o site definitivo. Ele é publicado inteiro.
  - Depois roda o comando `promover` da infraestrutura: hospedagem do domínio definitivo e remoção do endereço de rascunho. **Não há 301**: o rascunho nunca esteve no Google.
  - Recusa: **409** se o site já é definitivo, se o domínio já existe ou se há pedidos na fila; **422** se o domínio é inválido, se as fotos estão em localhost/http ou se a url não é https. Se algo falhar no meio, o rascunho volta como estava.
  - Exige token `*`.

## Trocar o domínio

Para um site que **já está no ar** e muda de domínio (caso raro; rascunho usa "Promover"). `POST /v1/sites/{dominio}/dominio` com `{"novo": "novodominio.com.br"}` muda o domínio e leva tudo junto: cadastro, estoque, páginas geradas e o **histórico de SEO** (páginas de vendidos e redirecionamentos dos carros, com os prazos), fotos, pendências de publicação, `config/fontes.json` e os tokens que tinham o domínio antigo. As menções ao domínio no cadastro também são trocadas (`url`, e-mails, links). Um domínio parecido (`loja.com.br` quando o antigo é `loja.com`) não é tocado.

- O site é refeito com o domínio novo (canonical, sitemap, JSON-LD, links) e marcado para publicação completa.
- Se algo falhar no meio, **tudo volta como estava**.
- Depois roda o comando `renomear` da infraestrutura. É ali que entram a hospedagem do domínio novo e o **301 do domínio antigo inteiro para o novo**, para não perder o Google.
- Exige token `*`. Responde **409** se o domínio novo já existe ou se o site tem pedidos na fila (espere terminarem) e **422** para domínio inválido.

## Cadastro do site

**PUT ou PATCH?** O `PUT` substitui o `site.json` inteiro: use quando o seu sistema é o dono do cadastro todo. O `PATCH` muda só os campos enviados: use quando o seu sistema cuida de **parte** do cadastro (telefone, WhatsApp, lojas...) e outros mantêm o resto (cabeçalho, rodapé e tema montados pelo designer). Um `PUT` parcial apagaria esses campos.

```
PATCH /v1/sites/loja1.com.br
{ "whatsapp": "5541988887777", "lojas": { "matriz": { "whatsapp": "5541900000000" } }, "slogan": null }
```

O `PATCH` segue o JSON Merge Patch (RFC 7396): objeto mescla campo a campo (no exemplo, só o WhatsApp da loja `matriz` muda), `null` apaga o campo e texto, número ou lista substituem. O resultado passa pela mesma validação do `PUT` (422 e nada gravado se ficar inválido) e o site é refeito. O `inquilino` não muda por aqui.

`PUT /v1/sites/{dominio}`: o domínio vem no endereço e o corpo é o cadastro completo (ele substitui o anterior). Se o site não existe, ele é criado (resposta 201; exige token com acesso a todos, `*`). Se existe, o cadastro é atualizado (202). Nos dois casos, o site é gerado em seguida.

```json
{
  "nome": "Loja Nova Seminovos",
  "template": "servopa",
  "motor": "v2",
  "url": "https://lojanova.com.br",
  "whatsapp": "5541999990000",
  "fotosBase": "https://fotos.plataforma.com.br/",
  "tema": { "cor": "#0533ce", "logo": "https://cdn.lojanova.com.br/logo.webp" },
  "lojas": {
    "matriz": { "nome": "Matriz", "cidade": "Curitiba", "uf": "PR", "endereco": "Rua X, 100", "whatsapp": "5541999990001" }
  }
}
```

Obrigatórios: `nome`, `template` e `motor`. As `lojas` são opcionais num site novo (cada uma com `nome`, `cidade` e `uf`); sem loja, o site não aceita estoque. Os opcionais (`cabecalho`, `rodape`, `filtros`, `tema`...) seguem o mesmo formato do `site.json` (README do projeto). As **páginas não vão no cadastro**: cada página é um arquivo em `sites/<dominio>/paginas/`, criado pelo web designer (um cadastro com `"paginas"` volta 422). A API recusa (422, nada gravado): template ou motor inexistente, bloco que o template não tem, `url` sem https e loja removida que ainda tem carros no estoque. O cadastro anterior fica guardado como cópia de segurança.

## Vários sites numa chamada

`POST /v1/estoques` atualiza **exatamente os sites que vierem no corpo**: um, alguns ou todos.

```json
{ "sites": {
    "loja1.com.br": { "carros": [ ... ] },
    "loja2.com.br": [ ... ]
} }
```

Cada site é independente: os válidos entram na fila e os inválidos voltam em `recusados`, com o motivo. Um site com erro não segura os outros.

```json
HTTP 207   (com ?esperar; sem ele, 202)
{ "pedidos": [ { "pedido": "p...", "site": "loja1.com.br", "status": "concluido", ... } ],
  "recusados": { "loja2.com.br": { "codigo": 422, "erro": "estoque inválido: nada foi gravado", "erros": ["carro #3 ..."] } } }
```

Códigos: **202** aceito (sem `?esperar`), **200** todos concluídos, **207** parte concluída e parte não (veja cada pedido e `recusados`), **422** nenhum site aceito. O limite é 200 MB por chamada. Para estoques grandes, prefira um `PUT /v1/sites/{dominio}/estoque` por site.

## robots.txt

`PUT /v1/robots` troca o robots.txt de **todos os sites** de uma vez. O corpo é o texto do robots (ou `{"conteudo": "..."}`), com marcadores que viram os dados de cada site:

```
User-agent: *
Disallow: /multipla/?*
Sitemap: {{sitemap}}
```

`{{sitemap}}` = `https://<site>/sitemap.xml`, `{{url}}` = `https://<site>` e `{{dominio}}` = `<site>`. Só o robots.txt é reescrito, sem refazer as páginas: leva segundos, mesmo com milhares de sites. A resposta conta quantos mudaram.

- **Trava:** um texto que tira os sites do Google (`Disallow: /` para `*` ou `Googlebot`), ou que vem sem a linha `Sitemap:`, volta **409** com o motivo e nada é gravado. Se for isso mesmo, reenvie com `?forcar=1`.
- Marcador desconhecido ou texto vazio: **422**.
- O site que tem `"robots"` no próprio cadastro mantém o dele (aparece em `resultado.comRobotsProprio`).
- `DELETE /v1/robots` volta ao padrão: `User-agent: *`, `Allow: /` e `Sitemap: {{sitemap}}`.

## Reconstruir (build)

| Chamada | Faz |
|---|---|
| `POST /v1/sites/{dominio}/build` | um site |
| `POST /v1/build` `{"sites": ["a.com.br", "b.com.br"]}` | os sites da lista |
| `POST /v1/build` `{}` | todos os sites do inquilino do token (lote; o admin alcança a plataforma toda ou um inquilino com `?inquilino=`) |

Sem opção, o build é **incremental**: reescreve só o que mudou (cadastro, template, estoque). Com `"completo": true` (ou `?completo=1`), regera **todas** as páginas, mesmo sem mudança detectada. Use depois de uma correção que o build não enxerga, ou para garantir tudo fresco. Nos dois casos o **histórico é mantido**: páginas de vendido e redirecionamentos continuam, então link compartilhado e Google não quebram.

## Operações em todos os sites (lotes)

"Todos" sempre quer dizer **todos os sites do inquilino do token** (só o token admin da plataforma alcança tudo, ou um inquilino com `?inquilino=`). `POST /v1/build` vazio, `PUT /v1/robots` e `POST /v1/atualizar` vazio criam **um pedido por site**, processados em paralelo pelos trabalhadores, e respondem com o **lote**:

```json
{ "lote": "lmhc...", "total": 812, "terminados": 812, "concluido": true,
  "contagem": { "concluido": 811, "erro": 1 }, "problemas": [ { "site": "x.com.br", "status": "erro", "erros": ["..."] } ],
  "link": "/v1/lotes/lmhc..." }
```

Com `?esperar`: **200** quando todos concluíram, **207** quando terminou com algum problema e **202** quando o tempo acabou antes (acompanhe pelo `link`).

## Pedidos

Toda alteração vira um **pedido** e responde na hora:

```json
HTTP 202
{ "pedido": "pmhb2k0a01f3e2", "tipo": "carro", "site": "loja1.com.br", "carro": "ABC123",
  "status": "na_fila", "criado": "2026-11-07T14:02:11.120Z", "inicio": null, "fim": null,
  "erros": [], "resultado": null, "link": "/v1/pedidos/pmhb2k0a01f3e2" }
```

| status | significado | código com `?esperar` |
|---|---|---|
| `na_fila`, `processando` | ainda não terminou | 202 |
| `concluido` | gravado e site reconstruído. `resultado.estoque` = `atualizado` ou `igual` (nada mudou) | 200 |
| `invalido` | dado inválido; **nada foi gravado** | 422 |
| `recusado` | trava de queda de estoque; nada foi gravado | 409 |
| `erro` | falha interna (ou remoção de carro que não estava no estoque) | 500 |

- Chamadas em sequência (uma rajada de carros, por exemplo) são aplicadas **na ordem em que chegaram** e geram **um build só**. A API espera cerca de 3 s sem chamada nova antes de processar.
- Num lote, um carro inválido é recusado sozinho. Os outros pedidos seguem.
- Os pedidos ficam gravados em disco: se a API reiniciar, o que estava na fila é processado quando ela voltar.
- Pedidos terminados podem ser consultados por 7 dias.

## Validação imediata (422)

O que dá para conferir na hora é conferido **antes** de criar o pedido. O erro volta com a lista completa:

```json
HTTP 422
{ "erro": "estoque inválido: nada foi gravado",
  "erros": ["carro #3 (ABC123): \"marca\" vazio ou ausente", "carro #9 (XYZ9): ano inválido"] }
```

## Formato do carro

```json
{
  "id": "ABC123",
  "marca": "Toyota", "modelo": "Corolla", "versao": "XEi 2.0 Flex Aut.",
  "ano": 2022, "preco": 129900, "km": 35000,
  "cor": "Prata", "cambio": "Automático", "combustivel": "Flex",
  "fotos": ["https://cdn.meusistema.com/abc123/1.jpg", "https://cdn.meusistema.com/abc123/2.jpg"],
  "loja": "matriz",
  "opcionais": ["Ar-condicionado", "Teto solar"],
  "descricao": "Único dono, revisões na concessionária.",
  "ordem": 1, "destaque": true, "carroceria": "Sedan",
  "link": "carros/Toyota/Corolla/Xei-20/Toyota-Corolla-Xei-20-2022-Curitiba-Parana-ABC123.html"
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id` | sim | único no site; letras, números, `.`, `-` e `_` |
| `marca`, `modelo`, `versao`, `cor`, `cambio`, `combustivel` | sim | texto não vazio |
| `ano` | sim | inteiro de 1950 até o ano atual + 2 |
| `preco` | sim | número maior que 0, em reais |
| `km` | sim | número ≥ 0 |
| `fotos` | sim | lista de URLs das fotos, na ordem de exibição (até 60), **ou** a quantidade, se as fotos já estão no armazenamento da plataforma (ver "Fotos") |
| `loja` | se o site tem mais de uma loja | id de uma loja do site (as lojas ficam no cadastro do site) |
| `opcionais` | não | lista de textos |
| `descricao` | não | texto |
| `ordem` | não | inteiro ≥ 0; menor aparece primeiro. Sem ele, vale a posição na lista |
| `destaque` | não | `true`/`false`; aparece na vitrine da home |
| `carroceria` | não | Hatch, Sedan, SUV, Picape... (vira filtro e página própria) |
| `link` | não | endereço da página do carro, para **manter URLs já indexadas no Google** numa migração (`carros/.../nome.html`, sem espaço, `?`, `#` ou `..`). Sem ele, a plataforma gera o endereço |

### Fotos

**Lista de URLs (recomendado):** mande as URLs públicas (http/https) das fotos, na ordem em que devem aparecer. A plataforma baixa, converte para webp em 3 tamanhos e publica. Isso acontece em segundo plano:

1. O pedido termina e o carro entra no site na hora, **sem foto** (aparece um marcador, nunca imagem quebrada).
2. Em seguida, as fotos são baixadas e convertidas, e a página do carro é refeita com elas. Em geral leva segundos; uma carga inicial grande pode levar minutos.
3. A mesma lista de URLs reenviada não baixa nada de novo. Se qualquer URL do carro mudar, as fotos dele são refeitas.

Cada foto tem limite de 20 MB e 30 s para baixar, e precisa ser imagem (`content-type: image/*`). URLs que apontam para rede interna são recusadas. Foto que falhar é pulada (as outras são renumeradas), e o motivo aparece em `GET /v1/sites/{dominio}` → `fotos.comErro`. Ali também fica `fotos.pendentes`, a quantidade de carros com fotos ainda na fila.

**Quantidade:** se o seu sistema já grava as fotos direto no armazenamento da plataforma, mande só o número. O padrão é:

```
{fotosBase}carros/{id}/{n}-{400|800|1600}.webp      n = 1..fotos
```

## Travas de segurança

- **Estoque inválido**: nada é gravado e o estoque anterior continua no ar.
- **Queda brusca**: se o estoque cair mais de 50% (sites com 10 carros ou mais) ou vier vazio, o pedido é `recusado`. Isso protege contra uma exportação com defeito apagando o site. Se a queda for de verdade, reenvie com `?forcar=1`.
- **Estoque igual ao anterior**: `concluido` com `"estoque": "igual"`, e nada é refeito.

## Carro que sai

Carro removido (ou ausente no estoque inteiro) não some na hora. A página dele vira "Este veículo não está mais disponível" (fora do Google) por 30 dias, para que links compartilhados no WhatsApp não deem erro. Se o carro voltar, a página volta.

## Fluxo recomendado

1. **A cada mudança** (carro novo, preço, vendido): `PUT` ou `DELETE` em `/carros/{id}`. É rápido e não pesa.
2. **Uma vez por dia**: `PUT /estoque` com o estoque inteiro. Isso corrige qualquer chamada que tenha se perdido. Se nada mudou, não custa nada.
3. Para conferir: `GET /v1/sites/{dominio}/estoque` devolve o que está valendo.

## Exemplos

```bash
API=https://api.exemplo.com.br; T="Authorization: Bearer $TOKEN"

# estoque inteiro, esperando o resultado
curl -X PUT "$API/v1/sites/loja1.com.br/estoque?esperar=60" -H "$T" -H 'content-type: application/json' --data @estoque.json

# um carro novo ou alterado
curl -X PUT "$API/v1/sites/loja1.com.br/carros/ABC123" -H "$T" -H 'content-type: application/json' \
  -d '{"marca":"Toyota","modelo":"Corolla","versao":"XEi 2.0","ano":2022,"preco":129900,"km":35000,"cor":"Prata","cambio":"Automático","combustivel":"Flex","fotos":12,"loja":"matriz"}'

# vendido
curl -X DELETE "$API/v1/sites/loja1.com.br/carros/ABC123" -H "$T"

# acompanhar
curl "$API/v1/pedidos/pmhb2k0a01f3e2" -H "$T"
```

Limites: estoque inteiro de até 100 MB e carro avulso de até 1 MB.

Infraestrutura (Kubernetes na AWS, escala, multi-tenant): `infra/README.md`.
