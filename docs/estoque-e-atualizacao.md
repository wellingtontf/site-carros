# Estoque e atualização (o dia a dia)

Os carros vêm de outro sistema (hoje, o Revenda Mais). O formato do `estoque.json` está em
[configurar-um-site.md](configurar-um-site.md#estoquejson). Há dois jeitos de o estoque chegar:

## 1. Um sistema manda (API)

Qualquer sistema, com o token dele ([api.md](api.md)):
```
PUT    /v1/sites/<dominio>/estoque        estoque inteiro de um site
POST   /v1/estoques                       estoque de 1 ou N sites numa chamada
PUT    /v1/sites/<dominio>/carros/<id>    inclui ou altera um carro
DELETE /v1/sites/<dominio>/carros/<id>    carro vendido
```
- Valida na hora (422 com a lista de erros) e responde com um número de pedido (`?esperar=N` responde já com o resultado).
- Chamadas em sequência (uma rajada de carros) viram **um build só** (espera ~3 s sem chamada nova; `ATRASO_MS`), na
  ordem em que chegaram. A fila fica em disco (`.estado/api/`) e sobrevive a reinício.
- Fluxo recomendado: a cada mudança, `PUT`/`DELETE` do carro; uma vez por dia, `PUT /estoque` inteiro (corrige qualquer
  chamada perdida; se nada mudou, não custa nada).

## 2. A plataforma puxa (`config/fontes.json`)

```json
{ "lojateste.com.br": "https://api.revendamais.com.br/estoque/123",
  "outra.com.br": { "url": "https://...", "headers": { "Authorization": "Bearer ${TOKEN_RM}" } } }
```
```
node core/cli.js atualizar                          # todos os sites de fontes.json
node core/cli.js atualizar lojateste.com.br         # só esse
node core/cli.js atualizar lojateste.com.br --publicar   # e já publica o que mudou
```
Aceita `${VAR}` de ambiente nos headers; timeout de 30 s. Pela API: `POST /v1/atualizar`.

## O que acontece com cada estoque novo

1. **Validação:** ids únicos, `loja` existente no `site.json` (obrigatória se o site tem mais de uma loja), marca, modelo,
   versão, cor, câmbio e combustível preenchidos, ano de 1950 até o ano atual + 2, preço > 0, km ≥ 0, fotos de 0 a 60.
   **Qualquer erro → nada é gravado**, o estoque antigo continua valendo.
2. **Trava de queda:** se o estoque cair mais de 50% (sites com 10 carros ou mais) ou vier vazio, é recusado (protege
   contra uma exportação com defeito apagando o site). `--forcar` / `?forcar=1` libera.
3. **Igual ao anterior:** nada acontece.
4. Grava `sites-config/<d>/estoque.json` e guarda o anterior em `.estado/estoques-anteriores/`.
5. **Build só daquele site**, e nele só as páginas dos carros que mudaram, mais a listagem, a home (cards no HTML) e o
   `estoque.json` da saída.
6. Registra a **pendência de publicação** do site (o que foi escrito e o que foi removido).

Medido: atualizar um site (refaz só os carros que mudaram) leva ~0,25 s em disco local. Site com 1500 carros gerado do zero:
~1,9 s e ~106 MB de memória; sem mudanças, 0,36 s.

## Carro que sai

- A página dele vira **"Este veículo não está mais disponível"** (`vendido.html`, `noindex`) por `retencaoVendidosDias` (padrão 30, por site), para links compartilhados no WhatsApp não darem erro.
- Depois disso, a página é apagada (e despublicada).
- Se o carro voltar ao estoque, a página volta.

## Link da página do carro

- **Regra** (única, em `core/ui/link-carro.js`, usada pelo build, pelo navegador e pelos testes):
  `/carros/<Marca>/<Modelo>/<Versao>/<Marca>-<Modelo>-<Versao>-<ano>-<Cidade>-<Estado>-<id>.html`.
  Ex.: `/carros/Toyota/Corolla/Cross-Xre-20-Flex-Aut/Toyota-Corolla-Cross-Xre-20-Flex-Aut-2024-Curitiba-Parana-8643966.html`.
  Cada parte sem acento e pontuação, palavras com inicial maiúscula separadas por hífen; o estado por extenso.
- **Campo `link` no carro:** o endereço que o Revenda Mais já usa (com as manias dele, como "Maring", `//` e "R/t", que não
  dá para recalcular). A página fica **exatamente** nele: as URLs indexadas no Google não mudam.
- **Link que muda** (mudou versão, cidade...): o endereço antigo vira redirecionamento para o novo por
  `retencaoRedirecionamentoDias` (padrão 180).
- Cada página de carro tem title, description, canonical, `og:image` (preview no WhatsApp) e JSON-LD (`Car` + `Offer`).

## Fotos (só no S3)

Endereço: `<fotosBase>carros/<id>/<n>-<400|800|1600>.webp`. Foto que não existe vira um marcador (nunca imagem quebrada).

- **`fotos` como número:** as fotos já estão no armazenamento; o build só monta os endereços.
- **`fotos` como lista de URLs:** `core/fotos.js` baixa (com proteção contra SSRF, até 20 MB e 30 s por foto, só
  `image/*`), converte para webp nos 3 tamanhos e **sobe para o S3** a partir de uma pasta temporária (nada fica no
  servidor). Isso roda em segundo plano, num canal próprio da fila:
  1. o carro entra no site na hora, sem foto;
  2. quando as fotos ficam prontas, a página dele é refeita com elas;
  3. a mesma lista reenviada não baixa nada de novo; se uma URL mudar, as fotos daquele carro são refeitas.
- Foto que falhou é pulada (as outras são renumeradas); o motivo aparece em `GET /v1/sites/<d>` → `fotos.comErro`.
- Configuração: `config/fotos.json` (conversor e comando de envio). Carro que sai do estoque tem as fotos apagadas.
- Na mão: `node core/cli.js fotos [sites]`. Nos testes locais, o "bucket" é a pasta `s3-local/` (servida em :8081).

## Estoque de exemplo

`node ferramentas/gerar-exemplo.js` regera o estoque de teste da **primeseminovos** (400 carros, sempre os mesmos para
a mesma versão do gerador). Os geradores dos sites que saíram (autocentral, outlet, servopa) foram retirados.
