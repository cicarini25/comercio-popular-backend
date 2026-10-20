import { normalizeText, tokenize } from "./normalizer.js";
import { SITE_CATEGORY_TREE, classifySiteProduct, inferSiteCategoryFromText, normalizeSiteCategory } from "./site-category-resolver.js";

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

WORDS.pneu = { en: "tire", match: ["pneu", "pneus", "tire", "tires", "tyre", "tyres"] };
WORDS.pneus = WORDS.pneu;
WORDS.geladeiras = WORDS.geladeira;
WORDS.airfryer = { en: "air fryer", match: ["air fryer", "fritadeira eletrica", "fritadeira a ar"] };
WORDS.fritadeira = { en: "air fryer", match: ["air fryer", "fritadeira", "fritadeira eletrica", "fritadeira a ar"] };
WORDS.fryer = { en: "fryer", match: ["fryer", "air fryer", "fritadeira", "fritadeira eletrica", "fritadeira a ar"] };
WORDS.eletrodomesticos = { en: "home appliances", match: ["eletrodomesticos", "appliances", "home appliances"] };


const PRODUCT_ACCESSORY_CUES = [
  "accessory", "accessories", "acessorio", "acessorios", "part", "parts", "peca", "pecas",
  "replacement", "spare", "compatible", "compatibility", "cover", "capa", "case", "capinha", "liner",
  "filter", "filtro", "holder", "suporte", "stand", "mount", "strap", "alca", "attachment",
  "adapter", "adaptador", "cable", "cabo", "cord", "corrente", "chain", "valve", "valvula",
  "sticker", "adesivo", "decal", "gauge", "medidor", "tool", "ferramenta", "weight", "peso",
  "bolt", "parafuso", "screw", "porca", "rivet", "rebite", "organizer", "organizador", "magnet", "ima", "tampa"
];

const PHRASE_ALIASES = {
  "air fryer": ["air fryer", "fritadeira eletrica", "fritadeira a ar"],
  "fritadeira eletrica": ["air fryer", "fritadeira eletrica", "fritadeira a ar"],
  "fritadeira a ar": ["air fryer", "fritadeira eletrica", "fritadeira a ar"],
  "pneus": ["tire", "tyre"],
  "pneus automotivos": ["car tire", "tire automotive"],
  "pneus de moto": ["motorcycle tire", "tire motorcycle"],
  "pneus de bicicleta": ["bicycle tire", "tire bicycle"],
  "mesa de jantar": ["dining table", "table dining"]
};

function phraseInText(text, phrase) {
  const normalizedText = ` ${normalizeText(text)} `;
  const normalizedPhrase = normalizeText(phrase);
  return Boolean(normalizedPhrase) && normalizedText.includes(` ${normalizedPhrase} `);
}

function editDistance(left, right) {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function isAdjacentTransposition(left, right) {
  if (left.length !== right.length) return false;
  const mismatches = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) mismatches.push(index);
  }
  return mismatches.length === 2 && mismatches[1] === mismatches[0] + 1 &&
    left[mismatches[0]] === right[mismatches[1]] && left[mismatches[1]] === right[mismatches[0]];
}

function hasKnownDictionaryWord(token) {
  return Boolean(WORDS[token]);
}

function closestTransposedDictionaryWord(token) {
  return Object.keys(WORDS).find((candidate) => isAdjacentTransposition(token, candidate));
}

function tokenSimilarity(queryToken, titleToken) {
  if (queryToken === titleToken) return 1;
  if (queryToken.replace(/s$/, "") === titleToken.replace(/s$/, "")) return 1;
  if (Math.min(queryToken.length, titleToken.length) < 5) return 0;
  const cueWord = PRODUCT_ACCESSORY_CUES.some((cue) => {
    const tokens = tokenize(cue);
    return tokens.length === 1 && tokens[0].replace(/s$/, "") === queryToken.replace(/s$/, "");
  });
  if (cueWord && !hasKnownDictionaryWord(queryToken)) return 0;
  return editDistance(queryToken, titleToken) <= 1 || isAdjacentTransposition(queryToken, titleToken) ? 0.82 : 0;
}

function queryGroups(keywords) {
  return tokenize(keywords)
    .filter((token) => !STOP_WORDS.has(token))
    .map((token) => {
      const dictionaryKey = WORDS[token] ? token : closestTransposedDictionaryWord(token);
      const entry = WORDS[dictionaryKey];
      return [...new Set([token, ...(entry?.match ?? [])].flatMap((value) => tokenize(value)))];
    })
    .filter((group) => group.length);
}

function groupMatch(group, titleTokens) {
  let best = { score: 0, position: Number.POSITIVE_INFINITY };
  for (const queryToken of group) {
    titleTokens.forEach((titleToken, position) => {
      const score = tokenSimilarity(queryToken, titleToken);
      if (score > best.score) best = { score, position };
    });
  }
  return best;
}

function exactPhraseScore(keywords, title) {
  const normalizedQuery = normalizeText(keywords);
  const alternatives = PHRASE_ALIASES[normalizedQuery] ?? [];
  return alternatives.some((phrase) => phraseInText(title, phrase)) ? 1 : 0;
}

function queryMentionsAccessoryCue(keywords) {
  const expanded = new Set(queryGroups(keywords).flat());
  return PRODUCT_ACCESSORY_CUES.some((cue) => tokenize(cue).some((token) => expanded.has(token)));
}

function isAccessoryOnlyCandidate(title, keywords) {
  const normalizedTitle = normalizeText(title);
  const titleTokens = tokenize(normalizedTitle);
  const queryTerms = new Set(queryGroups(keywords).flat());
  const unrelatedCue = PRODUCT_ACCESSORY_CUES.some((cue) => {
    const cueTokens = tokenize(cue);
    if (cueTokens.some((token) => queryTerms.has(token))) return false;
    if (phraseInText(normalizedTitle, cue)) return true;
    if (cueTokens.length !== 1) return false;
    const cueRoot = cueTokens[0].replace(/s$/, "");
    return titleTokens.some((titleToken) => titleToken.replace(/s$/, "") === cueRoot);
  });
  if (unrelatedCue) return true;

  const queryGroupList = queryGroups(keywords);
  const matchPositions = queryGroupList.map((group) => groupMatch(group, titleTokens));
  const allMatched = matchPositions.length > 0 && matchPositions.every((match) => match.score > 0);
  if (!allMatched) return false;
  const firstQueryPosition = Math.min(...matchPositions.map((match) => match.position));
  if (firstQueryPosition > 5) return true;

  const relationMarker = /\b(?:for|para|compatible with|compativel com|pecas? de|acessorios? para)\b/g;
  for (const relation of normalizedTitle.matchAll(relationMarker)) {
    const suffix = normalizedTitle.slice(relation.index + relation[0].length);
    if (queryGroupList.every((group) => groupMatch(group, tokenize(suffix)).score > 0)) return true;
  }
  return false;
}

export function buildAliExpressKeywords(keywords) {
  const original = String(keywords ?? "").trim();
  if (!original) return "";
  const normalized = normalizeText(original);
  const phraseAlias = PHRASE_ALIASES[normalized];
  if (phraseAlias) return phraseAlias[0];
  const translated = tokenize(normalized)
    .filter((token) => !STOP_WORDS.has(token))
    .map((token) => {
      const dictionaryKey = WORDS[token] ? token : closestTransposedDictionaryWord(token);
      return WORDS[dictionaryKey]?.en ?? token;
    });
  return translated.join(" ") || original;
}

export function resolveSearchCategory(keywords, selectedCategory = "") {
  return inferSiteCategoryFromText(keywords) || normalizeSiteCategory(selectedCategory);
}

export function scoreProductTitleMatch(product, keywords, selectedCategory = "") {
  const title = String(product?.title ?? "");
  const titleTokens = tokenize(title);
  const groups = queryGroups(keywords);
  if (!titleTokens.length || !groups.length) return { score: 0, accepted: false, category: undefined };

  const phraseScore = exactPhraseScore(keywords, title);
  const matches = groups.map((group) => groupMatch(group, titleTokens));
  const coverage = matches.filter((match) => match.score > 0).length / groups.length;
  const fuzzyScore = matches.reduce((sum, match) => sum + match.score, 0) / groups.length;
  const textSimilarity = Math.max(phraseScore, coverage === 1 ? fuzzyScore : 0);
  const requestedCategory = resolveSearchCategory(keywords, selectedCategory);
  const categoryOnlyQuery = Boolean(requestedCategory && normalizeSiteCategory(keywords) === requestedCategory);
  const productCategory = classifySiteProduct({ category: product?.category, title });
  const categoryOnlyMatch = categoryOnlyQuery && productCategory === requestedCategory;
  const similarity = categoryOnlyQuery ? (categoryOnlyMatch ? 1 : 0) : textSimilarity;
  const categoryCompatible = !requestedCategory || !productCategory || requestedCategory === productCategory;
  const accessoryOnly = !queryMentionsAccessoryCue(keywords) && isAccessoryOnlyCandidate(title, keywords);
  const firstPosition = Math.min(...matches.map((match) => match.position));
  const headCompatible = phraseScore > 0 || firstPosition <= 5;
  const accepted = categoryOnlyQuery
    ? categoryOnlyMatch && !accessoryOnly
    : similarity >= 0.78 && categoryCompatible && !accessoryOnly && headCompatible;

  return {
    score: Number(similarity.toFixed(3)),
    accepted,
    category: productCategory,
    requestedCategory,
    categoryOnlyQuery,
    categoryCompatible,
    accessoryOnly
  };
}

export function isRelevantAliExpressProduct(product, keywords, siteCategory = "") {
  return scoreProductTitleMatch(product, keywords, siteCategory).accepted;
}

export function filterRelevantAliExpressProducts(products, keywords, siteCategory = "") {
  const relevant = products.filter((product) => isRelevantAliExpressProduct(product, keywords, siteCategory));
  return {
    products: relevant,
    receivedCount: products.length,
    filteredOut: products.length - relevant.length
  };
}

export { SITE_CATEGORY_TREE };
