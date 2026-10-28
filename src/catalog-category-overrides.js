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
  'notebook': 'Informática',
  'laptop': 'Informática',
  'macbook': 'Informática',
  'pc gamer': 'Informática',
  'computador gamer': 'Informática',
  'computador completo': 'Informática',
  'desktop': 'Informática',
  'cpu gamer': 'Informática',
  'intel core': 'Informática',
  'ryzen': 'Informática',
  'gabinete rgb': 'Informática',
  'ssd nvme': 'Informática',
  'memoria ram': 'Informática',
  'placa de video': 'Informática',
  'monitor led': 'Informática'
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

