# Imagem única da plataforma (API e trabalhador: o papel é escolhido por PAPEL no Kubernetes).
#   docker build -f infra/docker/Dockerfile -t site-carros:<versão> .
# Código (core, api, temas com as páginas padrão de cada um) vai NA IMAGEM, versionado. Dados (sites, estado, fila, saída) ficam no
# volume compartilhado montado em /dados (EFS na AWS).
FROM node:22-alpine

# python3 + Pillow: conversor de fotos (core/converter-foto.py); aws-cli: comandos de publicação/fotos/infra;
# tini: repassa o SIGTERM do Kubernetes para o node (desligamento com calma)
RUN apk add --no-cache python3 py3-pillow aws-cli tini

WORKDIR /app
COPY package.json ./
COPY core ./core
COPY api ./api
COPY temas ./temas
COPY componentes ./componentes
COPY ferramentas ./ferramentas

ENV NODE_ENV=production \
    SITE_CARROS_RAIZ=/dados \
    SITE_CARROS_TEMAS=/app/temas \
    SITE_CARROS_COMPONENTES=/app/componentes \
    PORT=8787 \
    LOG_JSON=1

# não roda como root; o volume /dados precisa ser gravável pelo uid 1000 (no EFS: access point com uid/gid 1000)
USER node
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "api/servidor.js"]
