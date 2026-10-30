import pool from "../../db/pool.js";
import { buildNormalizedProduct } from "../core/normalizer.js";
import { resolveSiteCategory } from "../core/site-category-resolver.js";
import {
  buildCatalogCanonicalKey,
  findCatalogMatchCandidates,
  hasEnoughIdentity,
  persistMatchCandidates,
  selectCatalogMatch
} from "../core/catalog-pairing.js";
import { AliExpressAffiliateConnector } from "./client.js";

const MAX_IMPORT_ITEMS = 100;

export function normalizeAliExpressImportItem(row, connector) {
  if (!row || typeof row !== "object") throw new Error("Produto AliExpress inválido.");
  const product = connector.normalizeProduct(row);

  validateUrl(product.productUrl, "produto", product.externalId, ["aliexpress.com", "aliexpress.us"]);
  validateUrl(product.affiliateUrl, "afiliado", product.externalId, [
    "aliexpress.com", "aliexpress.us", "aliexpress.ru", "aliexpress.com.br"
  ]);
  if (product.title.length > 255) throw new Error(`Item ${product.externalId}: título inválido.`);
  if (!product.imageUrl) throw new Error(`Item ${product.externalId}: imagem ausente.`);

  validateUrl(product.imageUrl, "imagem", product.externalId, ["alicdn.com", "aliexpress-media.com"]);
  return product;
}

export async function importAliExpressProducts({
  items,
  categoryOverride,
  connector: suppliedConnector
} = {}, db = pool) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Envie um array 'items' com produtos AliExpress selecionados.");
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    throw new Error(`A carga AliExpress aceita no máximo ${MAX_IMPORT_ITEMS} itens por execução.`);
  }

  const connector = suppliedConnector || new AliExpressAffiliateConnector({
    appKey: process.env.ALIEXPRESS_APP_KEY,
    appSecret: process.env.ALIEXPRESS_APP_SECRET,
    trackingId: process.env.ALIEXPRESS_TRACKING_ID,
    endpoint: process.env.ALIEXPRESS_API_ENDPOINT
  });
  connector.assertConfigured();

  const normalizedProducts = [];
  const errors = [];
  const seen = new Set();
  for (const item of items) {
    try {
      const product = normalizeAliExpressImportItem(item, connector);
      if (seen.has(product.externalId)) throw new Error(`ID duplicado: ${product.externalId}.`);
      seen.add(product.externalId);
      normalizedProducts.push(product);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Produto AliExpress inválido.");
    }
  }
  if (!normalizedProducts.length) throw new Error(errors[0] || "Nenhum produto AliExpress válido.");

  const platformResult = await db.query(
    "SELECT id FROM affiliate_platforms WHERE code = 'aliexpress' AND is_active = TRUE LIMIT 1"
  );
  const platformId = platformResult.rows[0]?.id;
  if (!platformId) throw new Error("Plataforma AliExpress não cadastrada ou inativa. Execute a migração do banco.");

  let imported = 0;
  let updated = 0;
  let matched = 0;
  let review = 0;
  let skipped = errors.length;
  const offers = [];

  for (const normalized of normalizedProducts) {
    const identity = buildNormalizedProduct(normalized);
    const category = resolveSiteCategory({
      category: normalized.category,
      title: normalized.title,
      description: normalized.description,
      categoryOverride
    });
    const existingOffer = await db.query(
      `SELECT po.id, po.product_id
         FROM product_offers po
        WHERE po.platform_id = $1 AND po.external_id = $2
        LIMIT 1`,
      [platformId, normalized.externalId]
    );

    if (existingOffer.rows[0]) {
      const productId = existingOffer.rows[0].product_id;
      await db.query(
        `UPDATE products
            SET title=$1, price=$2, image_url=NULLIF($3,''), category=$4,
                product_kind='afiliado', brand=NULLIF($5,''), ean=NULLIF($6,''),
                model=NULLIF($7,''), normalized_title=$8, canonical_key=$9,
                metadata=COALESCE(metadata,'{}'::jsonb)||$10::jsonb, updated_at=now()
          WHERE id=$11`,
        [
          normalized.title, normalized.price, normalized.imageUrl, category,
          normalized.brand, normalized.gtin, normalized.model, identity.title,
          buildCatalogCanonicalKey(normalized),
          JSON.stringify({ marketplace: "aliexpress", commissionRate: normalized.commissionRate }),
          productId
        ]
      );
      await updateOffer(db, existingOffer.rows[0].id, normalized, category);
      updated += 1;
      offers.push({ itemId: normalized.externalId, productId, action: "updated", offerId: existingOffer.rows[0].id });
      continue;
    }

    const pairing = hasEnoughIdentity(normalized)
      ? selectCatalogMatch(normalized, await findCatalogMatchCandidates({ product: normalized, limit: 20, db }))
      : { ranked: [], automaticMatch: null, reviewMatch: null, decision: "novo" };

    let productId;
    if (pairing.automaticMatch) {
      productId = pairing.automaticMatch.candidate.id;
      matched += 1;
    } else {
      const productInsert = await db.query(
        `INSERT INTO products (
           source, external_id, title, description, price, image_url, category,
           stock_units, product_kind, brand, ean, model, normalized_title,
           canonical_key, status, metadata, updated_at
         ) VALUES (
           'aliexpress',$1,$2,$3,$4,$5,$6,NULL,'afiliado',$7,$8,$9,$10,$11,
           'ativo',$12::jsonb,now()
         ) RETURNING id`,
        [
          normalized.externalId, normalized.title, null, normalized.price,
          normalized.imageUrl || null, category, normalized.brand || null,
          normalized.gtin || null, normalized.model || null, identity.title,
          buildCatalogCanonicalKey(normalized),
          JSON.stringify({
            importedFrom: "aliexpress",
            marketplaceCategory: normalized.category,
            pairingDecision: pairing.decision
          })
        ]
      );
      productId = productInsert.rows[0]?.id;
      if (!productId) { skipped += 1; continue; }
      imported += 1;
      if (pairing.decision === "revisao") review += 1;
    }

    const offerInsert = await db.query(
      `INSERT INTO product_offers (
         product_id, offer_type, platform_id, external_id, affiliate_url,
         product_url, canonical_url, price, original_price, currency,
         stock_units, availability, seller_name, is_active, sync_status,
         last_synced_at, last_checked_at, metadata
       ) VALUES (
         $1,'afiliada',$2,$3,$4,$5,$5,$6,$7,$8,NULL,'desconhecida',$9,TRUE,
         'api',now(),now(),$10::jsonb
       )
       ON CONFLICT (platform_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET product_id=EXCLUDED.product_id, affiliate_url=EXCLUDED.affiliate_url,
         product_url=EXCLUDED.product_url, canonical_url=EXCLUDED.canonical_url,
         price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         currency=EXCLUDED.currency, seller_name=EXCLUDED.seller_name,
         is_active=TRUE, sync_status='api', last_synced_at=now(),
         last_checked_at=now(), metadata=EXCLUDED.metadata, updated_at=now()
       RETURNING id`,
      [
        productId, platformId, normalized.externalId, normalized.affiliateUrl,
        normalized.productUrl, normalized.price, normalized.originalPrice,
        normalized.currency, normalized.shopId || null,
        JSON.stringify({
          importedFrom: "aliexpress",
          pairingDecision: pairing.decision,
          matchedCandidateId: pairing.automaticMatch?.candidate?.id || null,
          commissionRate: normalized.commissionRate,
          trackingIdConfigured: true
        })
      ]
    );

    const offerId = offerInsert.rows[0]?.id;
    if (offerId && pairing.ranked.length) await persistMatchCandidates({ sourceOfferId: offerId, rankedCandidates: pairing.ranked, db });
    offers.push({ itemId: normalized.externalId, productId, offerId, action: pairing.automaticMatch ? "matched" : "imported", pairingDecision: pairing.decision });
  }

  return {
    requested: items.length,
    valid: normalizedProducts.length,
    imported,
    updated,
    matched,
    review,
    skipped,
    errors,
    offers
  };
}

async function updateOffer(db, offerId, product, category) {
  await db.query(
    `UPDATE product_offers
        SET affiliate_url=$1, product_url=$2, canonical_url=$2, price=$3,
            original_price=$4, currency=$5, availability='desconhecida',
            seller_name=$6, is_active=TRUE, sync_status='api', last_synced_at=now(),
            last_checked_at=now(), metadata=COALESCE(metadata,'{}'::jsonb)||$7::jsonb,
            updated_at=now()
      WHERE id=$8`,
    [product.affiliateUrl, product.productUrl, product.price, product.originalPrice,
      product.currency, product.shopId || null,
      JSON.stringify({ marketplace: "aliexpress", category }), offerId]
  );
}

function validateUrl(value, label, id, allowedHosts) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Item ${id}: endereço ${label} inválido.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`Item ${id}: endereço ${label} fora dos domínios permitidos.`);
  }
}

export { MAX_IMPORT_ITEMS };


