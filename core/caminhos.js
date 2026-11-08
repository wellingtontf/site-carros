// Todos os caminhos do projeto num lugar só. O core nunca monta caminho "na mão" fora daqui.
//
//   core/                     código (este diretório): motor, ui, build, cli, atualizar, servidor
//     motor/<versao>/engine.js   motor que roda no navegador (rascunho = única versão editável)
//     ui/                        liga o motor à página (copiado para <site>/motor/ no build)
//   sites-config/<dominio>/          um site por domínio
//     site.json                  configuração do site (inclui as lojas)
//     estoque.json               o único JSON de carros do site
//     assets/                    imagens próprias do site (logo, banner...) → <site>/assets/
//     paginas/                   páginas do site (index.json = home, <nome>.json de blocos, <nome>.html livre)
//     componentes/               opções dos componentes no site inteiro (<nome>.json, ex.: estoque.json)
//   componentes/<nome>/      componentes (filtro, estoque...) que todo template e toda página usam: {{componente nome}}
//   templates/<nome>/         visual (o web designer só mexe aqui)
//     template.json, paginas/{home,multipla,carro,vendido,pagina}.html, blocos/, parciais/, css/, js/, img/
//     paginas-extras/            páginas livres de TODOS os sites do template
//   inquilinos/<id>/          multi-tenant: inquilino.json + config/ própria (fotos, infra, publicação, robots, modelo de site)
//   config/                   configuração global (e a do inquilino "padrao"): fontes.json, publicacao.json, historico.json, clientes.json
//   .estado/                  estado do build incremental, travas, cópias de segurança
//     api/pedidos/, api/entrada/  pedidos recebidos pela API e o corpo deles enquanto estão na fila
//   sites-public/             saída: os sites gerados, uma pasta por domínio (é o que vai para o ar)
const path = require('path');

// SITE_CARROS_RAIZ troca a pasta de dados (sites-config/, templates/, config/, .estado/, sites-public/): usado pelos testes.
// O código (core/motor, core/ui) vem sempre daqui.
const ROOT = process.env.SITE_CARROS_RAIZ ? path.resolve(process.env.SITE_CARROS_RAIZ) : path.resolve(__dirname, '..');
const CORE = __dirname;
const SITES = path.join(ROOT, 'sites-config');
const PUBLICO = 'sites-public';
// componentes (filtro, estoque...) usados por todos os templates e páginas; código versionado, vai na imagem como os templates
const COMPONENTES = process.env.SITE_CARROS_COMPONENTES ? path.resolve(process.env.SITE_CARROS_COMPONENTES) : path.join(ROOT, 'componentes'); // nome da pasta de saída (relativo à raiz): C.saida(C.PUBLICO) = <raiz>/sites-public
// templates (com as páginas padrão de cada um em templates/<nome>/paginas-padrao/) são CÓDIGO versionado: na imagem
// Docker eles vêm junto (SITE_CARROS_TEMPLATES aponta para dentro da imagem); os DADOS ficam no volume (EFS)
const TEMPLATES = process.env.SITE_CARROS_TEMPLATES ? path.resolve(process.env.SITE_CARROS_TEMPLATES) : path.join(ROOT, 'templates');
const CONFIG = path.join(ROOT, 'config');
const ESTADO = path.join(ROOT, '.estado');
const INQUILINOS = path.join(ROOT, 'inquilinos'); // multi-tenant: inquilinos/<id>/{inquilino.json, config/}

module.exports = {
  ROOT, CORE, SITES, TEMPLATES, CONFIG, ESTADO, INQUILINOS, PUBLICO, COMPONENTES,
  inquilino: (id) => path.join(INQUILINOS, id),
  inquilinoJson: (id) => path.join(INQUILINOS, id, 'inquilino.json'),
  inquilinoConfig: (id, arquivo) => path.join(INQUILINOS, id, 'config', arquivo),
  inquilinoTemplates: (id) => path.join(INQUILINOS, id, 'templates'), // templates PRÓPRIOS do inquilino (no volume: sem deploy)
  MOTOR: path.join(CORE, 'motor'),
  UI: path.join(CORE, 'ui'),
  motor: (versao) => path.join(CORE, 'motor', versao),
  site: (id) => path.join(SITES, id),
  siteJson: (id) => path.join(SITES, id, 'site.json'),
  estoque: (id) => path.join(SITES, id, 'estoque.json'),
  assets: (id) => path.join(SITES, id, 'assets'),
  // web/ = ESPELHO do site público (sites-public/<dominio>/): cada arquivo é um endereço (decisão do Wellington)
  web: (id) => path.join(SITES, id, 'web'),
  home: (id) => path.join(SITES, id, 'web', 'index.json'), // → /
  multipla: (id) => path.join(SITES, id, 'web', 'multipla.json'), // → /multipla/ (blocosAntes, blocosDepois)
  paginasLivresSite: (id) => path.join(SITES, id, 'web', 'paginas'), // → /paginas/<nome>/ (.json de blocos ou .html livre)
  paginasAntigasSite: (id) => path.join(SITES, id, 'paginas'), // lugar antigo (ferramentas/mover-paginas.js leva para web/)
  componentesSite: (id) => path.join(SITES, id, 'componentes'), // opções dos componentes no site inteiro: <nome>.json
  paginasLivresTemplate: (nome) => path.join(TEMPLATES, nome, 'paginas-extras'),
  template: (nome) => path.join(TEMPLATES, nome),
  pagina: (nome, arquivo) => path.join(TEMPLATES, nome, 'paginas', arquivo),
  config: (arquivo) => path.join(CONFIG, arquivo),
  clientes: () => path.join(CONFIG, 'clientes.json'),
  robots: () => path.join(CONFIG, 'robots.txt'), // modelo do robots.txt de todos os sites (core/robots.js)
  pedidos: () => path.join(ESTADO, 'api', 'pedidos'),
  entrada: () => path.join(ESTADO, 'api', 'entrada'),
  fotosEstado: (id) => path.join(ESTADO, 'fotos', `${id}.json`), // fotos por URL já processadas (core/fotos.js)
  saida: (pasta) => path.join(ROOT, pasta),
};
