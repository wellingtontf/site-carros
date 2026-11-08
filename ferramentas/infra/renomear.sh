#!/bin/sh
# Site JÁ NO AR troca de domínio: cria o tenant do domínio novo. O domínio antigo continua no ar até o 301 dele estar
# configurado. O 301 do domínio inteiro (antigo → novo) ainda é MANUAL: redirecionamento no provedor de DNS do cliente
# ou um distribution tenant de redirecionamento. É o caso raro (rascunho usa promover.sh).
#   DISTRIBUICAO=... renomear.sh <antigo> <novo>
. "$(dirname "$0")/comum.sh"
exige DISTRIBUICAO
dominio_ok "$1"; dominio_ok "$2"
criar_tenant "$2"
echo "PENDENTE (manual): 301 de https://$1/* e https://www.$1/* para https://$2/ (mesmo caminho); depois remover.sh $1"
