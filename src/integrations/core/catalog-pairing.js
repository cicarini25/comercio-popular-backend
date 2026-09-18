import pool from "../../db/pool.js";
import { findBestMatches, scoreProductMatch } from "./matcher.js";
import { buildNormalizedProduct, normalizeText, tokenize } from "./normalizer.js";

const DEFAULT_CANDIDATE_LIMIT = 20;
const MAX_PERSISTED_CANDIDATES = 10;

export function buildCatalogCanonicalKey(product) {
  const normalized = buildNormalizedProduct(product);
  const identity = [normalized.brand, normalized.model].filter(Boolean).join("|");
  if (identity) return identity.slice(0, 220);

  return normalizeText(product.title).replace(/\s+/g, "-").slice(0, 220);
}

export async function findCatalogMatchCandidates({
  product,
  excludeProductId,
  limit = DEFAULT_CANDIDATE_LIMIT,
  db = pool
} = {}) {
  const normalized = buildNormalizedProduct(product);
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_CANDIDATE_LIMIT, 1), 50);

  const clauses = ["p.status = 'ativo'", "p.product_kind = 'afiliado'"];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return params.length;
  };

  if (excludeProductId) {
    clauses.push("p.id <> $" + addParam(excludeProductId));
  }

  const identityConditions = [];
  if (normalized.gtin) {
    identityConditions.push("p.ean = $" + addParam(normalized.gtin));
  }

  if (normalized.brand && normalized.model) {
    const brandParam = addParam(normalized.brand);
    const modelParam = addParam(normalized.model);
    identityConditions.push("(p.brand = $" + brandParam + " AND p.model = $" + modelParam + ")");
  } else if (normalized.brand) {
    identityConditions.push("p.brand = $" + addParam(normalized.brand));
  }

  if (normalized.title) {
    const titleParam = addParam(normalized.title);
    identityConditions.push(
      "to_tsvector('simple', COALESCE(p.normalized_title, p.title)) @@ plainto_tsquery('simple', $" + titleParam + ")"
    );
  }

  if (!identityConditions.length) return [];

  clauses.push("(" + identityConditions.join(" OR ") + ")");
  const limitParam = addParam(safeLimit);

  const query = [
    "SELECT p.id, p.title, p.brand, p.ean, p.model, p.category, p.normalized_title, p.metadata",
    "FROM products p",
    "WHERE " + clauses.join(" AND "),
    "ORDER BY p.updated_at DESC",
    "LIMIT $" + limitParam
  ].join(" ");

  const result = await db.query(query, params);
  return result.rows;
}

export function selectCatalogMatch(product, candidateProducts, limit = MAX_PERSISTED_CANDIDATES) {
  const ranked = findBestMatches(product, candidateProducts, limit);
  const automaticMatch = ranked.find(({ match }) => match.decision === "automatico") ?? null;
  const reviewMatch = ranked.find(({ match }) => match.decision === "revisao") ?? null;

  return {
    ranked,
    automaticMatch,
    reviewMatch,
    decision: automaticMatch ? "automatico" : reviewMatch ? "revisao" : "novo"
  };
}

export async function persistMatchCandidates({
  sourceOfferId,
  rankedCandidates,
  db = pool
} = {}) {
  if (!sourceOfferId || !rankedCandidates?.length) return;

  const rows = rankedCandidates.slice(0, MAX_PERSISTED_CANDIDATES);
  const values = [];
  const placeholders = [];

  rows.forEach(({ candidate, match }, index) => {
    const offset = index * 6;
    placeholders.push(
      "($" + (offset + 1) + ", $" + (offset + 2) + ", $" + (offset + 3) + ", $" +
      (offset + 4) + "::jsonb, $" + (offset + 5) + "::jsonb, $" + (offset + 6) + ")"
    );
    values.push(
      sourceOfferId,
      candidate.id,
      match.score,
      JSON.stringify(match.basis),
      JSON.stringify(match.contradictions),
      match.decision
    );
  });

  const query = [
    "INSERT INTO product_match_candidates (source_offer_id, candidate_product_id, score, match_basis, contradictions, decision)",
    "VALUES " + placeholders.join(", "),
    "ON CONFLICT (source_offer_id, candidate_product_id) DO UPDATE SET",
    "score = EXCLUDED.score,",
    "match_basis = EXCLUDED.match_basis,",
    "contradictions = EXCLUDED.contradictions,",
    "decision = EXCLUDED.decision,",
    "reviewed_at = NULL"
  ].join(" ");

  await db.query(query, values);
}

export function buildCandidateSummary(product, candidateProducts) {
  return candidateProducts.map((candidate) => ({
    candidate,
    match: scoreProductMatch(product, candidate)
  }));
}

export function hasEnoughIdentity(product) {
  const normalized = buildNormalizedProduct(product);
  return Boolean(
    normalized.gtin ||
    (normalized.brand && normalized.model) ||
    tokenize(normalized.title).length >= 2
  );
}
