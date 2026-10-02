import "dotenv/config";
import pool from "../db/pool.js";
import { normalizeShopeeBulkItems, generateMissingShopeeAffiliateLinks } from "./shopee/bulk-importer.js";
import { upsertShopeeProducts } from "./shopee/feed-importer.js";
import { ShopeeAffiliateConnector } from "./shopee/client.js";
import { resolveShopeeMainImage } from "./shopee/image-resolver.js";

const POLL_MS = Number(process.env.SHOPEE_WORKER_POLL_MS || 3000);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.SHOPEE_WORKER_BATCH_SIZE || 100), 1), 250);

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function claimShopeeJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT j.id, j.platform_id, j.metadata
         FROM catalog_import_jobs j
         JOIN affiliate_platforms ap ON ap.id = j.platform_id
        WHERE j.status = 'queued'
          AND ap.code = 'shopee'
          AND ap.is_active = TRUE
        ORDER BY j.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    if (!result.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const job = result.rows[0];
    await client.query(
      `UPDATE catalog_import_jobs
          SET status = 'processando', started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE id = $1`,
      [job.id]
    );
    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finishJob(jobId) {
  const pending = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM catalog_import_items
      WHERE job_id = $1 AND import_status IN ('pending','retry')`,
    [jobId]
  );
  if (pending.rows[0].count > 0) return false;

  const errors = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM catalog_import_items
      WHERE job_id = $1 AND import_status = 'erro'`,
    [jobId]
  );

  await pool.query(
    `UPDATE catalog_import_jobs
        SET status = CASE WHEN $2 > 0 THEN 'concluido_com_erros' ELSE 'concluido' END,
            finished_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'processando'`,
    [jobId, errors.rows[0].count]
  );
  return true;
}

async function processBatch(job) {
  const pending = await pool.query(
    `SELECT id, external_id, raw_payload, normalized_payload
       FROM catalog_import_items
      WHERE job_id = $1
        AND import_status IN ('pending','retry')
      ORDER BY created_at ASC
      LIMIT $2`,
    [job.id, BATCH_SIZE]
  );

  if (!pending.rows.length) {
    await finishJob(job.id);
    return true;
  }

  const rawProducts = [];
  const rowById = new Map();

  for (const row of pending.rows) {
    try {
      const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
      const stored = row.normalized_payload && typeof row.normalized_payload === "object" ? row.normalized_payload : {};
      const product = normalizeShopeeBulkItems([{ ...raw, ...stored, itemid: row.external_id || raw.itemid || raw.itemId }])[0];
      rawProducts.push(product);
      rowById.set(product.id, row);
    } catch (error) {
      await pool.query(
        `UPDATE catalog_import_items
            SET import_status='erro', error_message=$2, updated_at=now()
          WHERE id=$1`,
        [row.id, (error instanceof Error ? error.message : "Produto inválido.").slice(0, 500)]
      );
    }
  }

  if (!rawProducts.length) {
    await pool.query(
      `UPDATE catalog_import_jobs
          SET discovered_count=discovered_count+$2, error_count=error_count+$2, updated_at=now()
        WHERE id=$1`,
      [job.id, pending.rows.length]
    );
    return false;
  }

  const connector = new ShopeeAffiliateConnector({
    appId: process.env.SHOPEE_AFFILIATE_APP_ID,
    secret: process.env.SHOPEE_AFFILIATE_SECRET
  });

  const generated = await generateMissingShopeeAffiliateLinks(rawProducts, connector, {
    concurrency: process.env.SHOPEE_LINK_CONCURRENCY,
    subIds: Array.isArray(job.metadata?.subIds) ? job.metadata.subIds : []
  });

  const failures = new Map(generated.failures.map((item) => [item.itemId, item.message]));
  for (const [itemId, message] of failures) {
    const row = rowById.get(itemId);
    if (!row) continue;
    await pool.query(
      `UPDATE catalog_import_items
          SET import_status='erro', error_message=$2, updated_at=now()
        WHERE id=$1`,
      [row.id, message.slice(0, 500)]
    );
  }

  if (!generated.products.length) {
    await pool.query(
      `UPDATE catalog_import_jobs
          SET discovered_count=discovered_count+$2, error_count=error_count+$3, updated_at=now()
        WHERE id=$1`,
      [job.id, rawProducts.length, failures.size]
    );
    return false;
  }

  // Se o feed trouxe placeholder/sem imagem, tenta resolver a imagem real na página do produto.
  const productsWithImages = await Promise.all(generated.products.map(async (product) => {
    const currentImage = String(product.image || "");
    if (currentImage && !currentImage.includes("placehold.co")) return product;
    try {
      const image = await resolveShopeeMainImage(product.productUrl);
      return { ...product, image };
    } catch (error) {
      console.warn(
        "Imagem Shopee não resolvida para",
        product.id,
        error instanceof Error ? error.message : "erro desconhecido"
      );
      return product;
    }
  }));

  const result = await upsertShopeeProducts(productsWithImages);
  const ready = new Map(productsWithImages.map((product) => [product.id, product]));
  const offers = new Map(result.offers.map((offer) => [offer.itemId, offer]));

  for (const [itemId, row] of rowById) {
    const offer = offers.get(itemId);
    if (!offer) continue;
    await pool.query(
      `UPDATE catalog_import_items
          SET import_status=$2, product_id=$3,
              normalized_payload=normalized_payload || $4::jsonb,
              error_message=NULL, updated_at=now()
        WHERE id=$1`,
      [row.id, offer.action === "updated" ? "atualizado" : "importado",
       offer.productId, JSON.stringify({ affiliateUrl: ready.get(itemId)?.affiliateUrl })]
    );
  }

  const imported = result.offers.filter((offer) => offer.action === "imported").length;
  const updated = result.offers.filter((offer) => offer.action === "updated").length;

  await pool.query(
    `UPDATE catalog_import_jobs
        SET discovered_count=discovered_count+$2,
            imported_count=imported_count+$3,
            updated_count=updated_count+$4,
            error_count=error_count+$5,
            updated_at=now()
      WHERE id=$1`,
    [job.id, pending.rows.length, imported, updated, failures.size + (pending.rows.length - rawProducts.length)]
  );

  return false;
}

async function run() {
  console.log(`Shopee worker iniciado (poll=${POLL_MS}ms, batch=${BATCH_SIZE}).`);

  while (!stopping) {
    const job = await claimShopeeJob();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }

    try {
      let finished = false;
      while (!finished && !stopping) {
        finished = await processBatch(job);
      }
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Falha no worker Shopee.").slice(0, 500);
      await pool.query(
        `UPDATE catalog_import_items
            SET import_status='retry', error_message=$2, updated_at=now()
          WHERE job_id=$1 AND import_status IN ('pending','retry')`,
        [job.id, message]
      );
      await pool.query(
        `UPDATE catalog_import_jobs SET status='queued', updated_at=now() WHERE id=$1`,
        [job.id]
      );
      console.error("Falha no job Shopee:", message);
    }
  }

  await pool.end();
}

run().catch((error) => {
  console.error("Shopee worker erro fatal:", error);
  process.exit(1);
});
