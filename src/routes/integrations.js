import express from "express";
import pool from "../db/pool.js";
import { importMercadoLivreProducts, uniqueMercadoLivreItemIds } from "../integrations/mercadolivre/importer.js";

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
      accessToken: process.env.MELI_ACCESS_TOKEN,
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
