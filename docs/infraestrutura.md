# Infraestrutura: Kubernetes (EKS) na AWS, multi-tenant

Como a plataforma roda em produção para milhares de sites de vários inquilinos (Revenda Mais, Webmotors, terceiros).

## Visão geral

```
  Sistemas dos inquilinos ──HTTPS──▶ ALB ──▶ pods "api" (2..10, HPA por CPU)
  (Revenda Mais, Webmotors...)                      │ grava pedido
                                                    ▼
                                   ┌──── EFS (volume compartilhado, /dados) ────┐
                                   │ inquilinos/  sites-config/  config/         │
                                   │ .estado/ (fila, travas, estado do build)    │
                                   │ sites-public/ (sites gerados)               │
                                   └─────────────────────────────────────────────┘
                                                    ▲ pega um site por vez (trava por site)
                                   pods "trabalhador" (2..20, KEDA pelo tamanho da fila)
                                     │ gera o site      │ fotos por URL       │ publica só o que mudou
                                     ▼                  ▼                     ▼
                              (no EFS)           S3 de fotos (webp)     S3 dos sites ──▶ CloudFront ──▶ visitantes
```

- **Uma imagem, dois papéis** (`infra/docker/Dockerfile`): `PAPEL=api` recebe as chamadas e `PAPEL=trabalhador` processa a fila. Os dois só conversam pelo EFS, então cada um escala sozinho.
- **API sem estado:** qualquer pod atende qualquer chamada. O `?esperar` acompanha o arquivo do pedido no EFS, então funciona mesmo que outro pod processe.
- **Trabalhadores em paralelo:** cada um reserva **um site por vez** (`.estado/travas/fila-*-<site>.lock`, criado de forma atômica). Dez trabalhadores geram dez sites ao mesmo tempo, e o mesmo site nunca é gerado por dois. Se um pod morre no meio, a trava expira em 5 min (é renovada enquanto o trabalho dura) e outro pod pega o site; nenhum pedido se perde.
- **Operações em todos os sites** (refazer todos, robots.txt de um inquilino) viram **um pedido por site**, num lote (`GET /v1/lotes/<id>`), e os trabalhadores dividem o serviço.
- **Fotos num canal próprio:** download e conversão não seguram a atualização de estoque.
- **Desligamento com calma:** no `SIGTERM`, o pod para de pegar trabalho e termina o site que está gerando (até 10 min nos trabalhadores).

## Multi-tenant

```
inquilinos/revenda-mais/inquilino.json      { "nome", "templates": [...], "rascunhos": { "padrao": "site{n}.carro57.com.br" } }
inquilinos/revenda-mais/config/             fotos.json, infra.json, publicacao.json, robots.txt, site-modelo.json
inquilinos/webmotors/...
sites-config/<dominio>/site.json                   "inquilino": "revenda-mais"
config/clientes.json                        tokens (só o hash), cada um de UM inquilino
```

| O quê | Isolamento |
|---|---|
| Sites | O token só vê e altera sites do inquilino dele. `"*"` = todos os sites **do inquilino**. Só o admin da plataforma (`TOKEN_ATUALIZAR`) atravessa inquilinos. |
| Domínio | Único na plataforma: dois inquilinos não disputam o mesmo domínio. O erro diz "em uso" sem revelar de quem é. |
| Rascunhos | Sequência própria por inquilino (`site{n}.carro57.com.br`, `loja{n}.outro.com.br`). O padrão não pode ser de dois inquilinos. |
| Templates | `"templates"` no inquilino libera só alguns (o visual de um cliente não vaza para outro inquilino). |
| robots.txt, modelo de site | Por inquilino (`PUT /v1/robots` mexe só nos sites do token). |
| Publicação, fotos, infra | Comandos por inquilino (`{inquilino}` disponível): **bucket, distribuição CloudFront e até conta AWS separados por inquilino**, se o contrato exigir. |

Criar inquilino e token:

```
kubectl -n site-carros exec deploy/api -- node api/cli.js inquilino criar webmotors --nome "Webmotors" --rascunho "loja{n}.previa-wm.com.br"
kubectl -n site-carros exec deploy/api -- node api/cli.js cliente criar wm-integracao --inquilino webmotors --sites "*"
```

## Hospedagem dos sites (2500+ domínios)

- **S3** com um prefixo por site (`s3://sites-<inquilino>/<dominio>/`). A publicação sobe só o que mudou (`publicacao.json` → `aws s3 sync`/`cp` com `{lista}`).
- **CloudFront SaaS Manager:** uma distribuição *multi-tenant* por inquilino, e cada site é um *distribution tenant* com o próprio domínio, certificado gerenciado e origin path `/<dominio>`. Ele foi feito para esse caso (milhares de domínios), sem os limites de domínios alternativos de uma distribuição comum. O comando `criar`/`promover` do `infra.json` cria o *tenant* e o certificado; o `renomear` cuida do 301 do domínio antigo. **Confirmar no piloto:** o origin path por *tenant* (parâmetros do SaaS Manager). Sem ele, use uma distribuição com `PREFIXO_POR_DOMINIO = true` na função de borda; nesse caso, a página 404 por site precisa de Lambda@Edge.
- **Função de borda** (`infra/cloudfront/roteador.js`, testada em `tests/cloudfront.test.js`): `/pasta/ → /pasta/index.html`, `/pasta → 301 /pasta/`, `//` dos links antigos → 301, endereço antigo de página (`/contato`) → 301 `/paginas/contato/` e **rotas da listagem**: qualquer `/multipla/...` entrega `multipla/index.html` sem redirecionar ([listagem-e-busca.md](listagem-e-busca.md)). Localmente, `node ferramentas/servidor-local.js` usa a mesma função. A página de erro de cada site é a resposta de erro personalizada `/404.html` (resolvida pelo origin path do *tenant*).
- **Rascunhos:** certificado curinga `*.carro57.com.br` + DNS curinga (Route 53). Criar rascunho não exige certificado nem DNS novos.
- **Cache:** css/js têm `?v=<hash>`, então podem ter `Cache-Control: public, max-age=31536000, immutable`. HTML fica com cache curto (ex.: 5 min) ou invalidação dos arquivos da `{lista}`.
- Compressão (gzip/brotli) ligada na distribuição.

## Capacidade (ordem de grandeza)

| Item | Número |
|---|---|
| Arquivos | ~1 página por carro: supondo ~300 carros por site, 2500 sites ≈ 750 mil páginas (medido: 12 MB por site de 1000 carros; 23 MB e 1570 arquivos com 1500 carros de URLs de foto longas) |
| Atualização de estoque | refaz só os carros que mudaram: ~0,25 s por site em disco local; conte 2–5× no EFS |
| Refazer todos | lote com um pedido por site; com 10 trabalhadores × `PARALELO=2`, 20 sites ao mesmo tempo |
| Fila | arquivos no EFS; aguenta milhares de pedidos por hora. Acima disso, o próximo passo é trocar o armazenamento da fila (`api/fila.js`) por SQS + DynamoDB, sem mexer no core |

## Subindo

1. **EKS** com os add-ons `aws-efs-csi-driver`, AWS Load Balancer Controller, KEDA e Prometheus.
2. **EFS** (modo de throughput *Elastic*, backup diário com AWS Backup) e o `fileSystemId` em `infra/k8s/armazenamento.yaml`.
3. **ECR:** `docker build -f infra/docker/Dockerfile -t <ecr>/site-carros:<versão> .` e `docker push`; a versão vai em `infra/k8s/kustomization.yaml`.
4. **IAM (IRSA):** o papel de `infra/k8s/conta-servico.yaml` com acesso aos buckets e ao CloudFront.
5. Secret `TOKEN_ATUALIZAR` (de preferência via External Secrets + Secrets Manager).
6. `kubectl apply -k infra/k8s`.
7. Copiar os dados atuais para o EFS (`sites-config/`, `inquilinos/`, `config/`, `.estado/`) e rodar um `POST /v1/build` com o token admin.

## Scripts de infra (`ferramentas/infra/`)

O `infra.json` de cada inquilino chama estes scripts com os IDs daquele inquilino (distribuição multi-tenant, bucket, regex dos rascunhos). Exemplo em `config/infra.exemplo.json`. Todos aceitam `SIMULAR=1` (só mostram os comandos) e podem rodar de novo sem estragar nada.

| Script | Faz |
|---|---|
| `criar.sh <site>` | `create-distribution-tenant` com `--parameters Name=pasta,Value=<site>`. Rascunho só com o endereço (certificado curinga); definitivo com `www` e certificado gerenciado (`ValidationTokenHost=cloudfront`) |
| `promover.sh <rascunho> <site>` | cria o tenant definitivo e depois tira o rascunho do ar (tenant + `s3 rm` do prefixo) |
| `remover.sh <site>` | tira o tenant e os arquivos do S3 |
| `renomear.sh <antigo> <novo>` | cria o tenant novo; **o 301 do domínio antigo ainda é manual** |

A distribuição multi-tenant de cada inquilino precisa ter `OriginPath: /{{pasta}}` e o parâmetro `pasta` em `TenantConfig.ParameterDefinitions`. Isso está confirmado na documentação da AWS ([create-distribution-tenant](https://docs.aws.amazon.com/cli/latest/reference/cloudfront/create-distribution-tenant.html), [exemplo de distribuição](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_CreateDistribution_section.html)). Com isso, a resposta de erro `/404.html` cai na pasta de cada site.

## Limites conhecidos e próximos passos

- **Travas:** são renovadas enquanto o trabalho dura (o build síncrono também renova) e expiram em 5 min (`SITE_CARROS_TRAVA_EXPIRA_MS`) quando o pod morre.
- **Listagem de pedidos:** por site e por cliente usa um índice (`.estado/api/indice/`); só a listagem sem filtro (admin) lê a pasta de pedidos.
- **Templates:** os da imagem são a base versionada (deploy). Cada inquilino pode ter os **próprios** em `inquilinos/<id>/templates/<nome>/` (no EFS), que o designer publica sem deploy. Eles valem só para os sites do inquilino e, com o mesmo nome, substituem o da imagem só para ele.
- **Fila em arquivos:** fica, por aguentar o volume previsto. A troca por SQS + DynamoDB, se um dia for preciso, é só em `api/fila.js`.
- **A validar no piloto:** `delete-distribution-tenant` pode exigir desativar o tenant antes; o 301 de `renomear.sh` é manual.
- **Nada aqui foi aplicado numa conta AWS ainda.** Manifestos com sintaxe validada e scripts testados em modo simulado. Os IDs (conta, EFS, distribuição, certificado, ECR) são exemplos.
