import { importShopeeFeed } from "../integrations/shopee/feed-importer.js";
import { importSheinFeed } from "../integrations/shein/feed-importer.js";
import express from "express";
import pool from "../db/pool.js";
import { importMercadoLivreProducts, uniqueMercadoLivreItemIds } from "../integrations/mercadolivre/importer.js";
import { ShopeeAffiliateConnector } from "../integrations/shopee/client.js";
import { normalizeShopeeBulkItems, MAX_BULK_ITEMS } from "../integrations/shopee/bulk-importer.js";
import { resolveShopeeImages } from "../integrations/shopee/image-resolver.js";
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

// POST /api/integrations/shein/import-feed
// Importação validada e transacional da SHEIN. Prévia (dryRun) por padrão.
router.post("/shein/import-feed", requireIntegrationAdmin, async (req, res) => {
  try {
    res.json({ ok: true, marketplace: "shein", ...await importSheinFeed(req.body ?? {}) });
  } catch (error) {
    console.error("Falha na importação do feed SHEIN:", error.message);
    res.status(400).json({ error: "Importação cancelada. Confira os campos e os logs do servidor; nenhuma alteração foi confirmada." });
  }
});

// Importação pequena, validada e transacional. Prévia por padrão.
router.post("/shopee/import-feed", requireIntegrationAdmin, async (req, res) => {
  try {
    res.json({ ok: true, marketplace: "shopee", ...await importShopeeFeed(req.body ?? {}) });
  } catch (error) {
    console.error("Falha na importação do feed Shopee:", error.message);
    res.status(400).json({ error: "Importação cancelada. Confira os campos e os logs do servidor; nenhuma alteração foi confirmada." });
  }
});

// POST /api/integrations/shopee/resolve-images
// Recupera imagens diretamente do PDP Shopee por shop_id + item_id.
// Não grava catálogo; retorna somente URLs de imagem para a prévia/importação.
router.post("/shopee/resolve-images", requireIntegrationAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Envie 'items' com Item IDs e Product Links Shopee." });
  if (items.length > 100) return res.status(400).json({ error: "A resolução aceita até 100 produtos por chamada." });

  try {
    const affiliateConnector = new ShopeeAffiliateConnector({
      appId: process.env.SHOPEE_AFFILIATE_APP_ID,
      secret: process.env.SHOPEE_AFFILIATE_SECRET
    });
    const result = await resolveShopeeImages(items, { affiliateConnector });
    return res.json({ ok: true, marketplace: "shopee", ...result });
  } catch (error) {
    console.error("Erro ao resolver imagens Shopee:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao recuperar imagens Shopee."
    });
  }
});

// POST /api/integrations/shopee/import-jobs
// Importação em massa: enfileira até 30 mil produtos. O worker gera links de afiliado e grava em lotes.
router.post("/shopee/import-jobs", requireIntegrationAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ error: "Envie 'items' com produtos do feed Shopee." });
  }
  if (items.length > MAX_BULK_ITEMS) {
    return res.status(400).json({ error: `A fila Shopee aceita até ${MAX_BULK_ITEMS} produtos por job.` });
  }

  const client = await pool.connect();
  try {
    const normalized = normalizeShopeeBulkItems(items, { requireAffiliateLink: true });

    await client.query("BEGIN");
    const platformResult = await client.query(
      "SELECT id FROM affiliate_platforms WHERE code = 'shopee' AND is_active = TRUE LIMIT 1"
    );
    const platformId = platformResult.rows[0]?.id;
    if (!platformId) throw new Error("Plataforma Shopee não está cadastrada/ativa.");

    const rawSubIds = Array.isArray(req.body?.subIds) ? req.body.subIds : [];
    const subIds = rawSubIds
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);

    const jobResult = await client.query(
      `INSERT INTO catalog_import_jobs (
         platform_id, source_type, status, requested_count, metadata
       )
       VALUES ($1, 'shopee_feed', 'queued', $2, $3::jsonb)
       RETURNING id, status, requested_count, created_at`,
      [platformId, normalized.length, JSON.stringify({ autoGenerateAffiliateLinks: true, subIds })]
    );
    const jobId = jobResult.rows[0].id;

    const itemPayload = normalized.map((product, index) => ({
      external_id: product.id,
      source_url: product.productUrl,
      normalized_url: product.productUrl,
      raw_payload: JSON.stringify(items[index]),
      normalized_payload: JSON.stringify(product)
    }));

    await client.query(
      `INSERT INTO catalog_import_items (
         job_id, external_id, source_url, normalized_url, raw_payload, normalized_payload, import_status
       )
       SELECT $1, data.external_id, data.source_url, data.normalized_url,
              data.raw_payload::jsonb, data.normalized_payload::jsonb, 'pending'
         FROM jsonb_to_recordset($2::jsonb) AS data(
           external_id text, source_url text, normalized_url text,
           raw_payload text, normalized_payload text
         )`,
      [jobId, JSON.stringify(itemPayload)]
    );

    await client.query("COMMIT");
    return res.status(202).json({
      ok: true,
      marketplace: "shopee",
      job: { id: jobId, status: "queued", requested: normalized.length, worker: "integration" }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao enfileirar importação Shopee:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao criar job Shopee."
    });
  } finally {
    client.release();
  }
});

// POST /api/integrations/shopee/repair-catalog-state
// Reativa somente o estado de exibição dos produtos/ofertas Shopee.
// Não altera título, preço, link de afiliado ou imagem.
router.post("/shopee/repair-catalog-state", requireIntegrationAdmin, async (_req, res) => {
  try {
    const offers = await pool.query(`
      UPDATE product_offers
         SET is_active = TRUE,
             updated_at = now()
       WHERE platform_id = (
         SELECT id FROM affiliate_platforms
          WHERE code = 'shopee'
          LIMIT 1
       )
         AND COALESCE(affiliate_url, '') <> ''
      RETURNING product_id
    `);

    const products = await pool.query(`
      UPDATE products
         SET status = 'ativo',
             is_achadinho = TRUE,
             updated_at = now()
       WHERE source = 'shopee'
         AND COALESCE(affiliate_link, '') <> ''
      RETURNING id
    `);

    return res.json({
      ok: true,
      marketplace: "shopee",
      repaired_offers: offers.rowCount,
      repaired_products: products.rowCount
    });
  } catch (error) {
    console.error("Erro no reparo seguro do catálogo Shopee:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Falha ao reparar catálogo Shopee."
    });
  }
});

// POST /api/integrations/shopee/reclassify-import-job-categories
// Corrige categorias de um único lote Shopee, preservando preço, imagem e links.
router.post("/shopee/reclassify-import-job-categories", requireIntegrationAdmin, async (req, res) => {
  const jobPrefix = typeof req.body?.jobPrefix === "string" ? req.body.jobPrefix.trim() : "";
  if (!/^[a-f0-9]{8}$/i.test(jobPrefix)) {
    return res.status(400).json({ error: "Informe os 8 primeiros caracteres do ID do lote." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jobResult = await client.query(
      `SELECT j.id
         FROM catalog_import_jobs j
         JOIN affiliate_platforms ap ON ap.id = j.platform_id
        WHERE ap.code = 'shopee'
          AND j.id::text LIKE $1 || '%'
        ORDER BY j.created_at DESC
        LIMIT 1
        FOR UPDATE OF j`,
      [jobPrefix]
    );
    const jobId = jobResult.rows[0]?.id;
    if (!jobId) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Não encontrei um lote Shopee com esse prefixo." });
    }

    const updated = await client.query(
      `WITH scoped_products AS (
         SELECT DISTINCT p.id, p.title,
           CASE
             WHEN lower(p.title) LIKE '%luminária%'
               OR lower(p.title) LIKE '%luminaria%'
               OR lower(p.title) LIKE '%abajur%'
               THEN 'Utilidades'
             WHEN (lower(p.title) LIKE '%caminhão%' OR lower(p.title) LIKE '%caminhao%')
               AND lower(p.title) LIKE '%controle%remoto%'
               THEN 'Brinquedos'
             ELSE NULL
           END AS target_category
         FROM catalog_import_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.job_id = $1
           AND p.source = 'shopee'
       ),
       changed AS (
         UPDATE products p
            SET category = s.target_category,
                metadata = COALESCE(p.metadata, '{}'::jsonb)
                  || jsonb_build_object('categoryOverride', s.target_category),
                updated_at = now()
           FROM scoped_products s
          WHERE p.id = s.id
            AND s.target_category IS NOT NULL
            AND (
              p.category IS DISTINCT FROM s.target_category
              OR p.metadata->>'categoryOverride' IS DISTINCT FROM s.target_category
            )
         RETURNING p.id, p.title, p.category
       )
       SELECT id, title, category FROM changed ORDER BY category, title`,
      [jobId]
    );

    await client.query(
      `UPDATE product_offers po
          SET metadata = COALESCE(po.metadata, '{}'::jsonb)
                || jsonb_build_object('categoryOverride', p.category),
              updated_at = now()
         FROM catalog_import_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN affiliate_platforms ap ON ap.code = 'shopee'
        WHERE ci.job_id = $1
          AND po.product_id = p.id
          AND po.platform_id = ap.id
          AND (
            lower(p.title) LIKE '%luminária%'
            OR lower(p.title) LIKE '%luminaria%'
            OR lower(p.title) LIKE '%abajur%'
            OR (
              (lower(p.title) LIKE '%caminhão%' OR lower(p.title) LIKE '%caminhao%')
              AND lower(p.title) LIKE '%controle%remoto%'
            )
          )`,
      [jobId]
    );

    await client.query(
      `UPDATE catalog_import_items ci
          SET normalized_payload = COALESCE(ci.normalized_payload, '{}'::jsonb)
                || jsonb_build_object('category', p.category, 'categoryOverride', p.category),
              updated_at = now()
         FROM products p
        WHERE ci.job_id = $1
          AND ci.product_id = p.id
          AND (
            p.category = 'Utilidades' AND (
              lower(p.title) LIKE '%luminária%'
              OR lower(p.title) LIKE '%luminaria%'
              OR lower(p.title) LIKE '%abajur%'
            )
            OR p.category = 'Brinquedos'
              AND (lower(p.title) LIKE '%caminhão%' OR lower(p.title) LIKE '%caminhao%')
              AND lower(p.title) LIKE '%controle%remoto%'
          )`,
      [jobId]
    );

    await client.query("COMMIT");
    const utilidades = updated.rows.filter((row) => row.category === "Utilidades").length;
    const brinquedos = updated.rows.filter((row) => row.category === "Brinquedos").length;
    return res.json({
      ok: true,
      jobPrefix,
      updatedCount: updated.rows.length,
      utilidades,
      brinquedos,
      changed: updated.rows
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao corrigir categorias do lote Shopee:", error);
    return res.status(500).json({
      error: "Não foi possível corrigir as categorias. Nenhuma alteração parcial foi confirmada."
    });
  } finally {
    client.release();
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
      itemId: req.query.itemId,
      shopId: req.query.shopId,
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

// GET /api/integrations/mercadolivre/oauth/start
// Inicia o fluxo OAuth 2.0 Server-Side do Mercado Livre.
router.get("/mercadolivre/oauth/start", async (_req, res) => {
  try {
    const { state, codeChallenge } = await createMercadoLivreOAuthState();
    return res.redirect(buildMercadoLivreAuthorizationUrl(state, codeChallenge));
  } catch (error) {
    console.error("Erro ao iniciar OAuth Mercado Livre:", error);
    return res.status(503).json({
      error: error instanceof Error ? error.message : "OAuth Mercado Livre não configurado."
    });
  }
});

// GET /api/integrations/mercadolivre/oauth/callback
// URL cadastrada no DevCenter. Recebe code/state e persiste os tokens.
router.get("/mercadolivre/oauth/callback", async (req, res) => {
  try {
    const result = await completeMercadoLivreOAuth({
      code: typeof req.query.code === "string" ? req.query.code : undefined,
      state: typeof req.query.state === "string" ? req.query.state : undefined,
      error: typeof req.query.error === "string" ? req.query.error : undefined,
      errorDescription: typeof req.query.error_description === "string"
        ? req.query.error_description
        : undefined
    });

    const successRedirect = process.env.MELI_OAUTH_SUCCESS_REDIRECT_URL?.trim();
    if (successRedirect) {
      const url = new URL(successRedirect);
      url.searchParams.set("mercadolivre", "connected");
      url.searchParams.set("user_id", result.userId);
      return res.redirect(url.toString());
    }

    return res.status(200).type("html").send(
      "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>Mercado Livre conectado</title></head><body><h1>Mercado Livre conectado com sucesso.</h1><p>Você pode fechar esta janela.</p></body></html>"
    );
  } catch (error) {
    console.error("Erro no callback OAuth Mercado Livre:", error);
    return res.status(400).type("html").send(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Falha na conexão</title></head><body><h1>Não foi possível conectar o Mercado Livre.</h1><p>${error instanceof Error ? error.message : "Erro desconhecido."}</p></body></html>`
    );
  }
});

// GET /api/integrations/mercadolivre/oauth/status
router.get("/mercadolivre/oauth/status", requireIntegrationAdmin, async (_req, res) => {
  try {
    return res.json({
      marketplace: "mercadolivre",
      ...(await getMercadoLivreConnectionStatus())
    });
  } catch (error) {
    console.error("Erro ao consultar OAuth Mercado Livre:", error);
    return res.status(500).json({ error: "Erro ao consultar a conexão Mercado Livre." });
  }
});

// POST /api/integrations/mercadolivre/oauth/refresh
router.post("/mercadolivre/oauth/refresh", requireIntegrationAdmin, async (_req, res) => {
  try {
    await refreshMercadoLivreAccessToken();
    return res.json({
      ok: true,
      marketplace: "mercadolivre",
      refreshed: true
    });
  } catch (error) {
    console.error("Erro ao atualizar token Mercado Livre:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao atualizar token Mercado Livre."
    });
  }
});

// GET /api/integrations/mercadolivre/notifications
// Responde ao validador do DevCenter sem criar uma notificação.
router.get("/mercadolivre/notifications", (_req, res) => {
  return res.status(200).json({ status: "OK" });
});

// POST /api/integrations/mercadolivre/notifications
// URL de retorno para os tópicos do Mercado Livre.
// O Mercado Livre exige HTTP 200 em até 500 ms; o banco é atualizado de forma assíncrona.
router.post("/mercadolivre/notifications", async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const expectedApplicationId = process.env.MELI_APP_ID?.trim();
  const receivedApplicationId = payload.application_id == null ? null : String(payload.application_id);

  if (expectedApplicationId && receivedApplicationId && receivedApplicationId !== expectedApplicationId) {
    return res.status(403).json({
      error: "application_id de notificação não corresponde à aplicação configurada."
    });
  }

  const notification = {
    externalId: payload._id ? String(payload._id) : null,
    resource: typeof payload.resource === "string" ? payload.resource : null,
    topic: typeof payload.topic === "string" ? payload.topic : null,
    userId: payload.user_id == null ? null : String(payload.user_id),
    applicationId: receivedApplicationId,
    attempts: Number.isFinite(Number(payload.attempts)) ? Number(payload.attempts) : null,
    sentAt: payload.sent ? new Date(payload.sent) : null,
    receivedAt: payload.received ? new Date(payload.received) : new Date(),
    payload
  };

  res.status(200).json({ status: "OK" });

  setImmediate(() => {
    pool.query(
      `INSERT INTO mercadolivre_notifications (
          external_id,
          resource,
          topic,
          user_id,
          application_id,
          attempts,
          sent_at,
          received_at,
          payload
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT (external_id)
        DO NOTHING`,
      [
        notification.externalId,
        notification.resource,
        notification.topic,
        notification.userId,
        notification.applicationId,
        notification.attempts,
        notification.sentAt,
        notification.receivedAt,
        JSON.stringify(notification.payload)
      ]
    ).catch(error => {
      console.error("Erro assíncrono ao persistir notificação Mercado Livre:", error);
    });
  });
});

// URL de notificação a cadastrar no DevCenter:
 // https://comercio-popular-backend-production.up.railway.app/api/integrations/mercadolivre/notifications

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

// GET /api/integrations/mercadolivre/diagnostico
router.get("/mercadolivre/diagnostico", requireIntegrationAdmin, async (_req, res) => {
  try {
    const token = await getMercadoLivreAccessToken();
    const response = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { accept: "application/json", authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    return res.json({
      teste: "users/me",
      httpStatus: response.status,
      ...(response.ok
        ? { userId: data.id, nickname: data.nickname, siteId: data.site_id }
        : { error: data.error, message: data.message, cause: data.cause })
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Falha no diagnóstico."
    });
  }
});

// Consulta de diagnóstico: não grava nem importa produtos.
router.get("/mercadolivre/teste-vendedor", requireIntegrationAdmin, async (_req, res) => {
  try {
    const token = await getMercadoLivreAccessToken();

    const meResponse = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000)
    });
    const meText = await meResponse.text();
    let me = {};
    try { me = JSON.parse(meText); } catch {}

    if (!meResponse.ok || !me?.id) {
      return res.status(200).json({
        teste: "busca por vendedor autenticado",
        etapa: "/users/me",
        httpStatus: meResponse.status,
        ok: false,
        error: me.error,
        message: me.message,
        cause: me.cause
      });
    }

    const url = new URL(`https://api.mercadolibre.com/users/${me.id}/items/search`);
    url.searchParams.set("limit", "5");

    const response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000)
    });

    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}

    if (!response.ok) {
      return res.status(200).json({
        teste: "busca por vendedor autenticado",
        conta: { userId: me.id, nickname: me.nickname, siteId: me.site_id },
        etapa: `/users/${me.id}/items/search`,
        httpStatus: response.status,
        ok: false,
        error: data.error,
        message: data.message,
        cause: data.cause
      });
    }

    return res.json({
      teste: "busca por vendedor autenticado",
      conta: { userId: me.id, nickname: me.nickname, siteId: me.site_id },
      etapa: `/users/${me.id}/items/search`,
      httpStatus: response.status,
      ok: true,
      total: data.paging?.total ?? null,
      produtos: Array.isArray(data.results) ? data.results.slice(0, 5) : [],
      formatoValido: Array.isArray(data.results)
    });
  } catch (error) {
    return res.status(500).json({
      teste: "busca por vendedor autenticado",
      ok: false,
      error: error instanceof Error ? error.message : "Falha no teste do vendedor."
    });
  }
});

// Diagnóstico público temporário: valida somente o token OAuth salvo.
router.get("/mercadolivre/teste-item-publico", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const token = await getMercadoLivreAccessToken();

    const searchUrl = new URL("https://api.mercadolibre.com/sites/MLB/search");
    searchUrl.searchParams.set("q", "smart tv");
    searchUrl.searchParams.set("limit", "5");

    const searchResponse = await fetch(searchUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(20000)
    });

    const searchText = await searchResponse.text();
    let searchData = {};
    try { searchData = JSON.parse(searchText); } catch {}

    if (!searchResponse.ok) {
      return res.status(200).json({
        teste: "consulta catálogo público Mercado Livre",
        etapa: "busca pública",
        httpStatus: searchResponse.status,
        ok: false,
        erro: searchData.message || searchData.error || "A API recusou a busca."
      });
    }

    const ids = Array.isArray(searchData.results)
      ? searchData.results.map(String).filter(Boolean).slice(0, 5)
      : [];

    const bulkUrl = new URL("https://api.mercadolibre.com/items/bulk");
    if (ids.length) bulkUrl.searchParams.set("ids", ids.join(","));

    const bulkResponse = ids.length
      ? await fetch(bulkUrl, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`
          },
          signal: AbortSignal.timeout(20000)
        })
      : null;

    const bulkText = bulkResponse ? await bulkResponse.text() : "";
    let bulkData = [];
    try { bulkData = bulkText ? JSON.parse(bulkText) : []; } catch {}

    if (bulkResponse && !bulkResponse.ok) {
      return res.status(200).json({
        teste: "consulta catálogo público Mercado Livre",
        etapa: "consulta em lote",
        httpStatus: bulkResponse.status,
        ok: false,
        ids,
        erro: bulkData?.message || bulkData?.error || "A API recusou a consulta em lote."
      });
    }

    const produtos = Array.isArray(bulkData)
      ? bulkData.map((entry) => {
          const body = entry?.body || {};
          return {
            id: entry?.id ?? body.id ?? null,
            statusCode: entry?.status_code ?? entry?.code ?? null,
            titulo: body.title ?? null,
            preco: body.price ?? null,
            imagem: Boolean(
              body.pictures?.[0]?.secure_url ||
              body.pictures?.[0]?.url ||
              body.secure_thumbnail ||
              body.thumbnail
            )
          };
        })
      : [];

    return res.json({
      teste: "consulta catálogo público Mercado Livre",
      etapa: "consulta em lote",
      httpStatus: bulkResponse?.status ?? searchResponse.status,
      ok: true,
      totalResultados: searchData.paging?.total ?? null,
      ids,
      imagens: {
        encontrados: produtos.length,
        comImagem: produtos.filter((p) => p.imagem).length,
        semImagem: produtos.filter((p) => !p.imagem).length
      },
      produtos
    });
  } catch (error) {
    return res.status(500).json({
      teste: "consulta catálogo público Mercado Livre",
      ok: false,
      erro: error instanceof Error ? error.message : "Falha no teste."
    });
  }
});

// Diagnóstico temporário da aplicação Mercado Livre.
// Retorna somente estado/configuração não-secreta da aplicação.
router.get("/mercadolivre/teste-aplicacao", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const token = await getMercadoLivreAccessToken();
    const appId = process.env.MELI_APP_ID?.trim();

    if (!appId) {
      return res.status(500).json({
        teste: "detalhes da aplicação Mercado Livre",
        ok: false,
        erro: "MELI_APP_ID não configurado."
      });
    }

    const response = await fetch(`https://api.mercadolibre.com/applications/${appId}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(20000)
    });

    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}

    return res.status(200).json({
      teste: "detalhes da aplicação Mercado Livre",
      httpStatus: response.status,
      ok: response.ok,
      ...(response.ok
        ? {
            aplicacao: {
              id: data.id ?? null,
              siteId: data.site_id ?? null,
              ativa: data.active ?? null,
              sandbox: data.sandbox_mode ?? null,
              certificacao: data.certification_status ?? null,
              maxRequestsPorHora: data.max_requests_per_hour ?? null,
              scopes: data.scopes ?? data.scope ?? null
            }
          }
        : {
            erro: {
              error: data.error,
              message: data.message,
              cause: data.cause
            }
          })
    });
  } catch (error) {
    return res.status(500).json({
      teste: "detalhes da aplicação Mercado Livre",
      ok: false,
      erro: error instanceof Error ? error.message : "Falha ao consultar a aplicação."
    });
  }
});

// Diagnóstico individual protegido: não grava produtos nem links.
router.get("/mercadolivre/teste-item", requireIntegrationAdmin, async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const itemId = "MLB4714562299";
  try {
    const token = await getMercadoLivreAccessToken();
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: {
        accept: "application/json",
        "user-agent": "ComercioPopular/1.0",
        authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({
        teste: "consulta individual", itemId, httpStatus: response.status,
        formatoValido: false, error: "Resposta sem JSON válido."
      });
    }
    const valid = data !== null && typeof data === "object" && !Array.isArray(data);
    return res.json({
      teste: "consulta individual",
      recurso: `/items/${itemId}`,
      itemId,
      httpStatus: response.status,
      ...(response.ok ? {
        formatoValido: valid && data.id === itemId &&
          typeof data.title === "string" && data.title.trim().length > 0 &&
          typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0,
        produto: valid ? {
          id: data.id, title: data.title, price: data.price,
          currencyId: data.currency_id, status: data.status,
          availableQuantity: data.available_quantity,
          imageUrl: data.pictures?.[0]?.secure_url || data.secure_thumbnail || data.thumbnail,
          permalink: data.permalink
        } : null
      } : {
        error: valid ? data.error ?? "não informado" : "Formato inesperado",
        message: valid ? data.message ?? "não informada" : "Formato inesperado",
        cause: valid ? data.cause ?? [] : []
      })
    });
  } catch (error) {
    return res.status(500).json({
      teste: "consulta individual",
      error: error?.name === "TimeoutError"
        ? "A consulta excedeu 20 segundos."
        : "Falha ao obter credencial ou executar a consulta individual."
    });
  }
});

export default router;

