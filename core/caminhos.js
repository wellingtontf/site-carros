// Todos os caminhos do projeto num lugar só. O core nunca monta caminho "na mão" fora daqui.
//
//   core/                     código (este diretório): motor, ui, build, cli, atualizar, servidor
//     motor/<versao>/engine.js   motor que roda no navegador (rascunho = única versão editável)
//     ui/                        liga o motor à página (copiado para <site>/motor/ no build)
//   sites/<dominio>/          um site por domínio
//     site.json                  configuração do site (inclui as lojas)
//     estoque.json               o único JSON de carros do site
//     assets/                    imagens próprias do site (logo, banner...) → <site>/assets/
//   templates/<nome>/         visual (o web designer só mexe aqui)
//     template.json, paginas/{index,carro,vendido}.html, css/, js/, img/
//   config/                   fontes.json, publicacao.json, historico.json
//   .estado/                  estado do build incremental, travas, cópias de segurança
//   dist/                     saída (uma pasta por domínio)
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = __dirname;
const SITES = path.join(ROOT, 'sites');
const TEMPLATES = path.join(ROOT, 'templates');
const CONFIG = path.join(ROOT, 'config');
const ESTADO = path.join(ROOT, '.estado');

module.exports = {
  ROOT, CORE, SITES, TEMPLATES, CONFIG, ESTADO,
  MOTOR: path.join(CORE, 'motor'),
  UI: path.join(CORE, 'ui'),
  motor: (versao) => path.join(CORE, 'motor', versao),
  site: (id) => path.join(SITES, id),
  siteJson: (id) => path.join(SITES, id, 'site.json'),
  estoque: (id) => path.join(SITES, id, 'estoque.json'),
  assets: (id) => path.join(SITES, id, 'assets'),
  template: (nome) => path.join(TEMPLATES, nome),
  pagina: (nome, arquivo) => path.join(TEMPLATES, nome, 'paginas', arquivo),
  config: (arquivo) => path.join(CONFIG, arquivo),
  saida: (pasta) => path.join(ROOT, pasta),
};
