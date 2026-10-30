import express from 'express';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { SITE_CATEGORIES } from '../integrations/core/site-category-resolver.js';

const router = express.Router();

const PLAN_LIMITS = { iniciante: 25, pro: Infinity, empresa: Infinity };
const VIDEO_LIMIT_BYTES = 20 * 1024 * 1024;
const VIDEO_STORAGE_DIR = process.env.PRODUCT_VIDEO_STORAGE_DIR || '/data/shopee-images/product-videos';
const VIDEO_PUBLIC_PREFIX = '/product-media/videos/';

async function findActiveSeller(userId) {
  const result = await pool.query(
    `SELECT s.id, s.user_id, s.store_name, s.plan, s.plan_status,
            s.verification_status, s.verification_badge, s.verified_at
       FROM sellers s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1 AND u.is_seller = TRUE AND s.plan_status = 'active'
      LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function requireSeller(req, res, next) {
  try {
    const seller = await findActiveSeller(req.userId);
    if (!seller) return res.status(403).json({ error: 'Sua conta ainda não tem um plano de vendedor ativo.' });
    req.seller = seller;
    next();
  } catch (error) {
    console.error('Erro ao validar vendedor:', error);
    return res.status(500).json({ error: 'Não foi possível validar o acesso do vendedor.' });
  }
}

function clean(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function normalizeProduct(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    price: Number(row.price),
    stockUnits: Number(row.stock_units || 0),
    category: row.category || 'Outros',
    imageUrl: row.image_url || '',
    videoUrl: row.video_url || '',
    status: row.status || 'ativo',
    createdAt: row.created_at,
  };
}

router.use(requireAuth, requireSeller);

router.get('/dashboard', async (req, res) => {
  try {
    const [products, orders, metrics] = await Promise.all([
      pool.query(
        `SELECT id, title, description, price, stock_units, category, image_url, video_url, status, created_at
           FROM products WHERE seller_id = $1 AND source = 'proprio'
          ORDER BY created_at DESC`,
        [req.seller.id],
      ),
      pool.query(
        `SELECT o.id, o.status, o.total, o.created_at, o.tracking_code,
                u.name AS customer_name, u.email AS customer_email,
                COALESCE(json_agg(json_build_object(
                  'title', oi.title, 'quantity', oi.quantity,
                  'unitPrice', oi.unit_price
                ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id AND oi.seller_id = $1
           JOIN users u ON u.id = o.user_id
          GROUP BY o.id, u.name, u.email
          ORDER BY o.created_at DESC
          LIMIT 100`,
        [req.seller.id],
      ),
      pool.query(
        `SELECT
            (SELECT COUNT(DISTINCT oi.order_id)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.seller_id = $1 AND o.status IN ('pago','em_preparacao','enviado','entregue')) AS sales_count,
            (SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)::numeric FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.seller_id = $1 AND o.status IN ('pago','em_preparacao','enviado','entregue')) AS revenue,
            (SELECT COUNT(DISTINCT oi.order_id)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.seller_id = $1 AND o.status IN ('pago','em_preparacao')) AS open_orders,
            (SELECT COUNT(*)::int FROM products WHERE seller_id = $1 AND source = 'proprio' AND status = 'ativo') AS active_products`,
        [req.seller.id],
      ),
    ]);

    const metric = metrics.rows[0] || {};
    return res.json({
      seller: req.seller,
      stats: {
        salesCount: Number(metric.sales_count || 0),
        revenue: Number(metric.revenue || 0),
        openOrders: Number(metric.open_orders || 0),
        activeProducts: Number(metric.active_products || 0),
      },
      products: products.rows.map(normalizeProduct),
      orders: orders.rows,
    });
  } catch (error) {
    console.error('Erro ao carregar painel do vendedor:', error);
    return res.status(500).json({ error: 'Não foi possível carregar o painel do vendedor.' });
  }
});

router.post('/products/:id/video',
  async (req, res, next) => {
    try {
      const product = await pool.query(
        "SELECT id, video_url FROM products WHERE id = $1 AND seller_id = $2 AND source = 'proprio' LIMIT 1",
        [req.params.id, req.seller.id],
      );
      if (!product.rows[0]) return res.status(404).json({ error: 'Produto não encontrado para esta loja.' });
      req.product = product.rows[0];
      return next();
    } catch (error) {
      console.error('Erro ao validar produto para vídeo:', error);
      return res.status(500).json({ error: 'Não foi possível validar o produto.' });
    }
  },
  express.raw({ type: ['video/mp4', 'video/webm'], limit: '20mb' }),
  async (req, res) => {
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const file = req.body;
    if (!Buffer.isBuffer(file) || file.length === 0) {
      return res.status(415).json({ error: 'Envie um arquivo MP4 ou WebM.' });
    }
    if (file.length > VIDEO_LIMIT_BYTES) {
      return res.status(413).json({ error: 'O vídeo deve ter no máximo 20 MB.' });
    }
    const isMp4 = mimeType === 'video/mp4' && file.length > 12 && file.subarray(4, 8).toString('ascii') === 'ftyp';
    const isWebm = mimeType === 'video/webm' && file.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!isMp4 && !isWebm) {
      return res.status(415).json({ error: 'O conteúdo não corresponde a um vídeo MP4 ou WebM válido.' });
    }

    const extension = isMp4 ? 'mp4' : 'webm';
    const fileName = randomUUID() + '.' + extension;
    const filePath = path.join(VIDEO_STORAGE_DIR, fileName);
    try {
      await mkdir(VIDEO_STORAGE_DIR, { recursive: true });
      await writeFile(filePath, file, { flag: 'wx' });
      const videoUrl = VIDEO_PUBLIC_PREFIX + fileName;
      const updated = await pool.query(
        "UPDATE products SET video_url = $1, updated_at = now() WHERE id = $2 AND seller_id = $3 AND source = 'proprio' RETURNING id, title, description, price, stock_units, category, image_url, video_url, status, created_at",
        [videoUrl, req.product.id, req.seller.id],
      );
      if (!updated.rows[0]) {
        await unlink(filePath).catch(() => {});
        return res.status(404).json({ error: 'Produto não encontrado para esta loja.' });
      }

      const oldVideo = req.product.video_url;
      if (typeof oldVideo === 'string' && oldVideo.startsWith(VIDEO_PUBLIC_PREFIX)) {
        const oldFileName = path.basename(oldVideo);
        if (/^[a-f0-9-]+\.(mp4|webm)$/i.test(oldFileName) && oldFileName !== fileName) {
          await unlink(path.join(VIDEO_STORAGE_DIR, oldFileName)).catch(() => {});
        }
      }
      return res.json({ product: normalizeProduct(updated.rows[0]) });
    } catch (error) {
      await unlink(filePath).catch(() => {});
      console.error('Erro ao armazenar vídeo do produto:', error);
      return res.status(500).json({ error: 'Não foi possível armazenar o vídeo. Confirme o armazenamento persistente do servidor.' });
    }
  },
);
router.post('/products', async (req, res) => {
  const title = clean(req.body?.title, 255);
  const description = clean(req.body?.description, 5000);
  const category = clean(req.body?.category, 100);
  const imageUrl = clean(req.body?.imageUrl, 1000);
  const price = Number(req.body?.price);
  const stockUnits = Number(req.body?.stockUnits);
  if (!title || !category || !SITE_CATEGORIES.includes(category) || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stockUnits) || stockUnits < 0) {
    return res.status(400).json({ error: 'Informe título, categoria, preço e estoque válidos.' });
  }

  try {
    const limit = PLAN_LIMITS[req.seller.plan] ?? 0;
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM products WHERE seller_id = $1 AND source = 'proprio' AND status = 'ativo'`, [req.seller.id]);
    if (Number.isFinite(limit) && Number(count.rows[0].total) >= limit) {
      return res.status(409).json({ error: `Seu plano permite até ${limit} produtos ativos.` });
    }
    const result = await pool.query(
      `INSERT INTO products (seller_id, source, title, description, price, image_url, category, stock_units, status, updated_at)
       VALUES ($1, 'proprio', $2, $3, $4, $5, $6, $7, 'ativo', now())
       RETURNING id, title, description, price, stock_units, category, image_url, status, created_at`,
      [req.seller.id, title, description, price, imageUrl || null, category, stockUnits],
    );
    return res.status(201).json({ product: normalizeProduct(result.rows[0]) });
  } catch (error) {
    console.error('Erro ao criar produto do vendedor:', error);
    return res.status(500).json({ error: 'Não foi possível cadastrar o produto.' });
  }
});

router.patch('/products/:id', async (req, res) => {
  const title = clean(req.body?.title, 255);
  const description = clean(req.body?.description, 5000);
  const category = clean(req.body?.category, 100);
  const imageUrl = clean(req.body?.imageUrl, 1000);
  const price = Number(req.body?.price);
  const stockUnits = Number(req.body?.stockUnits);
  const status = ['ativo', 'pausado'].includes(req.body?.status) ? req.body.status : 'ativo';
  if (!title || !category || !SITE_CATEGORIES.includes(category) || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stockUnits) || stockUnits < 0) {
    return res.status(400).json({ error: 'Informe título, categoria, preço e estoque válidos.' });
  }
  try {
    const result = await pool.query(
      `UPDATE products SET title = $1, description = $2, price = $3, image_url = $4,
              category = $5, stock_units = $6, status = $7, updated_at = now()
        WHERE id = $8 AND seller_id = $9 AND source = 'proprio'
        RETURNING id, title, description, price, stock_units, category, image_url, status, created_at`,
      [title, description, price, imageUrl || null, category, stockUnits, status, req.params.id, req.seller.id],
    );
    if (result.rowCount !== 1) return res.status(404).json({ error: 'Produto não encontrado.' });
    return res.json({ product: normalizeProduct(result.rows[0]) });
  } catch (error) {
    console.error('Erro ao atualizar produto do vendedor:', error);
    return res.status(500).json({ error: 'Não foi possível atualizar o produto.' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE products SET status = 'pausado', updated_at = now()
        WHERE id = $1 AND seller_id = $2 AND source = 'proprio'`,
      [req.params.id, req.seller.id],
    );
    if (result.rowCount !== 1) return res.status(404).json({ error: 'Produto não encontrado.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao pausar produto do vendedor:', error);
    return res.status(500).json({ error: 'Não foi possível remover o produto.' });
  }
});

router.patch('/orders/:id', async (req, res) => {
  const allowedStatuses = ['pago', 'em_preparacao', 'enviado', 'entregue', 'cancelado'];
  const status = allowedStatuses.includes(req.body?.status) ? req.body.status : null;
  const trackingCode = clean(req.body?.trackingCode, 80) || null;
  if (!status) return res.status(400).json({ error: 'Status de pedido inválido.' });
  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1, tracking_code = COALESCE($2, tracking_code), updated_at = now()
        WHERE id = $3 AND EXISTS (SELECT 1 FROM order_items WHERE order_id = orders.id AND seller_id = $4)
        RETURNING id, status, tracking_code`,
      [status, trackingCode, req.params.id, req.seller.id],
    );
    if (result.rowCount !== 1) return res.status(404).json({ error: 'Pedido não encontrado para esta loja.' });
    return res.json({ order: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar pedido do vendedor:', error);
    return res.status(500).json({ error: 'Não foi possível atualizar o pedido.' });
  }
});

export default router;



