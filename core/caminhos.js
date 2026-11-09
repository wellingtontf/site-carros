// Todos os caminhos do projeto num lugar só. O core nunca monta caminho "na mão" fora daqui.
//
//   core/                     código (este diretório): motor, ui, build, cli, atualizar, servidor
//     motor/<versao>/engine.js   motor que roda no navegador (rascunho = única versão editável)
//     ui/                        liga o motor à página (copiado para <site>/motor/ no build)
//   sites-config/<dominio>/          um site por domínio
//     site.json                  configuração do site (inclui as lojas)
//     estoque.json               o único JSON de carros do site
//     assets/                    imagens próprias do site (logo, banner...) → <site>/assets/
//     web/                       espelho do site público: index.json (home), multipla.json, paginas/ (<nome>.json de seções, <nome>.html livre)
//     componentes/               opções dos componentes no site inteiro (<nome>.json, ex.: estoque.json)
//     codigos/                   scripts do site (GTM, chat...): head.html e body.html; só rodam depois do aceite de cookies
//   componentes/<nome>/      componentes (filtro, estoque...) que todo tema e toda página usam: {{componente nome}}
//   temas/<nome>/             o TEMA (visual; estrutura no padrão Shopify; o web designer só mexe aqui)
//     config/settings_schema.json  nome, descrição e opções do tema
//     layout/tema.html           moldura única (head, cabeçalho, rodapé, scripts) com os espaços {{$nome}}{{/nome}}
//     templates/{home,multipla,carro,vendido,pagina}.html  um por tipo de página
//     secoes/  snippets/  assets/ (css/, js/, img/ → raiz do site gerado)
//     paginas-padrao/, paginas-extras/  páginas de TODOS os sites do tema
//   inquilinos/<id>/          multi-tenant: inquilino.json + config/ própria (fotos, infra, publicação, robots, modelo de site)
//   config/                   configuração global (e a do inquilino "padrao"): fontes.json, publicacao.json, historico.json, clientes.json
//   .estado/                  estado do build incremental, travas, cópias de segurança
//     api/pedidos/, api/entrada/  pedidos recebidos pela API e o corpo deles enquanto estão na fila
//   sites-public/             saída: os sites gerados, uma pasta por domínio (é o que vai para o ar)
const path = require('path');

// SITE_CARROS_RAIZ troca a pasta de dados (sites-config/, temas/, config/, .estado/, sites-public/): usado pelos testes.
// O código (core/motor, core/ui) vem sempre daqui.
const ROOT = process.env.SITE_CARROS_RAIZ ? path.resolve(process.env.SITE_CARROS_RAIZ) : path.resolve(__dirname, '..');
const CORE = __dirname;
const SITES = path.join(ROOT, 'sites-config');
const PUBLICO = 'sites-public';
// componentes (filtro, estoque...) usados por todos os temas e páginas; código versionado, vai na imagem como os temas
const COMPONENTES = process.env.SITE_CARROS_COMPONENTES ? path.resolve(process.env.SITE_CARROS_COMPONENTES) : path.join(ROOT, 'componentes'); // nome da pasta de saída (relativo à raiz): C.saida(C.PUBLICO) = <raiz>/sites-public
// temas (com as páginas padrão de cada um em temas/<nome>/paginas-padrao/) são CÓDIGO versionado: na imagem
// Docker eles vêm junto (SITE_CARROS_TEMAS aponta para dentro da imagem); os DADOS ficam no volume (EFS)
const TEMAS = process.env.SITE_CARROS_TEMAS ? path.resolve(process.env.SITE_CARROS_TEMAS) : path.join(ROOT, 'temas');
// versões do motor (core/motor/v1, v2... e o rascunho): código, vai na imagem. SITE_CARROS_MOTOR troca a pasta (os testes
// do "congelar" usam uma cópia, para nunca criar versão no projeto)
const MOTOR = process.env.SITE_CARROS_MOTOR ? path.resolve(process.env.SITE_CARROS_MOTOR) : path.join(CORE, 'motor');
const CONFIG = path.join(ROOT, 'config');
const ESTADO = path.join(ROOT, '.estado');
const INQUILINOS = path.join(ROOT, 'inquilinos'); // multi-tenant: inquilinos/<id>/{inquilino.json, config/}

module.exports = {
  ROOT, CORE, SITES, TEMAS, CONFIG, ESTADO, INQUILINOS, PUBLICO, COMPONENTES,
  inquilino: (id) => path.join(INQUILINOS, id),
  inquilinoJson: (id) => path.join(INQUILINOS, id, 'inquilino.json'),
  inquilinoConfig: (id, arquivo) => path.join(INQUILINOS, id, 'config', arquivo),
  inquilinoTemas: (id) => path.join(INQUILINOS, id, 'temas'), // temas PRÓPRIOS do inquilino (no volume: sem deploy)
  MOTOR,
  UI: path.join(CORE, 'ui'),
  motor: (versao) => path.join(MOTOR, versao),
  site: (id) => path.join(SITES, id),
  siteJson: (id) => path.join(SITES, id, 'site.json'),
  estoque: (id) => path.join(SITES, id, 'estoque.json'),
  assets: (id) => path.join(SITES, id, 'assets'),
  // web/ = ESPELHO do site público (sites-public/<dominio>/): cada arquivo é um endereço (decisão do Wellington)
  web: (id) => path.join(SITES, id, 'web'),
  home: (id) => path.join(SITES, id, 'web', 'index.json'), // → /
  multipla: (id) => path.join(SITES, id, 'web', 'multipla.json'), // → /multipla/ (secoesAntes, secoesDepois)
  paginasLivresSite: (id) => path.join(SITES, id, 'web', 'paginas'), // → /paginas/<nome>/ (.json de blocos ou .html livre)
  paginasAntigasSite: (id) => path.join(SITES, id, 'paginas'), // lugar antigo (ferramentas/mover-paginas.js leva para web/)
  codigosSite: (id) => path.join(SITES, id, 'codigos'), // scripts do site: head.html e body.html (core/codigos.js)
  codigosInquilino: (id) => path.join(INQUILINOS, id, 'codigos'), // scripts de todos os sites do inquilino
  componentesSite: (id) => path.join(SITES, id, 'componentes'), // opções dos componentes no site inteiro: <nome>.json
  tema: (nome) => path.join(TEMAS, nome),
  // estrutura de um tema (padrão Shopify): o resto do core usa estes nomes, nunca o texto da pasta
  TEMA: { schema: path.join('config', 'settings_schema.json'), layout: path.join('layout', 'tema.html'), templates: 'templates', secoes: 'secoes', snippets: 'snippets', assets: 'assets',
    paginasPadrao: 'paginas-padrao', paginasExtras: 'paginas-extras' },
  // estrutura antiga (antes de 2026-11-08): só para dar erro claro e migrar (ferramentas/migrar-temas.js)
  TEMA_ANTIGO: ['template.json', 'paginas', 'blocos', 'parciais'],
  config: (arquivo) => path.join(CONFIG, arquivo),
  clientes: () => path.join(CONFIG, 'clientes.json'),
  robots: () => path.join(CONFIG, 'robots.txt'), // modelo do robots.txt de todos os sites (core/robots.js)
  pedidos: () => path.join(ESTADO, 'api', 'pedidos'),
  entrada: () => path.join(ESTADO, 'api', 'entrada'),
  fotosEstado: (id) => path.join(ESTADO, 'fotos', `${id}.json`), // fotos por URL já processadas (core/fotos.js)
  saida: (pasta) => path.join(ROOT, pasta),
};
