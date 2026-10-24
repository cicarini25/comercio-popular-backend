export const ACCESSORY_TITLE_PATTERNS = [
  '%espalhador%', '%queimador%', '%espalha chama%', '%kit 4 bocal%', 
  '%boca de fogao%', '%boca fogao%', '%kit de bacias%', '%resistencia de%',
  '%mangueira de%', '%filtro de%', '%bomba de agua maq%', '%eletrobomba%',
  '%capacitor de microondas%', '%batedor tanquinho%'
];

export const COMPLETE_APPLIANCE_TITLE_PATTERNS = [
  '%fogao cooktop%', '%fogao 4 bocas%', '%fogao 5 bocas%', '%geladeira%',
  '%refrigerador%', '%maquina de lavar%', '%lava e seca%', '%micro-ondas%',
  '%fritadeira eletrica%', '%airfryer%'
];

export const MAPEAMENTO_GERAL_DE_CATEGORIAS = {
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
  'monitor led': 'Computadores'
};

export function corrigirCategoriaDoProdutoGeral(produto) {
  if (!produto || !produto.title) return produto;
  const t = produto.title.toLowerCase();
  for (const [k, v] of Object.entries(MAPEAMENTO_GERAL_DE_CATEGORIAS)) {
    if (t.includes(k)) {
      produto.category = v;
      return produto;
    }
  }
  return produto;
}
