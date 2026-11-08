# API de estoque (v1)

Contrato para qualquer sistema que mande carros para os sites da plataforma: Revenda Mais, outro CRM, ERP ou script. A plataforma não conhece o sistema de origem. Quem integra converte os dados para o formato abaixo, e a plataforma valida, grava e reconstrói **só o site afetado** (e nele só as páginas que mudaram).

## Acesso

Cada sistema recebe um **token próprio**, limitado aos sites dele. Quem administra a plataforma cria o token:

```
node core/cli.js cliente criar crm-x --sites loja1.com.br,loja2.com.br   # ou --sites "*" para todos
node core/cli.js cliente listar
node core/cli.js cliente remover crm-x                                    # o token deixa de valer na hora
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
| GET | `/v1/sites` | sites que o token pode alterar, com o total de carros e a data da última atualização |
| GET | `/v1/sites/{dominio}` | resumo do site e últimos pedidos |
| GET | `/v1/sites/{dominio}/estoque` | o estoque atual (para conferir ou reconciliar) |
| PUT | `/v1/sites/{dominio}/estoque` | **troca o estoque inteiro**: `{"carros":[...]}` (a lista pura também vale) |
| GET | `/v1/sites/{dominio}/carros/{id}` | um carro |
| PUT | `/v1/sites/{dominio}/carros/{id}` | **inclui ou altera um carro** (corpo = o carro; o `id` vem do endereço) |
| DELETE | `/v1/sites/{dominio}/carros/{id}` | **tira um carro** (vendido) |
| POST | `/v1/sites/{dominio}/build` | reconstrói o site sem mudar o estoque |
| POST | `/v1/atualizar` | puxa o estoque das URLs cadastradas em `config/fontes.json`: `{"sites":["loja1.com.br"]}` |
| GET | `/v1/pedidos/{pedido}` | andamento de um pedido |
| GET | `/v1/pedidos?site={dominio}&limite=20` | últimos pedidos do token |

Parâmetros das rotas que alteram dados:

- `?esperar=30`: segura a resposta até o pedido terminar (máximo de 120 s). Sem ele, a resposta é imediata (202) e você acompanha o pedido.
- `?forcar=1`: libera a trava de queda de estoque (ver abaixo).

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
  "fotos": 12,
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
| `fotos` | sim | quantidade de fotos, de 0 a 60 (ver "Fotos") |
| `loja` | se o site tem mais de uma loja | id de uma loja do site (as lojas ficam no cadastro do site) |
| `opcionais` | não | lista de textos |
| `descricao` | não | texto |
| `ordem` | não | inteiro ≥ 0; menor aparece primeiro. Sem ele, vale a posição na lista |
| `destaque` | não | `true`/`false`; aparece na vitrine da home |
| `carroceria` | não | Hatch, Sedan, SUV, Picape... (vira filtro e página própria) |
| `link` | não | endereço da página do carro, para **manter URLs já indexadas no Google** numa migração (`carros/.../nome.html`, sem espaço, `?`, `#` ou `..`). Sem ele, a plataforma gera o endereço |

### Fotos

A API recebe só a **quantidade** de fotos. Os arquivos ficam no armazenamento de fotos do site (`fotosBase`), neste padrão:

```
{fotosBase}carros/{id}/{n}-{400|800|1600}.webp      n = 1..fotos
```

Foto que faltar vira um marcador cinza no site, sem quebrar a página.

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
