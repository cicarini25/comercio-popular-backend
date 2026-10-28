export const SITE_CATEGORY_TREE = [
  { department: 'Casa, cozinha e organização', categories: ['Casa & Cozinha', 'CAMA/MESA/BANHO', 'Móveis', 'LUMINÁRIAS', 'BOLSAS & MOCHILAS'] },
  { department: 'Construção, elétrica e ferramentas', categories: ['ELÉTRICA & HIDRÁULICA', 'Ferramentas', 'MÁQUINAS & IMPRESSORAS'] },
  { department: 'Eletrodomésticos', categories: ['Eletrodomésticos', 'ELETRO & ACESSÓRIOS'] },
  { department: 'Tecnologia e eletrônicos', categories: ['ELETRÔNICOS', 'RELÓGIOS', 'Games', 'Informática', 'Smartphones', 'Acessórios para celulares', 'Aparelhos de Som', 'Fones & Headphones', 'Instrumentos Musicais', 'TVs'] },
  { department: 'Veículos e mobilidade', categories: ['AUTO & ACESSÓRIOS', 'MOTOS & ACESSÓRIOS', 'Bike Elétrica e Acessórios'] },
  { department: 'Moda e acessórios', categories: ['MODA VERÃO PRAIA', 'Moda Masculina', 'Moda Feminina', 'CALÇADOS INFANTIS M/F', 'MODA INFANTIL FEMININA', 'MODA INFANTIL MASCULINA', 'ARMARINHOS & TRICÔ', 'Calçados Masculino', 'Calçados Femininos'] },
  { department: 'Lazer, cuidado e consumo', categories: ['Brinquedos', 'Esportes & Lazer', 'Pets', 'Cuidado & Beleza', 'Alimentos & Bebidas', 'Outros'] }
];

export const SITE_CATEGORIES = SITE_CATEGORY_TREE.flatMap(({ categories }) => categories);

const normalizeKey = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const canonicalCategories = new Map(SITE_CATEGORIES.map((category) => [normalizeKey(category), category]));
const categoryAliases = new Map(Object.entries({
  'utilidades': 'Casa & Cozinha',
  'computadores': 'Informática',
  'notebook': 'Informática',
  'computers': 'Informática',
  'cama mesa e banho': 'CAMA/MESA/BANHO',
  'cama mesa banho': 'CAMA/MESA/BANHO',
  'moda praia': 'MODA VERÃO PRAIA',
  'moda verao e praia': 'MODA VERÃO PRAIA',
  'armarinhos': 'ARMARINHOS & TRICÔ',

  'calcados infantis': 'CALÇADOS INFANTIS M/F',
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
  'home living': 'Casa & Cozinha',
  'home decor': 'Casa & Cozinha',
  'home and living': 'Casa & Cozinha',
  'home living kitchen': 'Casa & Cozinha',
  'casa e cozinha': 'Casa & Cozinha',
  'casa e cozinhas': 'Casa & Cozinha',
  'casa cozinhas': 'Casa & Cozinha',
  'kitchen': 'Casa & Cozinha',
  'household goods': 'Casa & Cozinha',
  'household supplies': 'Casa & Cozinha',
  'home organization': 'Casa & Cozinha',
  'utilidades domesticas': 'Casa & Cozinha',
  'electrical appliances': 'Eletrodomésticos',
  'appliance parts': 'ELETRO & ACESSÓRIOS',
  'electro accessories': 'ELETRO & ACESSÓRIOS',
  'eletro e acessorios': 'ELETRO & ACESSÓRIOS',
  'home improvement': 'Ferramentas',
  'home kitchen': 'Casa & Cozinha',
  'kitchen dining': 'Casa & Cozinha',
  'kitchenware': 'Casa & Cozinha',
  'home appliances': 'Eletrodomésticos',
  'appliances': 'Eletrodomésticos',
  'furniture': 'Móveis',
  'sports outdoors': 'Esportes & Lazer',
  'sports recreation': 'Esportes & Lazer',
  'toy': 'Brinquedos',
  'toys': 'Brinquedos',
  'toys and games': 'Brinquedos',
  'toy hobby': 'Brinquedos',
  'toys hobbies': 'Brinquedos',
  'toys and hobbies': 'Brinquedos',
  'dolls and stuffed toys': 'Brinquedos',
  'games consoles': 'Games',
  'video games': 'Games',
  'computers accessories': 'Informática',
  'computer accessories': 'Informática',
  'laptops': 'Informática',
  'laptop': 'Informática',
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

  'pets animals': 'Pets',
  'pet supplies': 'Pets',
  'musical instruments': 'Instrumentos Musicais',
  'calcados': 'Calçados Masculino',
  'calcados masculinos': 'Calçados Masculino',
  'calcados femininos': 'Calçados Femininos',
  'men shoes': 'Calçados Masculino',
  'mens shoes': 'Calçados Masculino',
  'women shoes': 'Calçados Femininos',
  'womens shoes': 'Calçados Femininos',
  'shoes': 'Calçados Masculino',
  'footwear': 'Calçados Masculino',
  'beauty personal care': 'Cuidado & Beleza',
  'personal care': 'Cuidado & Beleza',
  'food beverage': 'Alimentos & Bebidas',
  'food beverages': 'Alimentos & Bebidas',
  'groceries': 'Alimentos & Bebidas',
  'automobiles': 'AUTO & ACESSÓRIOS',
  'car': 'AUTO & ACESSÓRIOS',
  'cars': 'AUTO & ACESSÓRIOS',
  'electrical plumbing': 'ELÉTRICA & HIDRÁULICA',
  'electrical and plumbing': 'ELÉTRICA & HIDRÁULICA',
  'lighting': 'LUMINÁRIAS',
  'lighting fixtures': 'LUMINÁRIAS',
  'lamps': 'LUMINÁRIAS',
  'bags backpacks': 'BOLSAS & MOCHILAS',
  'handbags backpacks': 'BOLSAS & MOCHILAS'
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
  const titleKey = normalizeKey(String(title ?? ''));
  const text = normalizeKey(String(title ?? '') + ' ' + String(description ?? ''));

  // Motorola's Moto phone models must not be mistaken for motorcycles.
  const isPhoneModel = /(motorola|iphone|smartphone|celular|\bphone\b|samsung|galaxy|xiaomi|redmi|poco|\bmoto ?[gexzc](?:[0-9]|\b))/.test(text);
  const isPhoneAccessory = /(pelicula|screen protector|protetor (de )?tela|capinha|\bcapa\b|phone case|carregador|charger|cabo|cable|power bank|suporte para celular|phone holder)/.test(text);
  if (isPhoneModel && isPhoneAccessory) return 'Acessórios para celulares';

  if (/(motorcycle|motorbike|motocross|motociclet|motociclista|motoqueir|pecas? de moto|moto pecas|acessorios? de moto|acessorios? para moto|capacete.{0,30}(moto|motocicl)|bauleto|bau.{0,15}moto|carenagem|retrovisor.{0,20}moto|manete.{0,20}moto|corrente.{0,20}moto|pneu.{0,20}moto|pastilha.{0,20}moto|protetor de motor|escapamento.{0,20}moto|luvas? (de|para) motociclista|jaqueta.{0,20}moto|guid(ao|on).{0,20}moto|\b(cg|biz|titan|bros|factor|fazer|xre|pcx|nmax)\b)/.test(text) || /(^| )motos?( |$)/.test(text)) {
    return 'MOTOS & ACESSÓRIOS';
  }
  if (/(automotivo|automotiva|carro|veicular|veiculo|radiador|carroceria|parachoque|para choque|cambio automotivo|peca automotiva|acessorio automotivo|tapete automotivo|capa para carro|som automotivo|bateria automotiva|oleo de motor|retrovisor de carro|pneu de carro|farol automotivo|car accessories|auto parts)/.test(text)) {
    return 'AUTO & ACESSÓRIOS';
  }
  if (/(bicicleta eletrica|bike eletrica|ebike|e bike|scooter eletrica|patinete eletrico|bateria.{0,30}(bicicleta|bike|scooter)|motor.{0,25}(bicicleta|bike eletrica|scooter)|acessorio.{0,30}(bicicleta|bike eletrica))/.test(text)) {
    return 'Bike Elétrica e Acessórios';
  }
  const appliancePattern = /(geladeira|refrigerador|refrigerator|fridge|fogao|stove|microondas|micro ondas|lava roupa|lavadora|lava loucas|air.?fryer|fritadeira eletrica|fritadeira a ar|ar condicionado|cafeteira eletrica|sanduicheira|liquidificador|batedeira|aspirador (de )?po|aspirador vertical|aspirador robo|maquina de lavar|secadora de roupas|forno eletrico|panela eletrica|freezer|ventilador|purificador de agua)/;
  const hasAppliance = appliancePattern.test(text);
  const accessoryHead = /^(kit |pecas? |acessorios? |filtro |filter |reparo |reposicao |replacement |spare part |capa |cover |organizador |organizer |silicone |forro |liner |bandeja |cesto |grade |grelha |termostato |sensor |bomba |valvula |motor |placa |resistencia |cabo |mangueira |dobradica |adaptador |controle )/;
  const applianceIsPrimary = appliancePattern.test(titleKey) && !accessoryHead.test(titleKey);
  const hasAppliancePart = /(accessor(?:y|ies)|replacement|spare part|parts? for|pecas? (de|para)|reposicao|reparo|liner|capa|cover|case|filtro|filter|silicone|organizador|organizer|protector|protetor|bandeja|cesto|grade|grelha|termostato|sensor|bomba|valvula|motor|placa|resistencia|cabo|mangueira|dobradica|adaptador|controle|refil)/.test(text);
  const isHouseholdOrganizer = /(organizador|organizer|liner|capa|cover|case|silicone|forro)/.test(text);
  if (applianceIsPrimary) return 'Eletrodomésticos';
  if (hasAppliance && hasAppliancePart && isHouseholdOrganizer) return 'Casa & Cozinha';
  if (hasAppliance && hasAppliancePart) return 'ELETRO & ACESSÓRIOS';
  if (/(hidraul|plumbing|tubulacao|tubos? de agua|conexao hidraulica|fio eletrico|cabos? eletricos?|cabo usb|usb cable|\bwires?\b|\bcables?\b|tomadas?|outlets?|sockets?|soquetes?|disjuntores?|interruptores?|switches?|lamp holder|lamp socket|doorbell|campainha|faucets?|torneiras?|\bpipes?\b|eletrica residencial)/.test(text)) return 'ELÉTRICA & HIDRÁULICA';
  if (/(luminaria|luminarias|lighting fixture|lighting fixtures|light fixture|light fixtures|light bulb|light bulbs|\bbulbs?\b|\blamps?\b|lampada|lampadas|ceiling light|wall lamp|desk lamp|floor lamp|pendant light|chandelier|lustre|arandela|plafon|downlight|spotlight)/.test(text)) return 'LUMINÁRIAS';
  if (/(bolsa|bolsas|handbag|handbags|backpack|backpacks|mochila|mochilas|rucksack|tote bag|purse)/.test(text)) return 'BOLSAS & MOCHILAS';
  if (/(brinqued|toys?|bonec|lego|plush|stuffed (animal|toy)s?|doll(?:house)?s?|action figures?|building blocks?|magnetic blocks?|construction blocks?|jigsaw puzzles?|puzzles?|quebra cabeca|massinha de modelar|playset|carrinho infantil|miniatura de brinquedo|board games?|educational toys?|pretend play|remote control (toys?|cars?)|rc cars?|model kits|toy cars?|toy vehicles?|baby toys?|rattles?|teethers?)/.test(text)) return 'Brinquedos';
  if (/(racao|racoes|coleira|peitoral para cachorro|arranhador|areia higienica|petisco|cachorro|cachorros|gato|gatos|animal de estimacao|produto pet)/.test(text)) return 'Pets';
  if (/(violao|guitarra|violino|ukulele|cavaquinho|teclado musical|piano|bateria musical|saxofone|flauta|instrumento musical|pedal de guitarra)/.test(text)) return 'Instrumentos Musicais';
  const childAudience = /\b(infantil|infantis|bebe|bebes|crianca|criancas|kids|children|child|baby|menino|meninos|menina|meninas|boys?|girls?)\b/.test(titleKey);
  const childFootwear = /\b(tenis|sapatos?|sandalias?|chinelos?|botas?|sapatilhas?|calcados?|chuteiras?|tamancos?|sapatinhos?)\b/.test(titleKey);
  if (childAudience && childFootwear) return 'CALÇADOS INFANTIS M/F';
  if (/(moda infantil|roupa infantil|roupas infantis|vestido infantil|conjunto infantil|roupa de bebe|roupas de bebe|kids clothing|baby clothing)/.test(text)) {
    if (/\b(menino|meninos|masculino|boys?|boy)\b/.test(text)) return 'MODA INFANTIL MASCULINA';
    if (/\b(menina|meninas|feminino|girls?|girl)\b/.test(text)) return 'MODA INFANTIL FEMININA';
    return 'Outros';
  }
  if (/(roupa masculina|camiseta masculina|camisa masculina|bermuda masculina|cueca masculina|moda masculina|mens clothing|men clothing)/.test(text)) return 'Moda Masculina';
  if (/(roupa feminina|vestido feminino|blusa feminina|bolsa feminina|lingerie|moda feminina|womens clothing|women clothing)/.test(text)) return 'Moda Feminina';
  if (/(smart ?tv|televisao|televisor|(^| )tv( |$))/.test(text)) return 'TVs';
  if (/(notebook|laptop|chromebook)/.test(text)) return 'Informática';
  if (/(linha(s)?|fio(s)?|carretel|bobina).{0,45}(bord(ar|ado)|bordadeira)|bord(ar|ado).{0,45}(linha|fio|carretel|bobina)/.test(text)) return 'ARMARINHOS & TRICÔ';
  if (/(impressora|multifuncional|impressao|impressora termica|etiquetadora|rotuladora|plotter|sublimacao|prensa termica|maquina de corte|cortadora|encadernadora|laminadora|plastificadora|bordadeira|maquina de bordado|costura industrial)/.test(text)) return 'MÁQUINAS & IMPRESSORAS';
  // Acessórios de informática também ficam em Informática, mesmo quando o
  // feed os envia na categoria ampla de eletrônicos. Evita usar termos
  // genéricos como "monitor" sem indicar uso em computador.
  if (/(computador|desktop|pc gamer|placa mae|placa de video|memoria ram|processador (intel|amd|ryzen)|ssd nvme|gabinete gamer|monitor para (computador|pc)|monitor gamer|mouse gamer|mouse para jogos|teclado (mecanico|gamer)|webcam para pc|adaptador bluetooth para pc)/.test(text)) return 'Informática';
  if (/(smartphone|celular|iphone|android phone|samsung galaxy|xiaomi redmi|motorola edge)/.test(text)) return 'Smartphones';
  if (/(capa para celular|capinha|pelicula para celular|carregador de celular|acessorio para celular|suporte para celular)/.test(text)) return 'Acessórios para celulares';
  if (/(fone de ouvido|headphone|headset|earbud|earphone|tws)/.test(text)) return 'Fones & Headphones';
  if (/(caixa de som|soundbar|alto falante|amplificador de audio|receiver|home theater|microfone|radio portatil)/.test(text)) return 'Aparelhos de Som';
  if (/(playstation|xbox|nintendo|videogame|video game|console gamer|joystick|controle gamer)/.test(text)) return 'Games';
  if (/(tapetes?.{0,35}(banheiro|banho|box|chuveiro|sala)|toalhas?.{0,35}(banho|banheiro|rosto|mesa|prato)|roupao|jogo de cama|lencol|fronha|edredom|colcha|capa de colchao|caminho de mesa|guardanapo de tecido|pano de prato)/.test(text)) return 'CAMA/MESA/BANHO';
  if (/(sofa|mesa de jantar|dining table|\btable\b|cadeira|chair|armario|estante|cama|colchao|guarda roupa|comoda|escrivaninha|rack para tv)/.test(text)) return 'Móveis';
  if (/(panela|frigideira|prato|talher|utensilio de cozinha|garrafa termica|cafeteira|chaleira|jarra para cafeteira|tacas?|copos?|faqueiros?|pote hermetico|forma de bolo|tabua de corte|porta tempero|organizador.{0,25}temperos?|temperos?.{0,25}organizador|kit de cozinha)/.test(text)) return 'Casa & Cozinha';
  if (/(utensilios? de cozinha|cozinha)/.test(text)) return 'Casa & Cozinha';
  if (/(furadeira|parafusadeira|kit ferramentas|ferramenta|chave de fenda|alicate|martelo|trena|broca|material de construcao|torneira|tinta|jardinagem)/.test(text)) return 'Ferramentas';
  if (/\b(tenis|sandalias?|sapatos?|chinelos?|chuteiras?|botas?|botinas?|calcados?|mocassim|mocassins|sapatilhas?|sapatenis|coturnos?|tamancos?|scarpin)\b/.test(text)) {
    if (/\b(infantil|infantis|bebe|crianca|kids|meninas?|meninos?)\b/.test(text)) return 'CALÇADOS INFANTIS M/F';
    const feminine = /\b(feminin[oa]s?|mulheres?|women|womens|scarpin|slingback)\b/.test(text);
    const masculine = /\b(masculin[oa]s?|homem|homens|men|mens|unissex|unisex)\b/.test(text);
    return feminine && !masculine ? 'Calçados Femininos' : 'Calçados Masculino';
  }
  if (/(academia|halter|esteira|bicicleta|camping|barraca|esporte|fitness|bola de futebol|raquete|pesca|natacao)/.test(text)) return 'Esportes & Lazer';
  if (/(maquiagem|cosmetico|skincare|perfume|hidratante|beleza|manicure|unhas?|esmalte|gel uv|pinceis|protetor solar)/.test(text)) return 'Cuidado & Beleza';
  if (/\b(cafe|cha|alimento|bebida|suplemento|chocolate|mantimento|arroz|feijao|azeite)\b/.test(text)) return 'Alimentos & Bebidas';
  if (/(organizadores?|selador|limpeza|armazenamento|odorizante|aromatizante|difusor de aromas|antimofo|desumidificador)/.test(text)) return 'Casa & Cozinha';

  return undefined;
}

export function normalizeSiteCategory(value) {
  return mapRawCategory(value) || 'Outros';
}

export function inferSiteCategoryFromText(value = '') {
  return inferCategoryFromText(value, '');
}

export function classifySiteProduct(options = {}) {
  return resolveSiteCategory(options);
}

export const normalizeShopeeSiteCategory = normalizeSiteCategory;

export function resolveSiteCategory({
  category,
  title = '',
  description = '',
  categoryOverride,
  currentCategory
} = {}) {
  const explicitOverride = mapRawCategory(categoryOverride);
  if (explicitOverride) return explicitOverride;
  const selectedNewCategory = mapRawCategory(category);
  if (selectedNewCategory === 'MODA VERÃO PRAIA') return selectedNewCategory;
  const declaredFootwear = [categoryOverride, category].find((value) =>
    ['calcados masculino', 'calcados masculinos', 'calcados femininos', 'men shoes', 'mens shoes', 'women shoes', 'womens shoes'].includes(normalizeKey(value))
  );
  const selectedFootwear = mapRawCategory(declaredFootwear);
  // A clear product title wins over a broad or incorrectly selected import category.
  const titleCategory = inferCategoryFromText(title, '');
  if (titleCategory) return titleCategory;
  if (selectedFootwear === 'Calçados Masculino' || selectedFootwear === 'Calçados Femininos') {
    return selectedFootwear;
  }

  const sourceCategory = mapRawCategory(category);
  if (sourceCategory) return sourceCategory;

  const descriptionCategory = inferCategoryFromText('', description);
  if (descriptionCategory) return descriptionCategory;

  return mapRawCategory(categoryOverride) || mapRawCategory(currentCategory) || 'Outros';
}

export const resolveShopeeSiteCategory = resolveSiteCategory;

export function getShopeeSuggestedCategorySignals({ category, title = '', description = '' } = {}) {
  const suggested = resolveShopeeSiteCategory({ category, title, description });
  const inferredFromTitle = Boolean(inferCategoryFromText(title, ''));
  const mappedFromFeed = Boolean(mapRawCategory(category));
  const inferredFromDescription = Boolean(inferCategoryFromText('', description));
  return { suggested, inferredFromTitle, mappedFromFeed, inferredFromDescription };
}




