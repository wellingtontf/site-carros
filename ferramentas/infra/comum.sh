# Funções dos scripts de infra (CloudFront SaaS Manager + S3). Não rode direto: os outros scripts carregam este.
# Cada inquilino passa os IDs DELE no comando do infra.json, por exemplo:
#   "criar": "DISTRIBUICAO=E1ABC BUCKET=sites-revenda-mais ferramentas/infra/criar.sh {site}"
# DISTRIBUICAO  id da distribuição MULTI-TENANT do inquilino (OriginPath "/{{pasta}}", parâmetro "pasta" obrigatório)
# BUCKET        bucket S3 com os sites do inquilino (um prefixo por site: s3://BUCKET/<dominio>/)
# GRUPO         (opcional) connection group; sem ele, o padrão da conta
# RASCUNHO_RE   (opcional) regex dos endereços de rascunho cobertos pelo certificado curinga da distribuição
#               (ex.: '^site[0-9]+\.carro57\.com\.br$'): esses não pedem certificado próprio
# SIMULAR=1     só mostra os comandos (para conferir antes e para os testes)
set -eu
roda() { if [ "${SIMULAR:-}" = "1" ]; then echo "+ $*"; else "$@"; fi; }
nome_tenant() { echo "$1" | tr '.' '-'; }   # nome do distribution tenant: o domínio com "-" no lugar de "."
exige() { for v in "$@"; do eval "[ -n \"\${$v:-}\" ]" || { echo "falta a variável $v (veja ferramentas/infra/comum.sh)" >&2; exit 2; }; done; }
dominio_ok() { echo "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' || { echo "domínio inválido: $1" >&2; exit 2; }; }
eh_rascunho() { [ -n "${RASCUNHO_RE:-}" ] && echo "$1" | grep -Eq "$RASCUNHO_RE"; }
existe_tenant() { [ "${SIMULAR:-}" = "1" ] && return 1; aws cloudfront get-distribution-tenant --identifier "$(nome_tenant "$1")" >/dev/null 2>&1; }

# cria o distribution tenant do site (idempotente: se já existe, não faz nada)
criar_tenant() {
  site="$1"
  if existe_tenant "$site"; then echo "tenant de $site já existe"; return 0; fi
  if eh_rascunho "$site"; then
    # rascunho: coberto pelo certificado curinga da distribuição; só o próprio endereço
    roda aws cloudfront create-distribution-tenant --distribution-id "$DISTRIBUICAO" --name "$(nome_tenant "$site")" \
      --domains "Domain=$site" --parameters "Name=pasta,Value=$site" ${GRUPO:+--connection-group-id "$GRUPO"}
  else
    # definitivo: domínio e www, com certificado gerenciado pelo CloudFront (validação servida pelo próprio CloudFront)
    roda aws cloudfront create-distribution-tenant --distribution-id "$DISTRIBUICAO" --name "$(nome_tenant "$site")" \
      --domains "Domain=$site" "Domain=www.$site" --parameters "Name=pasta,Value=$site" \
      --managed-certificate-request "ValidationTokenHost=cloudfront" ${GRUPO:+--connection-group-id "$GRUPO"}
    echo "DNS (no provedor do cliente): $site e www.$site → CNAME/ALIAS para o endpoint do connection group"
  fi
}

# apaga o distribution tenant (pega o ETag atual; A VALIDAR NO PILOTO: pode exigir desativar antes)
remover_tenant() {
  site="$1"
  if [ "${SIMULAR:-}" = "1" ]; then echo "+ aws cloudfront delete-distribution-tenant --id $(nome_tenant "$site") --if-match <ETag>"; return 0; fi
  existe_tenant "$site" || { echo "tenant de $site não existe"; return 0; }
  dados=$(aws cloudfront get-distribution-tenant --identifier "$(nome_tenant "$site")" --output json)
  id=$(echo "$dados" | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>console.log(JSON.parse(t).DistributionTenant.Id))")
  etag=$(echo "$dados" | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>console.log(JSON.parse(t).ETag))")
  aws cloudfront delete-distribution-tenant --id "$id" --if-match "$etag"
}

apagar_prefixo() { roda aws s3 rm "s3://$BUCKET/$1/" --recursive; }
