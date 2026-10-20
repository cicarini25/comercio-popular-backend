import { normalizeText, tokenize } from "../core/normalizer.js";

const STOP_WORDS = new Set([
  "a", "as", "ao", "aos", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "para", "por", "um", "uma", "the", "and", "for", "with"
]);

// Portuguese search words are translated for the AliExpress query and retained
// as aliases when matching the localized product titles returned by the API.
const WORDS = {
  azul: { en: "blue", match: ["azul", "blue"] },
  branco: { en: "white", match: ["branco", "branca", "white"] },
  cadeira: { en: "chair", match: ["cadeira", "chair", "chairs", "seat", "seats"] },
  cadeiras: { en: "chairs", match: ["cadeira", "cadeiras", "chair", "chairs", "seat", "seats"] },
  cama: { en: "bed", match: ["cama", "bed"] },
  camas: { en: "beds", match: ["camas", "beds"] },
  camisa: { en: "shirt", match: ["camisa", "shirt"] },
  camiseta: { en: "t shirt", match: ["camiseta", "camisetas", "t shirt", "tshirt"] },
  camisetas: { en: "t shirts", match: ["camiseta", "camisetas", "t shirt", "t shirts", "tshirt"] },
  calca: { en: "pants", match: ["calca", "calcas", "pants", "trousers"] },
  calcas: { en: "pants", match: ["calca", "calcas", "pants", "trousers"] },
  cachorro: { en: "dog", match: ["cachorro", "dog"] },
  capa: { en: "cover", match: ["capa", "cover", "case"] },
  carro: { en: "car", match: ["carro", "carros", "car", "cars", "automotive"] },
  carros: { en: "cars", match: ["carro", "carros", "car", "cars", "automotive"] },
  casa: { en: "home", match: ["casa", "home", "house"] },
  celular: { en: "phone", match: ["celular", "telefone", "phone", "smartphone", "mobile"] },
  celulares: { en: "phones", match: ["celular", "telefone", "phone", "smartphone", "mobile"] },
  chuveiro: { en: "shower", match: ["chuveiro", "shower"] },
  cobertor: { en: "blanket", match: ["cobertor", "blanket"] },
  colchao: { en: "mattress", match: ["colchao", "mattress"] },
  computador: { en: "computer", match: ["computador", "computers", "computer", "pc"] },
  computadores: { en: "computers", match: ["computador", "computers", "computer", "pc"] },
  controle: { en: "controller", match: ["controle", "controller", "gamepad"] },
  cozinha: { en: "kitchen", match: ["cozinha", "kitchen"] },
  cortina: { en: "curtain", match: ["cortina", "curtain"] },
  crianca: { en: "child", match: ["crianca", "infantil", "child", "kids"] },
  criancas: { en: "children", match: ["criancas", "infantis", "children", "kids"] },
  eletrica: { en: "electrical", match: ["eletrica", "electrical", "electric"] },
  eletrico: { en: "electric", match: ["eletrico", "eletrica", "electric"] },
  eletricos: { en: "electric", match: ["eletricos", "electric"] },
  eletronico: { en: "electronic", match: ["eletronico", "electronic", "electronics"] },
  eletronicos: { en: "electronics", match: ["eletronicos", "electronic", "electronics"] },
  ferramenta: { en: "tool", match: ["ferramenta", "tool"] },
  ferramentas: { en: "tools", match: ["ferramentas", "tool", "tools"] },
  fone: { en: "headphone", match: ["fone", "headphone", "earphone", "earbud"] },
  fones: { en: "headphones", match: ["fones", "headphones", "earphones", "earbuds"] },
  fogao: { en: "stove", match: ["fogao", "stove", "cooktop"] },
  geladeira: { en: "refrigerator", match: ["geladeira", "refrigerator", "fridge"] },
  jogo: { en: "game", match: ["jogo", "game"] },
  jogos: { en: "games", match: ["jogos", "games", "gaming"] },
  lampada: { en: "bulb", match: ["lampada", "bulb", "light bulb"] },
  lampadas: { en: "bulbs", match: ["lampadas", "bulbs", "light bulbs"] },
  lixeira: { en: "trash can", match: ["lixeira", "trash can", "trash bin", "waste bin", "garbage can"] },
  liquidificador: { en: "blender", match: ["liquidificador", "blender"] },
  mochila: { en: "backpack", match: ["mochila", "backpack", "rucksack"] },
  mochilas: { en: "backpacks", match: ["mochilas", "backpacks", "rucksacks"] },
  monitor: { en: "monitor", match: ["monitor", "display"] },
  mouse: { en: "mouse", match: ["mouse", "computer mouse"] },
  microondas: { en: "microwave", match: ["microondas", "microwave"] },
  oculos: { en: "glasses", match: ["oculos", "glasses", "eyewear"] },
  panela: { en: "cooking pot", match: ["panela", "pot", "cookware"] },
  pet: { en: "pet", match: ["pet", "animal"] },
  pets: { en: "pet supplies", match: ["pet", "pets", "animal"] },
  preto: { en: "black", match: ["preto", "preta", "black"] },
  rosa: { en: "pink", match: ["rosa", "pink"] },
  roxo: { en: "purple", match: ["roxo", "roxa", "purple"] },
  saia: { en: "skirt", match: ["saia", "skirt"] },
  sapato: { en: "shoe", match: ["sapato", "sapatos", "shoe", "shoes"] },
  sapatos: { en: "shoes", match: ["sapato", "sapatos", "shoe", "shoes"] },
  shorts: { en: "shorts", match: ["shorts", "short pant"] },
  tenis: { en: "sneakers", match: ["tenis", "sneaker", "sneakers", "trainers"] },
  toalha: { en: "towel", match: ["toalha", "towel"] },
  toalhas: { en: "towels", match: ["toalhas", "towels"] },
  torneira: { en: "faucet", match: ["torneira", "faucet", "tap"] },
  torneiras: { en: "faucets", match: ["torneiras", "faucets", "taps"] },
  vestido: { en: "dress", match: ["vestido", "dress"] },
  vestidos: { en: "dresses", match: ["vestidos", "dresses"] },
  vermelho: { en: "red", match: ["vermelho", "vermelha", "red"] },
  verde: { en: "green", match: ["verde", "green"] },
  ventilador: { en: "fan", match: ["ventilador", "fan"] },
  alimento: { en: "food", match: ["alimento", "alimentos", "food"] },
  alimentos: { en: "food", match: ["alimento", "alimentos", "food"] },
  bebida: { en: "drink", match: ["bebida", "bebidas", "drink", "beverage"] },
  bebidas: { en: "drinks", match: ["bebida", "bebidas", "drinks", "beverages"] },
  brinquedo: { en: "toy", match: ["brinquedo", "toy"] },
  brinquedos: { en: "toys", match: ["brinquedos", "toys"] },
  boneca: { en: "doll", match: ["boneca", "doll"] },
  bonecas: { en: "dolls", match: ["bonecas", "dolls"] },
  bolsa: { en: "handbag", match: ["bolsa", "handbag", "purse", "tote bag"] },
  bolsas: { en: "handbags", match: ["bolsas", "bags", "handbags", "purses", "tote bags"] },
  bicicleta: { en: "bicycle", match: ["bicicleta", "bicycle", "bike"] },
  bicicletas: { en: "bicycles", match: ["bicicletas", "bicycles", "bikes"] },
  bota: { en: "boot", match: ["bota", "boot"] },
  botas: { en: "boots", match: ["botas", "boots"] },
  esporte: { en: "sport", match: ["esporte", "sports"] },
  esportes: { en: "sports", match: ["esportes", "sports"] },
  luminaria: { en: "lighting fixture", match: ["luminaria", "luminarias", "lamp", "light", "lighting", "luminaire"] },
  luminarias: { en: "lighting fixtures", match: ["luminarias", "lamp", "lamps", "light", "lights", "lighting", "luminaire"] },
  moveis: { en: "furniture", match: ["moveis", "furniture"] },
  masculino: { en: "men", match: ["masculino", "masculina", "men", "mens", "male"] },
  masculina: { en: "men", match: ["masculino", "masculina", "men", "mens", "male"] },
  femininos: { en: "women", match: ["feminino", "feminina", "women", "womens", "female"] },
  feminina: { en: "women", match: ["feminino", "feminina", "women", "womens", "female"] },
  infantil: { en: "kids", match: ["infantil", "kids", "children", "child"] },
  infantis: { en: "kids", match: ["infantis", "kids", "children"] },
  notebook: { en: "laptop", match: ["notebook", "laptop"] },
  notebooks: { en: "laptops", match: ["notebooks", "laptops"] },
  impressora: { en: "printer", match: ["impressora", "printer"] },
  impressoras: { en: "printers", match: ["impressoras", "printers"] },
  relogio: { en: "watch", match: ["relogio", "watch"] },
  relogios: { en: "watches", match: ["relogios", "watches"] },
  televisao: { en: "television", match: ["televisao", "tv", "television"] },
  televisoes: { en: "televisions", match: ["televisoes", "tvs", "televisions"] },
  moto: { en: "motorcycle", match: ["moto", "motocicleta", "motorcycle", "motorbike"] },
  motos: { en: "motorcycles", match: ["motos", "motocicletas", "motorcycles", "motorbikes"] },
  automotivo: { en: "automotive", match: ["automotivo", "automotivos", "automotive", "car", "vehicle"] },
  automotivos: { en: "automotive", match: ["automotivo", "automotivos", "automotive", "car", "vehicle"] },
  cabo: { en: "cable", match: ["cabo", "cable"] },
  cabos: { en: "cables", match: ["cabos", "cables"] },
  fio: { en: "wire", match: ["fio", "wire"] },
  fios: { en: "wires", match: ["fios", "wires"] },
  tomada: { en: "outlet", match: ["tomada", "outlet", "socket"] },
  tomadas: { en: "outlets", match: ["tomadas", "outlets", "sockets"] },
  interruptor: { en: "switch", match: ["interruptor", "switch"] },
  interruptores: { en: "switches", match: ["interruptores", "switches"] },
  carregador: { en: "charger", match: ["carregador", "charger"] },
  carregadores: { en: "chargers", match: ["carregadores", "chargers"] },
  utilidade: { en: "household", match: ["utilidade", "household", "home"] },
  utilidades: { en: "household", match: ["utilidades", "household", "home"] },
  beleza: { en: "beauty", match: ["beleza", "beauty"] },
  praia: { en: "beach", match: ["praia", "beach"] },
  verao: { en: "summer", match: ["verao", "summer"] },
  instrumento: { en: "instrument", match: ["instrumento", "instrument"] },
  instrumentos: { en: "instruments", match: ["instrumentos", "instruments"] },
  musical: { en: "musical", match: ["musical", "music"] },
  musicais: { en: "musical", match: ["musicais", "musical", "music"] },
  som: { en: "audio", match: ["som", "audio", "sound"] },
  jantar: { en: "dining", match: ["jantar", "dining"] },
  mesa: { en: "table", match: ["mesa", "table"] },
  mesas: { en: "tables", match: ["mesas", "tables"] },
  pressao: { en: "pressure", match: ["pressao", "pressure"] },
  chuva: { en: "rain", match: ["chuva", "rain"] },
  escolar: { en: "school", match: ["escolar", "school"] },
  viagem: { en: "travel", match: ["viagem", "travel"] },
  ombro: { en: "shoulder", match: ["ombro", "shoulder"] }
};

WORDS.gamer = { en: "gaming", match: ["gamer", "gaming"] };

const CATEGORY_HINTS = {
  "utilidades": "household",
  "eletrica hidraulica": "electrical plumbing",
  "luminarias": "lighting fixtures",
  "bolsas mochilas": "handbags backpacks",
  "casa cozinha": "home kitchen",
  "cama mesa banho": "bedding towels bath",
  "moda verao praia": "beachwear swimwear",
  "ferramentas": "tools",
  "maquinas impressoras": "machines printers",
  "eletrodomesticos": "home appliances",
  "eletro acessorios": "appliance parts",
  "moveis": "furniture",
  "eletronicos": "electronics",
  "relogios": "watches",
  "games": "video games",
  "computadores": "computers",
  "notebook": "laptops",
  "smartphones": "smartphones",
  "acessorios para celulares": "phone accessories",
  "aparelhos de som": "audio speakers",
  "fones headphones": "headphones earphones",
  "instrumentos musicais": "musical instruments",
  "auto acessorios": "automotive",
  "motos acessorios": "motorcycles",
  "pets": "pet supplies",
  "moda masculina": "men clothing",
  "moda feminina": "women clothing",
  "calcados infantis m f": "kids shoes",
  "moda infantil feminina": "girls clothing",
  "moda infantil masculina": "boys clothing",
  "armarinhos trico": "sewing knitting",
  "brinquedos": "toys",
  "tvs": "televisions",
  "calcados masculino": "men shoes",
  "calcados femininos": "women shoes",
  "esportes lazer": "sports outdoors",
  "bike eletrica e acessorios": "electric bicycles",
  "cuidado beleza": "beauty personal care",
  "alimentos bebidas": "food beverages"
};

const TIRE_PRODUCT_TERMS = ["pneu", "pneus", "tire", "tires", "tyre", "tyres"];
const TIRE_ACCESSORY_TERMS = [
  "adaptador", "adaptadores", "adapter", "adaptor", "bico", "bicos", "nozzle", "valvula", "valve", "valve stem",
  "caneta", "medicao", "medidor", "gauge", "pressure", "pressao", "calibrador", "inflator", "inflation",
  "sensor", "tpms", "repair kit", "patch", "plug", "puncture", "pino de roda", "wheel stud", "wheel bolt", "lug nut", "parafuso de roda"
];

const LIGHTING_PRODUCT_TERMS = [
  "luminaria", "luminarias", "luminaire", "luminaires", "lamp", "lamps", "lampada", "lampadas", "light", "lights", "lighting", "luz", "luzes", "chandelier", "lustre", "pendant", "sconce", "spotlight", "downlight", "lantern"
];
const LIGHTING_STRONG_FIXTURE_TERMS = [
  "luminaria", "luminarias", "luminaire", "luminaires", "desk lamp", "table lamp", "floor lamp", "ceiling lamp", "ceiling light", "wall lamp", "wall light", "pendant light", "chandelier", "sconce", "night light", "spotlight", "downlight", "strip light", "panel light", "light fixture", "lighting fixture", "lantern"
];
const LIGHTING_ACCESSORY_TERMS = [
  "socket", "soquete", "casquilho", "holder", "lamp holder", "bulb holder", "switch", "interruptor", "light switch", "cable", "cabo", "wire", "adaptador", "adapter", "connector", "conector", "doorbell", "campainha", "bell", "driver", "transformer", "replacement", "lamp base"
];
const LIGHTING_HARD_ACCESSORY_TERMS = [
  "socket", "soquete", "casquilho", "holder", "lamp holder", "bulb holder", "doorbell", "campainha", "bell", "driver", "transformer", "replacement"
];

const DINING_ACCESSORY_TERMS = ["table cover", "dining table cover", "tablecloth", "table cloth", "table runner", "placemat", "table mat", "table protector"];
const BAG_PRODUCT_TERMS = ["bolsa", "bolsas", "bag", "bags", "handbag", "handbags", "purse", "purses", "tote bag", "backpack", "backpacks", "rucksack", "rucksacks"];
const BAG_ACCESSORY_TERMS = ["bag strap", "shoulder strap", "alca", "alcas", "bag charm", "chaveiro", "bag organizer", "bag insert", "bag buckle", "replacement strap"];

function includesPhrase(text, phrase) {
  const normalizedText = normalizeText(text);
  const normalizedPhrase = normalizeText(phrase);
  return Boolean(normalizedPhrase) && (` ${normalizedText} `).includes(` ${normalizedPhrase} `);
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => includesPhrase(text, phrase));
}

function queryTokens(keywords) {
  return tokenize(keywords).filter((token) => !STOP_WORDS.has(token));
}

function translateGenericKeywords(keywords) {
  const translated = queryTokens(keywords).map((token) => WORDS[token]?.en ?? token).filter(Boolean);
  return translated.join(" ") || String(keywords ?? "").trim();
}

function resolveIntent(keywords, siteCategory = "") {
  const tokens = new Set(queryTokens(keywords));
  const category = normalizeText(siteCategory);
  if (["pneu", "pneus", "tire", "tires", "tyre", "tyres"].some((token) => tokens.has(token))) return "tires";
  if (["luminaria", "luminarias", "lamp", "lamps", "lighting", "luminaire", "luminaires"].some((token) => tokens.has(token))) return "lighting";
  if ((tokens.has("mesa") || tokens.has("table")) && (tokens.has("jantar") || tokens.has("dining"))) return "dining-table";
  if (["bolsa", "bolsas", "mochila", "mochilas", "bag", "bags", "backpack", "backpacks"].some((token) => tokens.has(token)) || category === "bolsas mochilas") return "bags";
  return "generic";
}

function resolveTireVehicle(keywords, siteCategory = "") {
  const tokens = new Set(queryTokens(keywords));
  const category = normalizeText(siteCategory);
  if (["bicicleta", "bicicletas", "bike", "bikes", "bicycle", "bicycles", "mtb"].some((token) => tokens.has(token))) return "bicycle";
  if (["moto", "motos", "motocicleta", "motocicletas", "motorcycle", "motorcycles", "motorbike", "scooter"].some((token) => tokens.has(token))) return "motorcycle";
  if (["automotivo", "automotivos", "carro", "carros", "auto", "car", "cars", "automotive", "automovel", "automoveis"].some((token) => tokens.has(token))) return "car";
  if (category === "bike eletrica e acessorios") return "bicycle";
  if (category === "motos acessorios") return "motorcycle";
  if (category === "auto acessorios") return "car";
  return "any";
}

export function buildAliExpressKeywords(keywords, siteCategory = "") {
  const original = String(keywords ?? "").trim();
  const normalized = normalizeText(original);
  const intent = resolveIntent(original, siteCategory);
  const tokens = new Set(tokenize(normalized));

  if (intent === "tires") {
    const vehicle = resolveTireVehicle(original, siteCategory);
    if (vehicle === "bicycle") return "bicycle tire";
    if (vehicle === "motorcycle") return "motorcycle tire";
    if (vehicle === "car") return "car tire";
    return "tire";
  }

  if (intent === "lighting") {
    if (tokens.has("mesa")) return "table lamp";
    if (["teto", "plafon", "forro"].some((token) => tokens.has(token))) return "ceiling light";
    if (["parede", "arandela"].some((token) => tokens.has(token))) return "wall lamp";
    if (tokens.has("pendente")) return "pendant light";
    if (["lustre", "candelabro"].some((token) => tokens.has(token))) return "chandelier";
    if (["piso", "chao"].some((token) => tokens.has(token))) return "floor lamp";
    return "lighting fixture";
  }

  if (intent === "dining-table") return "dining table";
  if (intent === "bags") {
    const hasBag = ["bolsa", "bolsas", "bag", "bags"].some((token) => tokens.has(token));
    const hasBackpack = ["mochila", "mochilas", "backpack", "backpacks"].some((token) => tokens.has(token));
    const base = hasBag && hasBackpack ? "handbag backpack" : hasBackpack ? "backpack" : "handbag";
    const modifiers = queryTokens(original)
      .filter((token) => !["bolsa", "bolsas", "mochila", "mochilas", "bag", "bags", "backpack", "backpacks"].includes(token))
      .map((token) => WORDS[token]?.en ?? token);
    return [base, ...modifiers].join(" ");
  }

  return translateGenericKeywords(original);
}

function hasPassengerCarTireSize(title) {
  return /\b(?:1[4-9]\d|[2-3]\d{2})\s*\/\s*\d{2}\s*r\s*\d{2}\b/i.test(String(title ?? ""));
}

function isRelevantTireProduct(product, title, keywords, siteCategory) {
  if (!includesAny(title, TIRE_PRODUCT_TERMS) || includesAny(title, TIRE_ACCESSORY_TERMS)) return false;

  const allText = normalizeText(`${title} ${product?.category ?? ""}`);
  const vehicle = resolveTireVehicle(keywords, siteCategory);
  const isMotorcycle = includesAny(allText, ["motorcycle", "motorcycles", "motorbike", "moto", "motos", "motocicleta", "scooter", "scooters"]);
  const isBicycle = includesAny(allText, ["bicycle", "bicycles", "bike", "bikes", "bicicleta", "bicicletas", "mtb", "mountain bike", "road bike", "e bike"]);
  const isCar = includesAny(allText, ["car", "cars", "carro", "carros", "automotive", "automotivo", "automotivos", "automovel", "automoveis", "suv", "sedan", "passenger car"]) || hasPassengerCarTireSize(title);

  if (vehicle === "car") return isCar && !isMotorcycle && !isBicycle;
  if (vehicle === "motorcycle") return isMotorcycle && !isCar && !isBicycle;
  if (vehicle === "bicycle") return isBicycle && !isCar && !isMotorcycle;
  return true;
}

function isRelevantLightingProduct(title) {
  if (!includesAny(title, LIGHTING_PRODUCT_TERMS)) return false;
  const hasStrongFixture = includesAny(title, LIGHTING_STRONG_FIXTURE_TERMS);
  const hasAccessory = includesAny(title, LIGHTING_ACCESSORY_TERMS);
  const hasHardAccessory = includesAny(title, LIGHTING_HARD_ACCESSORY_TERMS);
  if (hasHardAccessory) return false;
  return !hasAccessory || hasStrongFixture;
}

function getTokenMatches(token, title) {
  const alternatives = WORDS[token]?.match ?? [token];
  return includesAny(title, alternatives);
}

export function isRelevantAliExpressProduct(product, keywords, siteCategory = "") {
  const title = String(product?.title ?? "");
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return false;

  const intent = resolveIntent(keywords, siteCategory);
  if (intent === "tires") return isRelevantTireProduct(product, title, keywords, siteCategory);
  if (intent === "lighting") return isRelevantLightingProduct(normalizedTitle);

  if (intent === "dining-table") {
    const hasTable = includesAny(normalizedTitle, ["mesa", "table"]);
    const hasDining = includesAny(normalizedTitle, ["jantar", "dining"]);
    return hasTable && hasDining && !includesAny(normalizedTitle, DINING_ACCESSORY_TERMS);
  }

  if (intent === "bags") {
    if (!includesAny(normalizedTitle, BAG_PRODUCT_TERMS)) return false;
    const hasAccessory = includesAny(normalizedTitle, BAG_ACCESSORY_TERMS);
    const isReplacementPart = includesAny(normalizedTitle, ["replacement", "replacement strap", "strap only"]);
    if (hasAccessory || isReplacementPart) return false;
    const modifiers = queryTokens(keywords).filter((token) => !["bolsa", "bolsas", "mochila", "mochilas", "bag", "bags", "backpack", "backpacks"].includes(token));
    return modifiers.every((token) => getTokenMatches(token, normalizedTitle));
  }

  const tokens = queryTokens(keywords);
  if (!tokens.length) return true;
  const matchedGroups = tokens.filter((token) => getTokenMatches(token, normalizedTitle)).length;
  const requiredMatches = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6);
  return matchedGroups >= requiredMatches;
}

export function filterRelevantAliExpressProducts(products, keywords, siteCategory = "") {
  const relevant = products.filter((product) => isRelevantAliExpressProduct(product, keywords, siteCategory));
  return {
    products: relevant,
    receivedCount: products.length,
    filteredOut: products.length - relevant.length
  };
}
