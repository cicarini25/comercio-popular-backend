const MAPEAMENTO_GERAL_DE_CATEGORIAS = {
  'notebook': 'Notebook',
  'laptop': 'Notebook',
  'macbook': 'Notebook',
  'pc gamer': 'Computadores',
  'computador gamer': 'Computadores',
  'computador completo': 'Computadores',
  'desktop': 'Computadores',
  'cpu gamer': 'Computadores',
  'intel core': 'Computadores',
  'ryzen': 'Computadores',
  'gabinete rgb': 'Computadores',
  'ssd nvme': 'Computadores',
  'memoria ram': 'Computadores',
  'placa de video': 'Computadores',
  'monitor led': 'Computadores',
  'playstation': 'Games',
  'xbox': 'Games',
  'nintendo switch': 'Games',
  'controle gamer': 'Games',
  'smartphone': 'Smartphones',
  'celular': 'Smartphones',
  'iphone': 'Smartphones',
  'carregador de celular': 'Acessórios para celulares',
  'capinha': 'Acessórios para celulares',
  'pelicula': 'Acessórios para celulares',
  'fone bluetooth': 'Fones & Headphones',
  'headset': 'Fones & Headphones',
  'fone de ouvido': 'Fones & Headphones',
  'caixa de som': 'Aparelhos de Som',
  'subwoofer': 'Aparelhos de Som',
  'caixa amplificada': 'Aparelhos de Som',
  'amplificador de audio': 'ELETRÔNICOS',
  'placa amplificadora': 'ELETRÔNICOS',
  'modulo de potencia': 'ELETRÔNICOS',
  'chip de audio': 'ELETRÔNICOS',
  'sensor de contato': 'ELETRÔNICOS',
  'tda7388': 'ELETRÔNICOS',
  'bomba de agua maq': 'ELETRO & ACESSÓRIOS',
  'eletrobomba': 'ELETRO & ACESSÓRIOS',
  'capacitor de microondas': 'ELETRO & ACESSÓRIOS',
  'batedor tanquinho': 'ELETRO & ACESSÓRIOS',
  'espalhador': 'ELETRO & ACESSÓRIOS',
  'queimador': 'ELETRO & ACESSÓRIOS',
  'espalha chama': 'ELETRO & ACESSÓRIOS',
  'kit 4 bocal': 'ELETRO & ACESSÓRIOS',
  'boca de fogao': 'ELETRO & ACESSÓRIOS',
  'boca fogao': 'ELETRO & ACESSÓRIOS',
  'smart tv': 'TVs',
  'televisao': 'TVs',
  'instrumento musical': 'Instrumentos Musicais',
  'violao': 'Instrumentos Musicais',
  'guitarra': 'Instrumentos Musicais',
  'teclado musical': 'Instrumentos Musicais',
  'smartwatch': 'RELÓGIOS',
  'relogio masculino': 'RELÓOIOGS',
  'relogio feminino': 'RELÓGIOS',
  'fogao cooktop': 'Eletrodomésticos',
  'fogao 4 bocas': 'Eletrodomésticos',
  'fogao 5 bocas': 'Eletrodomésticos',
  'maquina de lavar': 'Eletrodomésticos',
  'micro-ondas': 'Eletrodomésticos',
  'guarda-roupa': 'Móveis',
  'comoda': 'Móveis',
  'luminaria': 'LUMINÁRIAS',
  'mochila': 'BOLSAS & MOCHILAS',
  'furadeira': 'Ferramentas',
  'impressora 3d': 'MÁQUINAS & IMPRESSORAS',
  'fio eletrico': 'ELÉTRICA & HIDRÁULICA'
};

export function corrigirCategoriaDoProdutoGeral(produto) {
  if (!produto || !produto.title) return produto;

  const tituloLimpo = produto.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  for (const [termoChave, categoriaCorreta] of Object.entries(MAPEAMENTO_GERAL_DE_CATEGORIAS)) {
    if (tituloLimpo.includes(termoChave)) {
      produto.category = categoriaCorreta;
      return produto;
    }
  }

  return produto;
}

const ACCESSORY_TITLE_PATTERNS = [];
const COMPLETE_APPLIANCE_TITLE_PATTERNS = [];

export { ACCESSORY_TITLE_PATTERNS, COMPLETE_APPLIANCE_TITLE_PATTERNS, MAPEAMENTO_GERAL_DE_CATEGORIAS };
