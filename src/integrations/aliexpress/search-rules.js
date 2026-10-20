import { normalizeText } from "../core/normalizer.js";

/**
 * Pisos de preço são configurações de negócio ajustáveis/estimativas, não uma
 * verdade universal sobre o mercado. Eles são aplicados somente ao preço de
 * venda normalizado e somente quando a moeda informada é BRL.
 *
 * Não encaminhamos esses pisos automaticamente à API: o contrato/unidade de
 * min_sale_price pode variar por operação e target_currency. A validação local
 * continua sendo a barreira final, sem conversão de moeda presumida.
 */
const RULE_DEFINITIONS = [
  {
    key: "pneus",
    intentTerms: ["pneu", "pneus", "tire", "tires", "tyre", "tyres"],
    titleTerms: ["pneu", "pneus", "tire", "tires", "tyre", "tyres"],
    excludedTerms: [
      "reparo",
      "remendo",
      "remendos",
      "reparador",
      "chave de valvula",
      "repair kit"
    ],
    minimumSalePriceBrl: 120,
    description: "Piso configurável/estimativa para pneus no catálogo brasileiro."
  },
  {
    key: "geladeiras",
    intentTerms: [
      "geladeira",
      "geladeiras",
      "refrigerador",
      "refrigeradores",
      "fridge",
      "fridges",
      "refrigerator",
      "refrigerators"
    ],
    titleTerms: [
      "geladeira",
      "geladeiras",
      "refrigerador",
      "refrigeradores",
      "fridge",
      "fridges",
      "refrigerator",
      "refrigerators"
    ],
    excludedTerms: ["adesivo", "ima", "pelicula", "puxador", "capa", "mini", "filter", "filtro"],
    minimumSalePriceBrl: 800,
    description: "Piso configurável/estimativa para geladeiras no catálogo brasileiro."
  },
  {
    key: "brinquedos",
    intentTerms: [
      "brinquedo",
      "brinquedos",
      "toy",
      "toys",
      "boneco",
      "bonecos",
      "action figure",
      "action figures",
      "jogo",
      "jogos"
    ],
    // Além dos sinônimos obrigatórios, os tipos abaixo preservam resultados
    // legítimos já reconhecidos pelo motor existente (puzzles e blocos).
    titleTerms: [
      "brinquedo",
      "brinquedos",
      "toy",
      "toys",
      "boneco",
      "bonecos",
      "action figure",
      "action figures",
      "jogo",
      "jogos",
      "game",
      "games",
      "doll",
      "dolls",
      "building block",
      "building blocks",
      "magnetic block",
      "magnetic blocks",
      "jigsaw puzzle",
      "jigsaw puzzles",
      "puzzle",
      "puzzles",
      "plush",
      "stuffed toy",
      "stuffed toys"
    ],
    excludedTerms: [
      "accessory",
      "accessories",
      "acessorio",
      "acessorios",
      "part",
      "parts",
      "peca",
      "pecas",
      "replacement",
      "spare",
      "compatible",
      "compatibility"
    ],
    minimumSalePriceBrl: 15,
    description: "Piso configurável/estimativa para brinquedos no catálogo brasileiro."
  }
];

function freezeRule(rule) {
  return Object.freeze({
    ...rule,
    intentTerms: Object.freeze([...rule.intentTerms]),
    titleTerms: Object.freeze([...rule.titleTerms]),
    excludedTerms: Object.freeze([...rule.excludedTerms])
  });
}

export const ALIEXPRESS_SEARCH_RULES = Object.freeze(RULE_DEFINITIONS.map(freezeRule));

function tokenizeBoundarySafe(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function containsTerm(tokens, term) {
  const termTokens = tokenizeBoundarySafe(term);
  if (!termTokens.length || termTokens.length > tokens.length) return false;

  for (let start = 0; start <= tokens.length - termTokens.length; start += 1) {
    if (termTokens.every((token, offset) => tokens[start + offset] === token)) return true;
  }
  return false;
}

function containsAnyTerm(tokens, terms) {
  return terms.some((term) => containsTerm(tokens, term));
}

function normalizeCurrency(value) {
  return String(value ?? "").trim().toUpperCase();
}

function getProductCurrency(product) {
  // Prefer the already-normalized currency. Raw API aliases are accepted only
  // as a convenience for unit tests and callers that validate before mapping.
  const candidates = [
    product?.currency,
    product?.target_sale_price_currency,
    product?.app_sale_price_currency,
    product?.sale_price_currency
  ];
  return candidates.map(normalizeCurrency).find(Boolean) || "";
}

function getSalePrice(product) {
  // Deliberately exclude original/list prices. The normalized `price` is first;
  // the remaining fields are sale-price aliases only.
  const candidates = [
    product?.price,
    product?.target_sale_price,
    product?.app_sale_price,
    product?.sale_price
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function getAliExpressSearchRule(keywords = "") {
  const queryTokens = tokenizeBoundarySafe(keywords);
  return ALIEXPRESS_SEARCH_RULES.find((rule) => containsAnyTerm(queryTokens, rule.intentTerms));
}

export function validateAliExpressSearchCandidate(product, keywords = "") {
  const rule = getAliExpressSearchRule(keywords);
  // Unmapped searches must remain exactly as accepted by the existing matcher.
  if (!rule) return { eligible: true, rule: undefined, reason: "unmapped-search" };

  const titleTokens = tokenizeBoundarySafe(product?.title);
  if (!containsAnyTerm(titleTokens, rule.titleTerms)) {
    return { eligible: false, rule, reason: "missing-product-term" };
  }
  if (containsAnyTerm(titleTokens, rule.excludedTerms)) {
    return { eligible: false, rule, reason: "excluded-term" };
  }

  const currency = getProductCurrency(product);
  if (currency !== "BRL") {
    return { eligible: false, rule, reason: "non-brl-currency", currency };
  }

  const salePrice = getSalePrice(product);
  if (salePrice === undefined || salePrice < rule.minimumSalePriceBrl) {
    return {
      eligible: false,
      rule,
      reason: "below-minimum-sale-price",
      salePrice,
      minimumSalePriceBrl: rule.minimumSalePriceBrl
    };
  }

  return {
    eligible: true,
    rule,
    reason: "accepted",
    currency,
    salePrice
  };
}

export function isEligibleByAliExpressSearchRule(product, keywords = "") {
  return validateAliExpressSearchCandidate(product, keywords).eligible;
}

export function filterByAliExpressSearchRule(products, keywords = "") {
  const candidates = Array.isArray(products) ? products : [];
  const relevant = candidates.filter((product) => isEligibleByAliExpressSearchRule(product, keywords));
  return {
    products: relevant,
    receivedCount: candidates.length,
    filteredOut: candidates.length - relevant.length
  };
}
