import express from "express";
import pool from "../db/pool.js";

const router = express.Router();
const SOURCE_URL = "https://comercio-popular-backend-production.up.railway.app/api/catalog/products";
const DEFAULT_PAGE_SIZE = 100;
const MAX_ITEMS = 10000;

function requireIntegrationAdmin(req, res, next) {
  const expected = String(process.env.INTEGRATION_ADMIN_TOKEN || "").trim();
  const received = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || received !== expected) {
    return res.status(401).json({ error: "Credencial de integração inválida." });
  }
  return next();
}

function positiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function productExternalId(product) {
  const offer = Array.isArray(product?.offers) ? product.offers.find((item) => item?.externalId) : undefined;
  return String(offer?.externalId || product?.id || "").trim();
}

function platformCode(product) {
  const offer = Array.isArray(product?.offers) ? product.offers.find((item) => item?.platform?.code) : undefined;
  return String(offer?.platform?.code || product?.source || "").trim().toLowerCase();
}

async function fetchPublicCatalog(maxItems) {
  const products = [];
  for (let offset = 0; offset < maxItems; offset += DEFAULT_PAGE_SIZE) {
    const url = new URL(SOURCE_URL);
    url.searchParams.set("limit", String(Math.min(DEFAULT_PAGE_SIZE, maxItems - offset)));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "ComercioPopular-StagingSync/1.0" },
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw new Error(`Catálogo público respondeu HTTP ${response.status}.`);
    const payload = await response.json();
    const batch = Array.isArray(payload?.products) ? payload.products : [];
    products.push(...batch);
    if (batch.length < Math.min(DEFAULT_PAGE_SIZE, maxItems - offset)) break;
  }
  return products.slice(0, maxItems);
}

function buildPreview(products) {
  return products.map((product) => ({
    sourceId: productExternalId(product),
    title: String(product?.title || "").trim(),
    currentCategory: String(product?.category || "").trim(),
    price: positiveNumber(product?.price),
    imageUrl: String(product?.image_url || "").trim(),
    platform: platformCode(product)
  }));
}

router.post("/catalog-sync", requireIntegrationAdmin, async (req, res) => {
  const requested = Number.parseInt(req.body?.maxItems, 10);
  const maxItems = Math.min(Math.max(Number.isInteger(requested) ? requested : 500, 1), MAX_ITEMS);
  const commit = req.body?.commit === true;

  try {
    const sourceProducts = await fetchPublicCatalog(maxItems);
    const preview = buildPreview(sourceProducts);

    if (!commit) {
      return res.json({
        ok: true,
        mode: "preview",
        source: SOURCE_URL,
        received: sourceProducts.length,
        preview: preview.slice(0, 50)
      });
    }

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;
    try {
      await client.query("BEGIN");
      for (const product of preview) {
        if (!product.sourceId || !product.title) continue;
        const metadata = JSON.stringify({
          stagingSnapshot: true,
          sourceProductId: product.sourceId,
          sourcePlatform: product.platform,
          sourceUrl: SOURCE_URL
        });
        const existing = await client.query(
          "SELECT id FROM products WHERE source = 'staging_snapshot' AND external_id = $1 LIMIT 1",
          [product.sourceId]
        );
        if (existing.rows[0]) {
          await client.query(
            `UPDATE products
                SET title = $2, price = $3, image_url = NULLIF($4, ''), category = NULLIF($5, ''),
                    metadata = $6::jsonb, updated_at = now()
              WHERE id = $1`,
            [existing.rows[0].id, product.title, product.price, product.imageUrl, product.currentCategory, metadata]
          );
          updated += 1;
        } else {
          await client.query(
            `INSERT INTO products
              (source, external_id, title, description, price, image_url, category, product_kind, status, metadata, updated_at)
             VALUES ('staging_snapshot', $1, $2, '', $3, NULLIF($4, ''), NULLIF($5, ''), 'afiliado', 'ativo', $6::jsonb, now())`,
            [product.sourceId, product.title, product.price, product.imageUrl, product.currentCategory, metadata]
          );
          inserted += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return res.json({
      ok: true,
      mode: "commit",
      source: SOURCE_URL,
      received: sourceProducts.length,
      inserted,
      updated,
      skipped: sourceProducts.length - inserted - updated,
      preview: preview.slice(0, 20)
    });
  } catch (error) {
    console.error("Falha na sincronização staging do catálogo:", error);
    return res.status(400).json({ error: error instanceof Error ? error.message : "Falha ao sincronizar o catálogo." });
  }
});

export default router;
