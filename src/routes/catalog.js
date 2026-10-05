import { affiliateLink } from "../integrations/shopee/feed-importer.js";
import { sheinAffiliateLink } from "../integrations/shein/feed-importer.js";
import express from 'express';
import pool from '../db/pool.js';

const router = express.Router();

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sanitizeLimit(value) {
  const parsed = parseNonNegativeInt(value, DEFAULT_LIMIT);
  return Math.min(parsed || DEFAULT_LIMIT, MAX_LIMIT);
}

// GET /api/catalog/products
// Catálogo público: não expõe affiliate_url/product_url diretamente.
router.get('/products', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const platform = typeof req.query.platform === 'string' ? req.query.platform.trim().toLowerCase() : '';
  const limit = sanitizeLimit(req.query.limit);
  const offset = parseNonNegativeInt(req.query.offset, 0);

  const values = [];
  const where = ["p.status = 'ativo'"];

  if (q) {
    values.push(`%${q}%`);
    where.push(`(
      p.title ILIKE $${values.length}
      OR COALESCE(p.description, '') ILIKE $${values.length}
      OR COALESCE(p.brand, '') ILIKE $${values.length}
    )`);
  }

  if (category) {
    values.push(category);
    where.push(`p.category = $${values.length}`);
  }

  if (platform) {
    values.push(platform);
    where.push(`EXISTS (
      SELECT 1
      FROM product_offers po_filter
      JOIN affiliate_platforms ap_filter ON ap_filter.id = po_filter.platform_id
      WHERE po_filter.product_id = p.id
        AND po_filter.is_active = TRUE
        AND ap_filter.is_active = TRUE
        AND ap_filter.code = $${values.length}
    )`);
  }

  values.push(limit, offset);
  const limitParam = values.length - 1;
  const offsetParam = values.length;

  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.title,
         p.description,
         p.price,
         p.image_url,
         p.category,
         p.brand,
         p.ean,
         p.slug,
         p.product_kind,
         p.stock_units,
         p.is_achadinho,
         p.status,
         p.created_at,
         p.updated_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', po.id,
             'offerType', po.offer_type,
             'platform', json_build_object(
               'code', ap.code,
               'name', ap.name,
               'logoUrl', ap.logo_url
             ),
             'externalId', po.external_id,
             'price', po.price,
             'originalPrice', po.original_price,
             'currency', po.currency,
             'stockUnits', po.stock_units,
             'availability', po.availability,
             'commissionRate', po.commission_rate,
             'sellerName', po.seller_name,
             'isFreeShipping', po.is_free_shipping,
             'isFastShipping', po.is_fast_shipping
           ) ORDER BY po.price NULLS LAST, ap.name)
           FROM product_offers po
           LEFT JOIN affiliate_platforms ap ON ap.id = po.platform_id
           WHERE po.product_id = p.id
             AND po.is_active = TRUE
             AND (po.platform_id IS NULL OR ap.is_active = TRUE)
         ), '[]'::json) AS offers
       FROM products p
       WHERE ${where.join(' AND ')}
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
       LIMIT $${limitParam}
       OFFSET $${offsetParam}`,
      values
    );

    res.json({
      products: result.rows,
      pagination: {
        limit,
        offset,
        returned: result.rows.length
      }
    });
  } catch (err) {
    console.error('Erro ao buscar catálogo:', err);
    res.status(500).json({ error: 'Erro ao carregar o catálogo.' });
  }
});

// GET /api/catalog/products/:id
// Detalhes públicos do produto + ofertas disponíveis.
router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.title,
         p.description,
         p.price,
         p.image_url,
         p.category,
         p.brand,
         p.ean,
         p.slug,
         p.product_kind,
         p.stock_units,
         p.is_achadinho,
         p.status,
         p.metadata,
         p.created_at,
         p.updated_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', po.id,
             'offerType', po.offer_type,
             'platform', json_build_object(
               'code', ap.code,
               'name', ap.name,
               'logoUrl', ap.logo_url
             ),
             'externalId', po.external_id,
             'price', po.price,
             'originalPrice', po.original_price,
             'currency', po.currency,
             'stockUnits', po.stock_units,
             'availability', po.availability,
             'commissionRate', po.commission_rate,
             'sellerName', po.seller_name,
             'isFreeShipping', po.is_free_shipping,
             'isFastShipping', po.is_fast_shipping,
             'syncStatus', po.sync_status,
             'lastSyncedAt', po.last_synced_at
           ) ORDER BY po.price NULLS LAST, ap.name)
           FROM product_offers po
           LEFT JOIN affiliate_platforms ap ON ap.id = po.platform_id
           WHERE po.product_id = p.id
             AND po.is_active = TRUE
             AND (po.platform_id IS NULL OR ap.is_active = TRUE)
         ), '[]'::json) AS offers
       FROM products p
       WHERE p.id = $1
         AND p.status = 'ativo'
       LIMIT 1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Erro ao buscar produto do catálogo:', err);
    res.status(500).json({ error: 'Erro ao carregar o produto.' });
  }
});

// GET /api/catalog/platforms
// Lista as plataformas afiliadas ativas para o frontend montar os filtros.
router.get('/platforms', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT code, name, logo_url AS "logoUrl", website_url AS "websiteUrl"
       FROM affiliate_platforms
       WHERE is_active = TRUE
       ORDER BY name`
    );

    res.json({ platforms: result.rows });
  } catch (err) {
    console.error('Erro ao buscar plataformas do catálogo:', err);
    res.status(500).json({ error: 'Erro ao carregar as plataformas.' });
  }
});

// Cada plataforma só libera links do seu próprio domínio de afiliado.
function validateStoredAffiliateLink(value) {
  for (const validate of [affiliateLink, sheinAffiliateLink]) {
    try {
      return validate(value);
    } catch {
      // tenta o próximo validador
    }
  }
  throw new Error('Link de afiliado não permitido.');
}

// Link de compra (Shopee e SHEIN): usa exclusivamente a oferta ativa armazenada.
router.get('/offers/:id/go', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: 'ID de oferta inválido.' });
  }
  try {
    const result = await pool.query(`SELECT po.affiliate_url FROM product_offers po
      JOIN affiliate_platforms ap ON ap.id=po.platform_id
      JOIN products p ON p.id=po.product_id
      WHERE po.id=$1 AND po.is_active=TRUE AND ap.is_active=TRUE
        AND ap.code IN ('shopee','shein') AND p.status='ativo' AND po.offer_type='afiliada'`, [req.params.id]);
    if (!result.rows[0]?.affiliate_url) return res.status(404).json({ error: 'Oferta indisponível.' });
    const link = validateStoredAffiliateLink(result.rows[0].affiliate_url);
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, link);
  } catch {
    return res.status(503).json({ error: 'Não foi possível abrir a oferta.' });
  }
});

export default router;
