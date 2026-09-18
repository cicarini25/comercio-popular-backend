import { buildNormalizedProduct, normalizeCompactText, tokenize } from "./normalizer.js";

export const AUTO_MATCH_THRESHOLD = 0.92;
export const REVIEW_THRESHOLD = 0.75;

export function scoreProductMatch(sourceProduct, candidateProduct) {
  const source = buildNormalizedProduct(sourceProduct);
  const candidate = buildNormalizedProduct(candidateProduct);

  const basis = [];
  const contradictions = [];

  if (source.gtin && candidate.gtin) {
    if (source.gtin === candidate.gtin) basis.push("gtin_exact");
    else contradictions.push("gtin_conflict");
  }

  if (source.brand && candidate.brand) {
    if (source.brand === candidate.brand) basis.push("brand_exact");
    else contradictions.push("brand_conflict");
  }

  if (source.model && candidate.model) {
    if (source.model === candidate.model) basis.push("model_exact");
    else if (source.model.includes(candidate.model) || candidate.model.includes(source.model)) basis.push("model_contains");
    else contradictions.push("model_conflict");
  }

  if (source.category && candidate.category) {
    if (source.category === candidate.category) basis.push("category_exact");
    else if (source.category.includes(candidate.category) || candidate.category.includes(source.category)) basis.push("category_related");
  }

  const titleSimilarity = jaccardSimilarity(tokenize(source.title), tokenize(candidate.title));
  const attributeSimilarity = attributeSimilarityScore(source.attributes, candidate.attributes);

  if (titleSimilarity >= 0.8) basis.push("title_strong");
  else if (titleSimilarity >= 0.6) basis.push("title_good");
  else if (titleSimilarity >= 0.4) basis.push("title_partial");

  if (attributeSimilarity >= 0.8) basis.push("attributes_strong");
  else if (attributeSimilarity >= 0.6) basis.push("attributes_good");

  let score = 0;

  if (source.gtin && candidate.gtin && source.gtin === candidate.gtin) {
    score = 1;
  } else {
    if (source.brand && candidate.brand && source.brand === candidate.brand) score += 0.20;
    if (source.model && candidate.model && source.model === candidate.model) score += 0.40;
    else if (source.model && candidate.model && basis.includes("model_contains")) score += 0.22;

    score += Math.min(0.30, titleSimilarity * 0.30);
    score += Math.min(0.15, attributeSimilarity * 0.15);

    if (basis.includes("category_exact")) score += 0.08;
    else if (basis.includes("category_related")) score += 0.04;

    if (contradictions.includes("brand_conflict")) score -= 0.25;
    if (contradictions.includes("model_conflict")) score -= 0.30;
    if (contradictions.includes("gtin_conflict")) score = Math.min(score, 0.25);

    score = Math.max(0, Math.min(0.99, score));
  }

  const strongIdentity =
    basis.includes("gtin_exact") ||
    (basis.includes("brand_exact") && basis.includes("model_exact"));

  let decision = "rejeitar";
  if (strongIdentity || score >= AUTO_MATCH_THRESHOLD) decision = "automatico";
  else if (score >= REVIEW_THRESHOLD) decision = "revisao";

  return {
    score: Number(score.toFixed(4)),
    decision,
    basis,
    contradictions,
    titleSimilarity: Number(titleSimilarity.toFixed(4)),
    attributeSimilarity: Number(attributeSimilarity.toFixed(4))
  };
}

export function findBestMatches(sourceProduct, candidateProducts, limit = 10) {
  return candidateProducts
    .map((candidate) => ({ candidate, match: scoreProductMatch(sourceProduct, candidate) }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

function jaccardSimilarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;

  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function attributeSimilarityScore(left = {}, right = {}) {
  const keys = Object.keys(left).filter((key) => key in right);
  if (!keys.length) return 0;

  let matches = 0;
  for (const key of keys) {
    if (normalizeCompactText(left[key]) === normalizeCompactText(right[key])) matches += 1;
  }

  return matches / keys.length;
}
