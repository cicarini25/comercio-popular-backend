import express from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const PLAN_LIMITS = { iniciante: 25, pro: Infinity, empresa: Infinity };

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
    status: row.status || 'ativo',
    createdAt: row.created_at,
  };
}

router.use(requireAuth, requireSeller);

router.get('/dashboard', async (req, res) => {
  try {
    const [products, orders, metrics] = await Promise.all([
      pool.query(
        `SELECT id, title, description, price, stock_units, category, image_url, status, created_at
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

router.post('/products', async (req, res) => {
  const title = clean(req.body?.title, 255);
  const description = clean(req.body?.description, 5000);
  const category = clean(req.body?.category, 100);
  const imageUrl = clean(req.body?.imageUrl, 1000);
  const price = Number(req.body?.price);
  const stockUnits = Number(req.body?.stockUnits);
  if (!title || !category || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stockUnits) || stockUnits < 0) {
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
  if (!title || !category || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stockUnits) || stockUnits < 0) {
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

