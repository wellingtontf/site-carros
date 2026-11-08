#!/bin/sh
# Rascunho → definitivo: tenant do domínio final (com certificado), depois tira o rascunho do ar (tenant + arquivos).
# Sem 301: o rascunho nunca esteve no Google. O domínio final é publicado inteiro pela publicação.
#   DISTRIBUICAO=... BUCKET=... [RASCUNHO_RE=...] promover.sh <rascunho> <site>
. "$(dirname "$0")/comum.sh"
exige DISTRIBUICAO BUCKET
dominio_ok "$1"; dominio_ok "$2"
if [ "$1" != "$2" ]; then
  criar_tenant "$2"
  remover_tenant "$1"
  apagar_prefixo "$1"
fi
