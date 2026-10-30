import { affiliateLink } from "../integrations/shopee/feed-importer.js";
import { sheinAffiliateLink } from "../integrations/shein/feed-importer.js";
import express from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { ACCESSORY_TITLE_PATTERNS, COMPLETE_APPLIANCE_TITLE_PATTERNS } from '../catalog-category-overrides.js';
import { AUDITED_PRODUCT_CATEGORY_OVERRIDES } from '../catalog-product-category-overrides.js';
import { SITE_CATEGORIES, SITE_CATEGORY_TREE, resolveSiteCategory } from '../integrations/core/site-category-resolver.js';

const router = express.Router();

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 60;

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sanitizeLimit(value) {
  const parsed = parseNonNegativeInt(value, DEFAULT_LIMIT);
  return Math.min(parsed || DEFAULT_LIMIT, MAX_LIMIT);
}

function buildEffectiveCategorySql(auditedCategoryOverridesParam, accessoryTitlesParam, completeApplianceTitlesParam) {
  const normalizedTitle = "translate(lower(COALESCE(p.title, '') || ' ' || COALESCE(p.description, '')), 'áàãâäéêëíîïóôöõúùüç', 'aaaaaeeeiiiooouuuc')";
  const computerSignal = normalizedTitle + " ~ '(computador|desktop|pc gamer|placa mae|placa de video|memoria ram|processador (intel|amd|ryzen)|ssd nvme|gabinete gamer|monitor para (computador|pc)|monitor gamer|mouse gamer|mouse para jogos|teclado (mecanico|gamer)|webcam para pc|adaptador bluetooth para pc)'";
  const rawCategory = "(CASE WHEN p.source = 'proprio' THEN p.category " +
    "WHEN ($" + auditedCategoryOverridesParam + "::jsonb ? p.id::text) THEN $" +
    auditedCategoryOverridesParam + "::jsonb ->> p.id::text " +
    "WHEN " + computerSignal + " THEN 'Informática' " +
    "WHEN p.category = 'Eletrodomésticos' AND lower(trim(p.title)) LIKE ANY($" +
    accessoryTitlesParam + "::text[]) THEN 'ELETRO & ACESSÓRIOS' " +
    "WHEN p.category = 'ELETRO & ACESSÓRIOS' AND lower(trim(p.title)) LIKE ANY($" +
    completeApplianceTitlesParam + "::text[]) THEN 'Eletrodomésticos' ELSE p.category END)";

  return "(CASE " + rawCategory +
    " WHEN 'Utilidades' THEN 'Casa & Cozinha'" +
    " WHEN 'Computadores' THEN 'Informática'" +
    " WHEN 'Notebook' THEN 'Informática'" +
    " ELSE " + rawCategory + " END)";
}
router.get('/products', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const platform = typeof req.query.platform === 'string' ? req.query.platform.trim().toLowerCase() : '';
  const limit = sanitizeLimit(req.query.limit);
  const offset = parseNonNegativeInt(req.query.offset, 0);

  const values = [];
  const where = ["p.status = 'ativo'"];
  const affiliateCatalogFilter = "EXISTS (SELECT 1 FROM product_offers po_catalog " +
    "JOIN affiliate_platforms ap_catalog ON ap_catalog.id = po_catalog.platform_id " +
    "WHERE po_catalog.product_id = p.id AND po_catalog.is_active = TRUE " +
    "AND po_catalog.offer_type = 'afiliada' AND ap_catalog.is_active = TRUE " +
    "AND ap_catalog.code = ANY(ARRAY['shopee', 'shein', 'aliexpress']::text[]))";
  const sellerCatalogFilter = "(p.source = 'proprio' AND p.seller_id IS NOT NULL " +
    "AND COALESCE(p.stock_units, 0) > 0 AND EXISTS (" +
    "SELECT 1 FROM sellers s JOIN users seller_user ON seller_user.id = s.user_id " +
    "WHERE s.id = p.seller_id AND s.plan_status = 'active' " +
    "AND s.verification_status = 'verified' AND seller_user.is_seller = TRUE))";
  where.push("(" + sellerCatalogFilter + " OR " + affiliateCatalogFilter + ")");
  values.push(ACCESSORY_TITLE_PATTERNS);
  const accessoryTitlesParam = values.length;
  values.push(COMPLETE_APPLIANCE_TITLE_PATTERNS);
  const completeApplianceTitlesParam = values.length;
  values.push(JSON.stringify(AUDITED_PRODUCT_CATEGORY_OVERRIDES));
  const auditedCategoryOverridesParam = values.length;
  const effectiveCategorySql = buildEffectiveCategorySql(
    auditedCategoryOverridesParam,
    accessoryTitlesParam,
    completeApplianceTitlesParam,
  );

  if (q) {
    const normalizedQuery = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    values.push('%' + normalizedQuery + '%');
    const searchTextSql = "translate(lower(COALESCE(p.title, '') || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.ean, '')), 'áàãâäéêëíîïóôöõúùüç', 'aaaaaeeeiiiooouuuc')";
    where.push(searchTextSql + " LIKE $" + values.length);
  }
  if (category) {
    values.push(category);
    where.push(`${effectiveCategorySql} = $${values.length}`);
  }

  if (platform) {
    values.push(platform);
    where.push(`EXISTS (
      SELECT 1
      FROM product_offers po_filter
      JOIN affiliate_platforms ap_filter ON ap_filter.id = po_filter.platform_id
      WHERE po_filter.product_id = p.id
        AND po_filter.is_active = TRUE
        AND po_filter.offer_type = 'afiliada'
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
         p.source,
         p.seller_id,
         s.store_name AS seller_store_name,
         s.plan AS seller_plan,
         s.verification_status AS seller_verification_status,
         s.verified_at AS seller_verified_at,
         p.title,
         p.description,
         p.price,
         p.image_url,
         p.video_url,
         ${effectiveCategorySql} AS category,
         p.brand,
         p.ean,
         p.slug,
         p.product_kind,
         p.stock_units,
         p.is_achadinho,
         p.status,
         p.created_at,
         p.updated_at,
         COUNT(*) OVER() AS total_count,
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
             AND po.offer_type = 'afiliada'
             AND (po.platform_id IS NULL OR ap.is_active = TRUE)
         ), '[]'::json) AS offers
       FROM products p
       LEFT JOIN sellers s ON s.id = p.seller_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
       LIMIT $${limitParam}
       OFFSET $${offsetParam}`,
      values
    );

    const products = result.rows.map((row) => {
      const auditedCategory = row.source === 'proprio'
        ? undefined
        : AUDITED_PRODUCT_CATEGORY_OVERRIDES[row.id];
      return {
        ...row,
        category: auditedCategory || resolveSiteCategory({
          category: row.category,
          title: row.title,
          description: row.description,
          categoryOverride: auditedCategory,
        }) || row.category,
        total_count: Number(row.total_count || 0),
      };
    });
    const total = products.length ? products[0].total_count : 0;
    res.json({
      products,
      pagination: {
        limit,
        offset,
        returned: products.length,
        total,
        hasMore: offset + products.length < total,
      }
    });
  } catch (err) {
    console.error('Erro ao buscar catálogo:', err);
    res.status(500).json({ error: 'Erro ao carregar o catálogo.' });
  }
});

const AFFILIATE_HOSTS = {
  shopee: ['shopee.com.br', 'shope.ee'],
  shein: ['shein.com', 'shein.top'],
  aliexpress: ['aliexpress.com', 'aliexpress.us'],
};

router.get('/offers/:id/go', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await pool.query(
      `SELECT po.affiliate_url, ap.code AS platform_code
         FROM product_offers po
         JOIN affiliate_platforms ap ON ap.id = po.platform_id
         JOIN products p ON p.id = po.product_id
        WHERE po.id = $1
          AND po.is_active = TRUE
          AND po.offer_type = 'afiliada'
          AND ap.is_active = TRUE
          AND p.status = 'ativo'
        LIMIT 1`,
      [req.params.id]
    );
    const offer = result.rows[0];
    if (!offer) return res.status(404).json({ error: 'Oferta indisponível.' });

    let destination;
    try { destination = new URL(offer.affiliate_url); } catch {
      return res.status(410).json({ error: 'Esta oferta não tem um destino válido.' });
    }
    const allowedHosts = AFFILIATE_HOSTS[offer.platform_code] || [];
    const allowed = destination.protocol === 'https:' && !destination.username && !destination.password &&
      allowedHosts.some((host) => destination.hostname === host || destination.hostname.endsWith('.' + host));
    if (!allowed) return res.status(410).json({ error: 'O destino desta oferta não é reconhecido como uma loja parceira.' });

    return res.json({ redirectUrl: destination.href });
  } catch (error) {
    console.error('Erro ao liberar oferta afiliada:', error);
    return res.status(500).json({ error: 'Não foi possível abrir esta oferta.' });
  }
});
router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.source, p.seller_id, s.store_name AS seller_store_name, s.plan AS seller_plan, s.verification_status AS seller_verification_status, s.verified_at AS seller_verified_at, p.title, p.description, p.price, p.image_url, p.video_url, p.category, p.brand, p.ean, p.slug, p.product_kind, p.stock_units, p.is_achadinho, p.status, p.metadata, p.created_at, p.updated_at,
         COALESCE((
           SELECT json_agg(json_build_object('id', po.id, 'offerType', po.offer_type, 'platform', json_build_object('code', ap.code, 'name', ap.name, 'logoUrl', ap.logo_url), 'externalId', po.external_id, 'price', po.price, 'originalPrice', po.original_price, 'currency', po.currency, 'stockUnits', po.stock_units, 'availability', po.availability, 'commissionRate', po.commission_rate, 'sellerName', po.seller_name, 'isFreeShipping', po.is_free_shipping, 'isFastShipping', po.is_fast_shipping, 'syncStatus', po.sync_status, 'lastSyncedAt', po.last_synced_at) ORDER BY po.price NULLS LAST, ap.name)
           FROM product_offers po LEFT JOIN affiliate_platforms ap ON ap.id = po.platform_id WHERE po.product_id = p.id AND po.is_active = TRUE AND (po.platform_id IS NULL OR ap.is_active = TRUE)
         ), '[]'::json) AS offers
       FROM products p
       LEFT JOIN sellers s ON s.id = p.seller_id
       LEFT JOIN users seller_user ON seller_user.id = s.user_id
       WHERE p.id = $1 AND p.status = 'ativo'
         AND (p.source <> 'proprio' OR (COALESCE(p.stock_units, 0) > 0 AND s.plan_status = 'active' AND s.verification_status = 'verified' AND seller_user.is_seller = TRUE))
       LIMIT 1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    const product = result.rows[0];
    res.json({
      product: {
        ...product,
        category: resolveSiteCategory({
          category: product.category,
          title: product.title,
          description: product.description,
          categoryOverride: product.source === 'proprio'
            ? undefined
            : AUDITED_PRODUCT_CATEGORY_OVERRIDES[product.id],
        }) || product.category,
      },
    });
  } catch (err) {
    console.error('Erro ao buscar produto do catálogo:', err);
    res.status(500).json({ error: 'Erro ao carregar o produto.' });
  }
});

router.get('/categories', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return res.json({ categories: SITE_CATEGORIES, groups: SITE_CATEGORY_TREE });
});

router.get('/facets', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
  const values = [
    JSON.stringify(AUDITED_PRODUCT_CATEGORY_OVERRIDES),
    ACCESSORY_TITLE_PATTERNS,
    COMPLETE_APPLIANCE_TITLE_PATTERNS,
  ];
  const categorySql = buildEffectiveCategorySql(1, 2, 3);

  try {
    const [counts, bounds] = await Promise.all([
      pool.query(
        "SELECT " + categorySql + " AS category, COUNT(DISTINCT p.id)::int AS count " +
        "FROM products p WHERE p.status = 'ativo' AND (" +
        "EXISTS (SELECT 1 FROM product_offers po JOIN affiliate_platforms ap ON ap.id = po.platform_id " +
        "WHERE po.product_id = p.id AND po.is_active = TRUE AND po.offer_type = 'afiliada' " +
        "AND ap.is_active = TRUE AND ap.code = ANY(ARRAY['shopee', 'shein', 'aliexpress']::text[])) " +
        "OR (p.source = 'proprio' AND p.seller_id IS NOT NULL AND COALESCE(p.stock_units, 0) > 0 " +
        "AND EXISTS (SELECT 1 FROM sellers s JOIN users seller_user ON seller_user.id = s.user_id " +
        "WHERE s.id = p.seller_id AND s.plan_status = 'active' AND s.verification_status = 'verified' AND seller_user.is_seller = TRUE))) " +
        "GROUP BY " + categorySql,
        values,
      ),
      pool.query(
        "SELECT MIN(price)::numeric AS min_price, MAX(price)::numeric AS max_price FROM (" +
        "SELECT po.price FROM products p JOIN product_offers po ON po.product_id = p.id " +
        "JOIN affiliate_platforms ap ON ap.id = po.platform_id " +
        "WHERE p.status = 'ativo' AND po.is_active = TRUE AND po.offer_type = 'afiliada' " +
        "AND ap.is_active = TRUE AND ap.code = ANY(ARRAY['shopee', 'shein', 'aliexpress']::text[]) " +
        "UNION ALL SELECT p.price FROM products p JOIN sellers s ON s.id = p.seller_id JOIN users seller_user ON seller_user.id = s.user_id " +
        "WHERE p.status = 'ativo' AND p.source = 'proprio' AND COALESCE(p.stock_units, 0) > 0 " +
        "AND s.plan_status = 'active' AND s.verification_status = 'verified' AND seller_user.is_seller = TRUE) catalog_prices",
      ),
    ]);
    const categoryCounts = Object.fromEntries(
      counts.rows.map((row) => [row.category, Number(row.count)]),
    );
    const range = bounds.rows[0] || {};
    return res.json({
      categories: SITE_CATEGORIES,
      groups: SITE_CATEGORY_TREE,
      categoryCounts,
      priceBounds: {
        min: Number(range.min_price || 0),
        max: Number(range.max_price || 0),
      },
    });
  } catch (error) {
    console.error('Erro ao carregar filtros do catálogo:', error);
    return res.status(500).json({ error: 'Não foi possível carregar os filtros do catálogo.' });
  }
});
router.get('/platforms', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT code, name, logo_url AS "logoUrl", website_url AS "websiteUrl" FROM affiliate_platforms WHERE is_active = TRUE ORDER BY name`);
    res.json({ platforms: result.rows });
  } catch (err) {
    console.error('Erro ao buscar plataformas do catálogo:', err);
    res.status(500).json({ error: 'Erro ao carregar as plataformas.' });
  }
});

function validateStoredAffiliateLink(value, platformCode) {
  const validate = platformCode === 'shopee' ? affiliateLink : platformCode === 'shein' ? sheinAffiliateLink : null;
  if (!validate) throw new Error('Plataforma de afiliado não permitida');
  return validate(value);
}

export default router;

