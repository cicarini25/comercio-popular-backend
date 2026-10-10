const SITE_CATEGORIES = [
  'Utilidades', 'Casa & Cozinha', 'Ferramentas', 'Eletrodomésticos',
  'ELETRO & ACESSÓRIOS', 'Móveis', 'ELETRÔNICOS', 'RELÓGIOS', 'Games',
  'Computadores', 'Notebook', 'Smartphones', 'Acessórios para celulares',
  'Aparelhos de Som', 'Fones & Headphones', 'Instrumentos Musicais',
  'AUTO & ACESSÓRIOS', 'MOTOS & ACESSÓRIOS', 'Pets', 'Moda Masculina',
  'Moda Feminina', 'Moda Infantil', 'ARMARINHOS & TRICÔ', 'Brinquedos',
  'TVs', 'Calçados', 'Esportes & Lazer', 'Bike Elétrica e Acessórios',
  'Cuidado & Beleza', 'Alimentos & Bebidas'
];

const normalizeKey = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const canonicalCategories = new Map(SITE_CATEGORIES.map((category) => [normalizeKey(category), category]));
const categoryAliases = new Map(Object.entries({
  'armarinhos': 'ARMARINHOS & TRICÔ',
  'trico': 'ARMARINHOS & TRICÔ',
  'automotivo': 'AUTO & ACESSÓRIOS',
  'automotiva': 'AUTO & ACESSÓRIOS',
  'automotive': 'AUTO & ACESSÓRIOS',
  'automotive accessories': 'AUTO & ACESSÓRIOS',
  'car accessories': 'AUTO & ACESSÓRIOS',
  'auto parts': 'AUTO & ACESSÓRIOS',
  'car parts': 'AUTO & ACESSÓRIOS',
  'motorcycle': 'MOTOS & ACESSÓRIOS',
  'motorcycles': 'MOTOS & ACESSÓRIOS',
  'motorcycle accessories': 'MOTOS & ACESSÓRIOS',
  'motorcycle parts': 'MOTOS & ACESSÓRIOS',
  'motorbike': 'MOTOS & ACESSÓRIOS',
  'motorbike accessories': 'MOTOS & ACESSÓRIOS',
  'moto pecas': 'MOTOS & ACESSÓRIOS',
  'pecas de moto': 'MOTOS & ACESSÓRIOS',
  'motos e acessorios': 'MOTOS & ACESSÓRIOS',
  'electronics': 'ELETRÔNICOS',
  'consumer electronics': 'ELETRÔNICOS',
  'home kitchen': 'Casa & Cozinha',
  'kitchen dining': 'Casa & Cozinha',
  'kitchenware': 'Casa & Cozinha',
  'home appliances': 'Eletrodomésticos',
  'appliances': 'Eletrodomésticos',
  'furniture': 'Móveis',
  'sports outdoors': 'Esportes & Lazer',
  'sports recreation': 'Esportes & Lazer',
  'toys': 'Brinquedos',
  'toys and games': 'Brinquedos',
  'games consoles': 'Games',
  'video games': 'Games',
  'computers accessories': 'Computadores',
  'computer accessories': 'Computadores',
  'laptops': 'Notebook',
  'laptop': 'Notebook',
  'mobile phones': 'Smartphones',
  'cell phones': 'Smartphones',
  'phone accessories': 'Acessórios para celulares',
  'mobile phone accessories': 'Acessórios para celulares',
  'audio equipment': 'Aparelhos de Som',
  'headphones': 'Fones & Headphones',
  'earphones': 'Fones & Headphones',
  'women clothes': 'Moda Feminina',
  'womens clothing': 'Moda Feminina',
  'men clothes': 'Moda Masculina',
  'mens clothing': 'Moda Masculina',
  'baby kids fashion': 'Moda Infantil',
  'pets animals': 'Pets',
  'pet supplies': 'Pets',
  'musical instruments': 'Instrumentos Musicais',
  'shoes': 'Calçados',
  'footwear': 'Calçados',
  'beauty personal care': 'Cuidado & Beleza',
  'personal care': 'Cuidado & Beleza',
  'food beverage': 'Alimentos & Bebidas',
  'food beverages': 'Alimentos & Bebidas',
  'groceries': 'Alimentos & Bebidas',
  'household supplies': 'Utilidades',
  'home organization': 'Utilidades',
  'automobiles': 'AUTO & ACESSÓRIOS',
  'car': 'AUTO & ACESSÓRIOS',
  'cars': 'AUTO & ACESSÓRIOS',
  'other': 'Utilidades',
  'others': 'Utilidades'
}).map(([key, category]) => [normalizeKey(key), category]));

function mapRawCategory(rawCategory) {
  const raw = String(rawCategory ?? '').trim();
  if (!raw) return undefined;
  const key = normalizeKey(raw);
  const direct = canonicalCategories.get(key) || categoryAliases.get(key);
  if (direct) return direct;
  const parts = raw.split(/[>/|:]+/).map(normalizeKey).filter(Boolean).reverse();
  for (const part of parts) {
    const mapped = canonicalCategories.get(part) || categoryAliases.get(part);
    if (mapped) return mapped;
  }
  return undefined;
}

function inferCategoryFromText(title, description = '') {
  const text = normalizeKey(String(title ?? '') + ' ' + String(description ?? ''));

  if (/(motorcycle|motorbike|motocross|motociclet|motociclista|motoqueir|pecas? de moto|moto pecas|acessorios? de moto|acessorios? para moto|capacete.{0,30}(moto|motocicl)|bauleto|bau.{0,15}moto|carenagem|retrovisor.{0,20}moto|manete.{0,20}moto|corrente.{0,20}moto|pneu.{0,20}moto|pastilha.{0,20}moto|protetor de motor|escapamento.{0,20}moto|luvas? (de|para) motociclista|jaqueta.{0,20}moto|guid(ao|on).{0,20}moto|\b(cg|biz|titan|bros|factor|fazer|xre|pcx|nmax)\b)/.test(text) || /(^| )moto( |$)/.test(text)) {
    return 'MOTOS & ACESSÓRIOS';
  }
  if (/(automotivo|automotiva|carro|veicular|veiculo|radiador|carroceria|parachoque|para choque|cambio automotivo|peca automotiva|acessorio automotivo|tapete automotivo|capa para carro|som automotivo|bateria automotiva|oleo de motor|retrovisor de carro|pneu de carro|farol automotivo|car accessories|auto parts)/.test(text)) {
    return 'AUTO & ACESSÓRIOS';
  }
  if (/(bicicleta eletrica|bike eletrica|ebike|e bike|scooter eletrica|patinete eletrico|bateria.{0,30}(bicicleta|bike|scooter)|motor.{0,25}(bicicleta|bike eletrica|scooter)|acessorio.{0,30}(bicicleta|bike eletrica))/.test(text)) {
    return 'Bike Elétrica e Acessórios';
  }
  if (/(brinqued|toys?|bonec|lego|pelucia|quebra cabeca|massinha de modelar|playset|carrinho infantil|miniatura de brinquedo)/.test(text)) return 'Brinquedos';
  if (/(racao|racoes|coleira|peitoral para cachorro|arranhador|areia higienica|petisco|cachorro|cachorros|gato|gatos|animal de estimacao|produto pet)/.test(text)) return 'Pets';
  if (/(violao|guitarra|violino|ukulele|cavaquinho|teclado musical|piano|bateria musical|saxofone|flauta|instrumento musical|pedal de guitarra)/.test(text)) return 'Instrumentos Musicais';
  if (/(moda infantil|roupa infantil|roupas infantis|vestido infantil|conjunto infantil|roupa de bebe|roupas de bebe|kids clothing|baby clothing)/.test(text)) return 'Moda Infantil';
  if (/(roupa masculina|camiseta masculina|camisa masculina|bermuda masculina|cueca masculina|moda masculina|mens clothing|men clothing)/.test(text)) return 'Moda Masculina';
  if (/(roupa feminina|vestido feminino|blusa feminina|bolsa feminina|lingerie|moda feminina|womens clothing|women clothing)/.test(text)) return 'Moda Feminina';
  if (/(smart ?tv|televisao|televisor|(^| )tv( |$))/.test(text)) return 'TVs';
  if (/(notebook|laptop|chromebook)/.test(text)) return 'Notebook';
  if (/(computador|desktop|pc gamer|placa mae|placa de video|memoria ram|monitor para computador|mouse gamer|teclado mecanico)/.test(text)) return 'Computadores';
  if (/(smartphone|celular|iphone|android phone|samsung galaxy|xiaomi redmi|motorola edge)/.test(text)) return 'Smartphones';
  if (/(capa para celular|capinha|pelicula para celular|carregador de celular|acessorio para celular|suporte para celular)/.test(text)) return 'Acessórios para celulares';
  if (/(fone de ouvido|headphone|headset|earbud|earphone|tws)/.test(text)) return 'Fones & Headphones';
  if (/(caixa de som|soundbar|alto falante|amplificador de audio|receiver|home theater|microfone|radio portatil)/.test(text)) return 'Aparelhos de Som';
  if (/(playstation|xbox|nintendo|videogame|video game|console gamer|joystick|controle gamer)/.test(text)) return 'Games';
  if (/(geladeira|refrigerador|fogao|microondas|micro ondas|lava roupa|lavadora|air fryer|ar condicionado|cafeteira eletrica|sanduicheira|liquidificador|batedeira|aspirador (de )?po|aspirador vertical|aspirador robo|maquina de lavar|secadora de roupas)/.test(text)) return 'Eletrodomésticos';
  if (/(sofa|mesa de jantar|cadeira|armario|estante|cama|colchao|guarda roupa|comoda|escrivaninha|rack para tv)/.test(text)) return 'Móveis';
  if (/(panela|frigideira|prato|talher|utensilio de cozinha|cozinha|garrafa termica|cafeteira|chaleira|jarra para cafeteira|tacas?|copos?|faqueiros?|pote hermetico)/.test(text)) return 'Casa & Cozinha';
  if (/(furadeira|parafusadeira|kit ferramentas|ferramenta|chave de fenda|alicate|martelo|trena|broca|material de construcao|torneira|tinta|jardinagem)/.test(text)) return 'Ferramentas';
  if (/(tenis|sandalia|sapato|chinelo|chuteira|bota|calcado|mocassim)/.test(text)) return 'Calçados';
  if (/(academia|halter|esteira|bicicleta|camping|barraca|esporte|fitness|bola de futebol|raquete|pesca|natacao)/.test(text)) return 'Esportes & Lazer';
  if (/(maquiagem|cosmetico|skincare|perfume|hidratante|beleza|manicure|unhas?|esmalte|gel uv|pinceis|protetor solar)/.test(text)) return 'Cuidado & Beleza';
  if (/(cafe|cha|alimento|bebida|suplemento|chocolate|mantimento|arroz|feijao|azeite)/.test(text)) return 'Alimentos & Bebidas';
  if (/(organizadores?|selador|limpeza|armazenamento|odorizante|aromatizante|difusor de aromas|antimofo|desumidificador)/.test(text)) return 'Utilidades';

  return undefined;
}

export function normalizeShopeeSiteCategory(value) {
  return mapRawCategory(value);
}

export function resolveShopeeSiteCategory({
  category,
  title = '',
  description = '',
  categoryOverride,
  currentCategory
} = {}) {
  // A clear product title wins over a broad or incorrectly selected import category.
  const titleCategory = inferCategoryFromText(title, '');
  if (titleCategory) return titleCategory;

  const sourceCategory = mapRawCategory(category);
  if (sourceCategory) return sourceCategory;

  const descriptionCategory = inferCategoryFromText('', description);
  if (descriptionCategory) return descriptionCategory;

  return mapRawCategory(categoryOverride) || mapRawCategory(currentCategory);
}

export function getShopeeSuggestedCategorySignals({ category, title = '', description = '' } = {}) {
  const suggested = resolveShopeeSiteCategory({ category, title, description });
  const inferredFromTitle = Boolean(inferCategoryFromText(title, ''));
  const mappedFromFeed = Boolean(mapRawCategory(category));
  const inferredFromDescription = Boolean(inferCategoryFromText('', description));
  return { suggested, inferredFromTitle, mappedFromFeed, inferredFromDescription };
}
