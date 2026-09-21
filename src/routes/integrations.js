import express from "express";
import pool from "../db/pool.js";
import { importMercadoLivreProducts, uniqueMercadoLivreItemIds } from "../integrations/mercadolivre/importer.js";
import { ShopeeAffiliateConnector } from "../integrations/shopee/client.js";
import {
  buildMercadoLivreAuthorizationUrl,
  createMercadoLivreOAuthState,
  completeMercadoLivreOAuth,
  getMercadoLivreConnectionStatus,
  refreshMercadoLivreAccessToken,
  getMercadoLivreAccessToken
} from "../integrations/mercadolivre/oauth.js";

const router = express.Router();
const MAX_ENQUEUE_ITEMS = 30000;

function requireIntegrationAdmin(req, res, next) {
  const configured = process.env.INTEGRATION_ADMIN_TOKEN?.trim();
  const authorization = req.headers.authorization ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : req.headers["x-integration-token"];

  if (!configured) {
    return res.status(503).json({
      error: "Integrações administrativas não configuradas. Defina INTEGRATION_ADMIN_TOKEN."
    });
  }

  if (!provided || provided !== configured) {
    return res.status(401).json({ error: "Credencial de integração inválida." });
  }

  next();
}

// POST /api/integrations/mercadolivre/import
// Mantido para cargas curtas/testes controlados.
router.post("/mercadolivre/import", requireIntegrationAdmin, async (req, res) => {
  try {
    const result = await importMercadoLivreProducts({
      items: req.body?.items,
      accessToken: await getMercadoLivreAccessToken(),
      categoryOverride: req.body?.category
    });

    res.status(200).json({
      ok: true,
      marketplace: "mercadolivre",
      ...result
    });
  } catch (error) {
    console.error("Erro na importação Mercado Livre:", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Falha na importação."
    });
  }
});

// GET /api/integrations/shopee/health
router.get("/shopee/health", requireIntegrationAdmin, async (_req, res) => {
  const connector = new ShopeeAffiliateConnector({
    appId: process.env.SHOPEE_AFFILIATE_APP_ID,
    secret: process.env.SHOPEE_AFFILIATE_SECRET
  });

  return res.json({
    marketplace: "shopee",
    configured: connector.isConfigured()
  });
});

// POST /api/integrations/shopee/generate-link
router.post("/shopee/generate-link", requireIntegrationAdmin, async (req, res) => {
  try {
    const connector = new ShopeeAffiliateConnector({
      appId: process.env.SHOPEE_AFFILIATE_APP_ID,
      secret: process.env.SHOPEE_AFFILIATE_SECRET
    });

    const productUrl = typeof req.body?.productUrl === "string"
      ? req.body.productUrl.trim()
      : "";

    if (!productUrl) {
      return res.status(400).json({ error: "Envie productUrl." });
    }

    const result = await connector.generateAffiliateLink(
      productUrl,
      Array.isArray(req.body?.subIds) ? req.body.subIds : undefined
    );

    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Erro ao gerar link Shopee:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao gerar link Shopee."
    });
  }
});

// GET /api/integrations/shopee/search
router.get("/shopee/search", requireIntegrationAdmin, async (req, res) => {
  try {
    const connector = new ShopeeAffiliateConnector({
      appId: process.env.SHOPEE_AFFILIATE_APP_ID,
      secret: process.env.SHOPEE_AFFILIATE_SECRET
    });

    const result = await connector.searchOffers({
      keyword: typeof req.query.keyword === "string" ? req.query.keyword : "",
      categoryId: req.query.categoryId,
      page: req.query.page,
      limit: req.query.limit
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Erro ao consultar ofertas Shopee:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao consultar Shopee."
    });
  }
});

// POST /api/integrations/mercadolivre/import-jobs
// Enfileira até 30 mil URLs/ITEM_IDs. O worker processa em lotes de até 20.
router.post("/mercadolivre/import-jobs", requireIntegrationAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const itemIds = uniqueMercadoLivreItemIds(items);

  if (!items.length) {
    return res.status(400).json({ error: "Envie 'items' com URLs ou ITEM_IDs." });
  }

  if (items.length > MAX_ENQUEUE_ITEMS) {
    return res.status(400).json({
      error: `A fila aceita até ${MAX_ENQUEUE_ITEMS} entradas por job.`
    });
  }

  if (!itemIds.length) {
    return res.status(400).json({ error: "Nenhum ITEM_ID válido foi encontrado." });
  }

  const category = typeof req.body?.category === "string" ? req.body.category.trim() : null;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const platformResult = await client.query(
      "SELECT id FROM affiliate_platforms WHERE code = 'mercadolivre' AND is_active = TRUE LIMIT 1"
    );
    const platformId = platformResult.rows[0]?.id;

    if (!platformId) {
      throw new Error("Plataforma Mercado Livre não está cadastrada/ativa.");
    }

    const jobResult = await client.query(
      `INSERT INTO catalog_import_jobs (
         platform_id, source_type, status, requested_count, metadata
       )
       VALUES ($1, 'urls_or_item_ids', 'queued', $2, $3::jsonb)
       RETURNING id, status, requested_count, created_at`,
      [platformId, itemIds.length, JSON.stringify({ category })]
    );

    const jobId = jobResult.rows[0].id;

    for (const itemId of itemIds) {
      await client.query(
        `INSERT INTO catalog_import_items (
           job_id, external_id, source_url, normalized_url, import_status
         )
         VALUES ($1, $2, NULL, NULL, 'pending')`,
        [jobId, itemId]
      );
    }

    await client.query("COMMIT");

    return res.status(202).json({
      ok: true,
      job: {
        id: jobId,
        status: "queued",
        requested: itemIds.length
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao enfileirar importação Mercado Livre:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao criar job."
    });
  } finally {
    client.release();
  }
});

// GET /api/integrations/jobs/:id
router.get("/jobs/:id", requireIntegrationAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, status, requested_count, discovered_count, imported_count,
              updated_count, matched_count, review_count, error_count,
              started_at, finished_at, created_at, updated_at, metadata
         FROM catalog_import_jobs
        WHERE id = $1
        LIMIT 1`,
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Job não encontrado." });
    }

    return res.json({ job: result.rows[0] });
  } catch (error) {
    console.error("Erro ao consultar job:", error);
    return res.status(500).json({ error: "Erro ao consultar o job." });
  }
});

export default router;
