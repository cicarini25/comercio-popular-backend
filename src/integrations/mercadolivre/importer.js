import pool from "../../db/pool.js";
import { MercadoLivreConnector } from "./client.js";
import { buildNormalizedProduct } from "../core/normalizer.js";
import { getMercadoLivreAccessToken } from "./oauth.js";
import {
  buildCatalogCanonicalKey,
  findCatalogMatchCandidates,
  hasEnoughIdentity,
  persistMatchCandidates,
  selectCatalogMatch
} from "../core/catalog-pairing.js";

const MAX_INPUT_ITEMS = 1000;

export function extractMercadoLivreItemId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;

  if (/^MLB\d+$/i.test(raw)) return raw.toUpperCase();

  try {
    const url = new URL(raw);
    if (url.hostname !== "www.mercadolivre.com.br" && url.hostname !== "mercadolivre.com.br") {
      return undefined;
    }

    const queryId =
      url.searchParams.get("wid") ||
      url.searchParams.get("item_id") ||
      url.searchParams.get("itemId");

    const filterMatch = url.searchParams.get("pdp_filters")?.match(/(?:^|:)item_id:(MLB\d+)/i);
    const pathMatch = url.pathname.match(/(MLB\d+)/i);

    return (queryId || filterMatch?.[1] || pathMatch?.[1])?.toUpperCase();
  } catch {
    return raw.match(/(MLB\d+)/i)?.[1]?.toUpperCase();
  }
}

export function uniqueMercadoLivreItemIds(items) {
  const ids = [];
  const seen = new Set();

  for (const item of items ?? []) {
    const id = extractMercadoLivreItemId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

// Links recebidos no POST /mercadolivre/import, separados do endereço do anúncio.
export function parseMercadoLivreImportItems(items) {
  const values = [];
  const affiliateLinks = new Map();
  for (const entry of items) {
    const isObject = entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const value = isObject ? entry.id : entry;
    const id = extractMercadoLivreItemId(value);
    if (isObject && (!id || !/^MLB\d+$/.test(id))) {
      throw new Error("Produto com link de afiliado precisa de um ID MLB válido.");
    }
    values.push(value);
    if (!isObject || entry.affiliateUrl == null) continue;
    if (typeof entry.affiliateUrl !== "string" || !entry.affiliateUrl.trim()) {
      throw new Error(`Item ${id}: link de afiliado vazio ou inválido.`);
    }
    const link = entry.affiliateUrl.trim();
    let url;
    try { url = new URL(link); } catch {
      throw new Error(`Item ${id}: link de afiliado inválido.`);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["meli.la", "mercadolivre.com.br", "www.mercadolivre.com.br"].includes(url.hostname)) {
      throw new Error(`Item ${id}: use um link HTTPS do Mercado Livre ou meli.la.`);
    }
    if (affiliateLinks.has(id) && affiliateLinks.get(id) !== link) {
      throw new Error(`Item ${id}: dois links de afiliado diferentes na mesma carga.`);
    }
    // Preserva o link original; não gera nem altera parâmetros de atribuição.
    affiliateLinks.set(id, link);
  }
  return { itemIds: uniqueMercadoLivreItemIds(values), affiliateLinks };
}

export async function importMercadoLivreProducts({
  items,
  accessToken,
  categoryOverride
}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Envie um array 'items' com URLs ou ITEM_IDs do Mercado Livre.");
  }

  if (items.length > MAX_INPUT_ITEMS) {
    throw new Error(`A carga inicial aceita no máximo ${MAX_INPUT_ITEMS} itens por execução.`);
  }

  const { itemIds, affiliateLinks } = parseMercadoLivreImportItems(items);
  if (!itemIds.length) {
    throw new Error("Nenhum ITEM_ID válido do Mercado Livre foi encontrado.");
  }

  const connector = new MercadoLivreConnector({ accessToken: accessToken || await getMercadoLivreAccessToken() });
  const rawProducts = await connector.getProductsBulk(itemIds);

  const platformResult = await pool.query(
    "SELECT id FROM affiliate_platforms WHERE code = 'mercadolivre' AND is_active = TRUE LIMIT 1"
  );
  const platformId = platformResult.rows[0]?.id;
  if (!platformId) {
    throw new Error("Plataforma Mercado Livre não está cadastrada/ativa no banco.");
  }

  let imported = 0;
  let updated = 0;
  let matched = 0;
  let review = 0;
  let skipped = 0;

  for (const rawProduct of rawProducts) {
    if (rawProduct?.code && rawProduct.code !== 200) {
      skipped += 1;
      continue;
    }

    let normalized;
    try {
      normalized = connector.normalizeProduct(rawProduct);
    } catch (error) {
      console.error("Produto Mercado Livre ignorado:", error);
      skipped += 1;
      continue;
    }

    const affiliateUrl = affiliateLinks.get(normalized.externalId) ?? null;
    const normalizedIdentity = buildNormalizedProduct(normalized);
    const category = categoryOverride?.trim() || normalized.category || "Mercado Livre";
    const source = "mercadolivre";

    const existingOffer = await pool.query(
      `SELECT po.id, po.product_id
       FROM product_offers po
       WHERE po.platform_id = $1
         AND po.external_id = $2
       LIMIT 1`,
      [platformId, normalized.externalId]
    );

    if (existingOffer.rows[0]) {
      const productId = existingOffer.rows[0].product_id;
      await pool.query(
        `UPDATE products
         SET source = $1,
             title = $2,
             description = COALESCE($3, description),
             price = $4,
             image_url = NULLIF($5, ''),
             category = $6,
             stock_units = COALESCE($7, stock_units),
             product_kind = 'afiliado',
             brand = NULLIF($8, ''),
             ean = NULLIF($9, ''),
             model = NULLIF($10, ''),
             normalized_title = $11,
             canonical_key = $12,
             metadata = COALESCE(metadata, '{}'::jsonb) || $13::jsonb,
             updated_at = now()
         WHERE id = $14`,
        [
          source,
          normalized.title || "Produto Mercado Livre",
          null,
          normalized.price ?? 0,
          normalized.imageUrl,
          category,
          normalized.availableQuantity,
          normalized.brand,
          normalized.gtin,
          normalized.model,
          normalizedIdentity.title,
          buildCatalogCanonicalKey(normalized),
          JSON.stringify({ marketplace: "mercadolivre", condition: normalized.condition }),
          productId
        ]
      );

      await pool.query(
        `UPDATE product_offers
         SET affiliate_url = COALESCE($10, affiliate_url),
             product_url = $1,
             canonical_url = $1,
             price = $2,
             original_price = $3,
             currency = $4,
             stock_units = $5,
             availability = $6,
             seller_name = $7,
             is_active = TRUE,
             sync_status = 'api',
             last_synced_at = now(),
             last_checked_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
             updated_at = now()
         WHERE id = $9`,
        [
          normalized.productUrl,
          normalized.price,
          normalized.originalPrice,
          normalized.currency,
          normalized.availableQuantity,
          normalized.availableQuantity > 0 ? "disponivel" : "indisponivel",
          normalized.raw?.seller?.nickname || null,
          JSON.stringify({ condition: normalized.condition }),
          existingOffer.rows[0].id,
          affiliateUrl
        ]
      );

      updated += 1;
      continue;
    }

    let pairing;
    if (hasEnoughIdentity(normalized)) {
      const candidates = await findCatalogMatchCandidates({
        product: normalized,
        limit: 20
      });
      pairing = selectCatalogMatch(normalized, candidates);
    } else {
      pairing = { ranked: [], automaticMatch: null, reviewMatch: null, decision: "novo" };
    }

    let productId;
    if (pairing.automaticMatch) {
      productId = pairing.automaticMatch.candidate.id;
      matched += 1;
    } else {
      const productInsert = await pool.query(
        `INSERT INTO products (
            source,
            external_id,
            title,
            description,
            price,
            image_url,
            category,
            stock_units,
            product_kind,
            brand,
            ean,
            model,
            normalized_title,
            canonical_key,
            status,
            metadata,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,'afiliado',$9,$10,$11,$12,$13,'ativo',$14::jsonb,now()
          )
          RETURNING id`,
        [
          source,
          normalized.externalId,
          normalized.title || "Produto Mercado Livre",
          null,
          normalized.price ?? 0,
          normalized.imageUrl || null,
          category,
          normalized.availableQuantity ?? 0,
          normalized.brand || null,
          normalized.gtin || null,
          normalized.model || null,
          normalizedIdentity.title,
          buildCatalogCanonicalKey(normalized),
          JSON.stringify({
            importedFrom: "mercadolivre",
            marketplaceCategoryId: normalized.category,
            condition: normalized.condition,
            pairingDecision: pairing.decision
          })
        ]
      );

      productId = productInsert.rows[0]?.id;
      if (!productId) {
        skipped += 1;
        continue;
      }

      imported += 1;
      if (pairing.decision === "revisao") review += 1;
    }

    const offerInsert = await pool.query(
      `INSERT INTO product_offers (
         product_id,
         offer_type,
         platform_id,
         external_id,
         affiliate_url,
         product_url,
         canonical_url,
         price,
         original_price,
         currency,
         stock_units,
         availability,
         is_active,
         sync_status,
         last_synced_at,
         last_checked_at,
         metadata
       )
       VALUES (
         $1,'afiliada',$2,$3,$11,$4,$4,$5,$6,$7,$8,$9,TRUE,'api',now(),now(),$10::jsonb
       )
       ON CONFLICT (platform_id, external_id)
       WHERE external_id IS NOT NULL
       DO UPDATE SET
         product_id = EXCLUDED.product_id,
         affiliate_url = COALESCE(EXCLUDED.affiliate_url, product_offers.affiliate_url),
         product_url = EXCLUDED.product_url,
         canonical_url = EXCLUDED.canonical_url,
         price = EXCLUDED.price,
         original_price = EXCLUDED.original_price,
         currency = EXCLUDED.currency,
         stock_units = EXCLUDED.stock_units,
         availability = EXCLUDED.availability,
         is_active = TRUE,
         sync_status = 'api',
         last_synced_at = now(),
         last_checked_at = now(),
         metadata = EXCLUDED.metadata,
         updated_at = now()
       RETURNING id`,
      [
        productId,
        platformId,
        normalized.externalId,
        normalized.productUrl,
        normalized.price,
        normalized.originalPrice,
        normalized.currency,
        normalized.availableQuantity,
        normalized.availableQuantity > 0 ? "disponivel" : "indisponivel",
        JSON.stringify({
          importedFrom: "mercadolivre",
          pairingDecision: pairing.decision,
          matchedCandidateId: pairing.automaticMatch?.candidate?.id || null
        }),
        affiliateUrl
      ]
    );

    if (offerInsert.rows[0]?.id && pairing.ranked.length) {
      await persistMatchCandidates({
        sourceOfferId: offerInsert.rows[0].id,
        rankedCandidates: pairing.ranked
      });
    }
  }

  return {
    requested: items.length,
    validItemIds: itemIds.length,
    returnedByApi: rawProducts.length,
    imported,
    updated,
    matched,
    review,
    skipped
  };
}
