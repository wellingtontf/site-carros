#!/bin/sh
# Site removido: tira o tenant e os arquivos do site do S3.
#   DISTRIBUICAO=... BUCKET=... remover.sh <site>
. "$(dirname "$0")/comum.sh"
exige BUCKET
dominio_ok "$1"
remover_tenant "$1"
apagar_prefixo "$1"
