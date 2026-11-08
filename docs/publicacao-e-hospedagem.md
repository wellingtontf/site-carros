# Publicação e hospedagem

## Publicar

O build só gera `sites-public/<dominio>/`. Publicar é mandar isso para a hospedagem.

```
node core/cli.js publicar                    # publica as pendências de todos os sites
node core/cli.js atualizar <d> --publicar    # atualiza o estoque e já publica
PUBLICAR=1 node api/servidor.js              # a API publica depois de cada build
```

- Cada build registra a **pendência** do site em `.estado/sites-public/pendentes/<dominio>.json`: a lista de arquivos
  escritos e removidos. A reserva é atômica (dois pods nunca publicam a mesma pendência).
- `config/publicacao.json` (copie de `config/publicacao.exemplo.json`) define o comando, com os marcadores `{site}`,
  `{pasta}`, `{lista}` (arquivos alterados), `{removidos}` e `{completo}`, e quantos sites em paralelo (`paralelo`):
  ```json
  { "paralelo": 4, "comandoSite": "aws s3 sync {pasta} s3://sites-revenda-mais/{site}/ --exclude '*' {lista}" }
  ```
  Com `aws s3 sync --delete`, cuidado com a publicação incremental: prefira `{lista}` e `{removidos}`.
- Só limpa a pendência dos sites que publicaram com sucesso; o que falhou tenta de novo na próxima.
- **A publicação recusa** site com problema de produção: `url` sem https ou `fotosBase` em localhost/http (o build avisa).
- Cada inquilino pode ter o seu `publicacao.json` (bucket e até conta AWS próprios).

## Antes de publicar: auditoria

`node ferramentas/auditar-sites.js` confere os problemas clássicos de site estático no ar: 404 próprio, cache de css/js
(`?v=`), localhost e conteúdo misto, charset, JSON-LD, sitemap, tamanho do `estoque.json`.

## O que a hospedagem precisa fazer

| Regra | Por quê |
|---|---|
| `/pasta/` → `/pasta/index.html` | o site é feito de pastas com `index.html` |
| `/pasta` → 301 `/pasta/` | um endereço só por página (SEO) |
| **`/multipla/<qualquer coisa>` → `multipla/index.html`** (rewrite, sem redirecionar) | as rotas da listagem ([listagem-e-busca.md](listagem-e-busca.md)) |
| `/contato`, `/lojas/` (fora das pastas do site) → 301 `/paginas/...` | endereços antigos de página |
| `//` → 301 `/` | links antigos do Revenda Mais |
| erro → `/404.html` do site | página de erro com menu e estoque |
| `www.loja.com.br` e `loja.com.br` na mesma pasta | a pasta é sempre o domínio sem `www`; o oficial é o `url` do `site.json` |
| gzip/brotli ligados | `estoque.json` de 326 KB vira ~33 KB |
| css/js: `Cache-Control: public, max-age=31536000, immutable` | eles têm `?v=<hash>` no endereço |
| HTML: cache curto (ex.: 5 min) ou invalidação da `{lista}` | o HTML muda a cada atualização |

No CloudFront, tudo isso está na função de borda `infra/cloudfront/roteador.js` (testada em `tests/cloudfront.test.js`) e
na configuração descrita em [infraestrutura.md](infraestrutura.md).

### nginx ou Apache

Funciona, é só servir a pasta do site como raiz do domínio, com as regras acima. O essencial:

```nginx
server {
  server_name loja.com.br www.loja.com.br;
  root /var/www/sites-public/loja.com.br;
  gzip on; gzip_types application/json text/css application/javascript;
  location /multipla/ { try_files $uri /multipla/index.html; }
  location / { try_files $uri $uri/index.html =404; }
  error_page 404 /404.html;
  location ~* \.(css|js)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```
```apache
# .htaccess na raiz do site
RewriteEngine On
RewriteRule ^multipla/.+ /multipla/index.html [L]
ErrorDocument 404 /404.html
```
Os 301 de páginas antigas (`/contato` → `/paginas/contato/`) também precisam de regra nesses servidores.

## Servidor local

```
node ferramentas/servidor-local.js 8080      # http://localhost:8080/<dominio>/
```
Usa a **mesma** função de borda do CloudFront: rotas da listagem, 301 de páginas antigas, barra final e `404.html` de cada
site. É o jeito de testar igual à produção. O `python3 -m http.server` não serve mais (as rotas dariam 404).

## Pastas de saída

- `sites-public/` é a **única** que vale (build, API, publicação).
- `dist-preview/` = `node core/build.js --motor rascunho` (para olhar um motor novo; nunca é publicada).
- `node core/cli.js testar` gera numa pasta temporária em `.estado/` e apaga no fim.
- Pasta em `sites-public/` sem site em `sites-config/` é sobra: o build avisa e `node core/cli.js limpar-public --aplicar`
  apaga.

## SEO

- `/multipla/`, a home e as páginas com o componente `estoque` já saem com os primeiros cards no HTML.
- `sitemap.xml` com `<lastmod>` real (o dia em que a página mudou de verdade) e `robots.txt` por site
  (`node core/cli.js sitemap [dominios]` refaz só o sitemap).
- Canonical em todas as páginas; nas rotas da listagem, o canonical é a própria rota (na ordem canônica).
- Rascunho: `noindex` em tudo e `robots.txt` fechado.
- `PUT /v1/robots` troca o robots.txt de todos os sites de um inquilino em segundos (com trava contra `Disallow: /`).
