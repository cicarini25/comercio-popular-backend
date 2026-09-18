export { MarketplaceConnector } from "./core/connector.js";
export {
  AUTO_MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  findBestMatches,
  scoreProductMatch
} from "./core/matcher.js";
export {
  buildNormalizedProduct,
  normalizeBrand,
  normalizeCompactText,
  normalizeGtin,
  normalizeModel,
  normalizeText,
  tokenize
} from "./core/normalizer.js";
export {
  buildCandidateSummary,
  buildCatalogCanonicalKey,
  findCatalogMatchCandidates,
  hasEnoughIdentity,
  persistMatchCandidates,
  selectCatalogMatch
} from "./core/catalog-pairing.js";
export { MercadoLivreConnector } from "./mercadolivre/client.js";
export { ShopeeAffiliateConnector } from "./shopee/client.js";
