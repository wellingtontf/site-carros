#!/bin/sh
# Site novo (rascunho ou definitivo): cria o distribution tenant. Os arquivos sobem pela publicação (publicacao.json).
#   DISTRIBUICAO=... [GRUPO=...] [RASCUNHO_RE=...] criar.sh <site>
. "$(dirname "$0")/comum.sh"
exige DISTRIBUICAO
dominio_ok "$1"
criar_tenant "$1"
