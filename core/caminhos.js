// Todos os caminhos do projeto num lugar só. O core nunca monta caminho "na mão" fora daqui.
//
//   core/                     código (este diretório): motor, ui, build, cli, atualizar, servidor
//     motor/<versao>/engine.js   motor que roda no navegador (rascunho = única versão editável)
//     ui/                        liga o motor à página (copiado para <site>/motor/ no build)
//   sites/<dominio>/          um site por domínio
//     site.json                  configuração do site (inclui as lojas)
//     estoque.json               o único JSON de carros do site
//     assets/                    imagens próprias do site (logo, banner...) → <site>/assets/
//     paginas/                   páginas livres dos designers SÓ deste site (HTML normal; ver core/paginas-livres.js)
//   templates/<nome>/         visual (o web designer só mexe aqui)
//     template.json, paginas/{index,carro,vendido,pagina}.html, blocos/, parciais/, css/, js/, img/
//     paginas-extras/            páginas livres de TODOS os sites do template
//   paginas-padrao/           páginas que TODO site ganha (contato, privacidade, cookies, LGPD), com {{site.nome}}...
//   config/                   fontes.json, publicacao.json, historico.json, clientes.json (tokens da API)
//   .estado/                  estado do build incremental, travas, cópias de segurança
//     api/pedidos/, api/entrada/  pedidos recebidos pela API e o corpo deles enquanto estão na fila
//   dist/                     saída (uma pasta por domínio)
const path = require('path');

// SITE_CARROS_RAIZ troca a pasta de dados (sites/, templates/, config/, .estado/, dist/): usado pelos testes.
// O código (core/motor, core/ui) vem sempre daqui.
const ROOT = process.env.SITE_CARROS_RAIZ ? path.resolve(process.env.SITE_CARROS_RAIZ) : path.resolve(__dirname, '..');
const CORE = __dirname;
const SITES = path.join(ROOT, 'sites');
const TEMPLATES = path.join(ROOT, 'templates');
const CONFIG = path.join(ROOT, 'config');
const PAGINAS_PADRAO = path.join(ROOT, 'paginas-padrao');
const ESTADO = path.join(ROOT, '.estado');

module.exports = {
  ROOT, CORE, SITES, TEMPLATES, CONFIG, ESTADO, PAGINAS_PADRAO,
  MOTOR: path.join(CORE, 'motor'),
  UI: path.join(CORE, 'ui'),
  motor: (versao) => path.join(CORE, 'motor', versao),
  site: (id) => path.join(SITES, id),
  siteJson: (id) => path.join(SITES, id, 'site.json'),
  estoque: (id) => path.join(SITES, id, 'estoque.json'),
  assets: (id) => path.join(SITES, id, 'assets'),
  paginasLivresSite: (id) => path.join(SITES, id, 'paginas'),
  paginasLivresTemplate: (nome) => path.join(TEMPLATES, nome, 'paginas-extras'),
  template: (nome) => path.join(TEMPLATES, nome),
  pagina: (nome, arquivo) => path.join(TEMPLATES, nome, 'paginas', arquivo),
  config: (arquivo) => path.join(CONFIG, arquivo),
  clientes: () => path.join(CONFIG, 'clientes.json'),
  pedidos: () => path.join(ESTADO, 'api', 'pedidos'),
  entrada: () => path.join(ESTADO, 'api', 'entrada'),
  fotosEstado: (id) => path.join(ESTADO, 'fotos', `${id}.json`), // fotos por URL já processadas (core/fotos.js)
  saida: (pasta) => path.join(ROOT, pasta),
};
