import express from 'express';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ensureMarketplaceSchema,
  getSellerAccessToken,
  getSellerAccountBySellerId,
  marketplaceFee,
  sellerAmount,
  splitEnabled,
  verifyWebhookSignature,
} from '../integrations/mercadopago/marketplace.js';

const router = express.Router();

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// POST /api/orders — cria o pedido no banco + a preferência de pagamento no Mercado Pago
router.post('/', requireAuth, async (req, res) => {
  const { items, shippingFee = 0 } = req.body;
  // items: [{ productId, title, unitPrice, quantity, sellerId }]

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'O carrinho está vazio.' });
  }

  if (!process.env.MERCADOPAGO_ACCESS_TOKEN && !splitEnabled()) {
    return res.status(503).json({ error: 'Pagamento ainda não configurado no servidor.' });
  }

  const normalizedShippingFee = Number(shippingFee);
  if (!Number.isFinite(normalizedShippingFee) || normalizedShippingFee < 0) {
    return res.status(400).json({ error: 'Valor de frete inválido.' });
  }

  if (items.some((item) => !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0 || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)) {
    return res.status(400).json({ error: 'Há um item com preço ou quantidade inválidos.' });
  }

  const sellerIds = [...new Set(items.map((item) => item.sellerId).filter(Boolean))];
  if (sellerIds.length !== 1 || items.some((item) => !item.sellerId)) {
    return res.status(400).json({ error: 'Cada pedido deve conter produtos de um único vendedor.' });
  }

  const client = await pool.connect();
  try {
    await ensureMarketplaceSchema();
    await client.query('BEGIN');

    const productIds = [...new Set(items.map((item) => item.productId).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id))))];
    if (productIds.length !== new Set(items.map((item) => item.productId)).size) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Há um produto inválido no pedido.' });
    }
    const productResult = await client.query(
      `SELECT p.id, p.title, p.price, p.stock_units, p.seller_id, p.status
         FROM products p
        WHERE p.id = ANY($1::uuid[]) AND p.source = 'proprio'
        FOR UPDATE`,
      [productIds],
    );
    const productsById = new Map(productResult.rows.map((product) => [String(product.id), product]));
    const canonicalItems = items.map((item) => {
      const product = productsById.get(String(item.productId));
      if (!product || String(product.seller_id) !== String(sellerIds[0]) || product.status !== 'ativo') return null;
      if (Number(product.stock_units) < Number(item.quantity)) return null;
      if (Number(product.price).toFixed(2) !== Number(item.unitPrice).toFixed(2)) return null;
      return { ...item, title: product.title, unitPrice: Number(product.price), sellerId: product.seller_id };
    });
    if (canonicalItems.some((item) => !item)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Um produto mudou de preço, estoque ou disponibilidade. Atualize a sacola.' });
    }

    const subtotal = canonicalItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const total = subtotal + normalizedShippingFee;
    const sellerAccount = splitEnabled() ? await getSellerAccountBySellerId(sellerIds[0]) : null;
    if (splitEnabled() && !sellerAccount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este vendedor ainda não conectou uma conta Mercado Pago para receber pagamentos.' });
    }
    const platformFee = splitEnabled() ? marketplaceFee(subtotal) : 0;
    const sellerNet = sellerAmount(total, platformFee);

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, subtotal, shipping_fee, total, status)
       VALUES ($1, $2, $3, $4, 'aguardando_pagamento')
       RETURNING id`,
      [req.userId, subtotal, normalizedShippingFee, total]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of canonicalItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, seller_id, title, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.productId || null, item.sellerId || null, item.title, item.unitPrice, item.quantity]
      );
    }

    // No split 1:1 o Checkout Pro é criado com o OAuth do vendedor.
    const checkoutAccessToken = sellerAccount ? await getSellerAccessToken(sellerAccount) : process.env.MERCADOPAGO_ACCESS_TOKEN;
    const preferenceClient = new MercadoPagoConfig({ accessToken: checkoutAccessToken });
    const preference = new Preference(preferenceClient);
    const mpResponse = await preference.create({
      body: {
        items: canonicalItems.map((i) => ({
          title: i.title,
          quantity: i.quantity,
          unit_price: Number(i.unitPrice),
          currency_id: 'BRL'
        })),
        shipments: {
          cost: normalizedShippingFee,
          mode: 'not_specified'
        },
        ...(splitEnabled() ? { marketplace_fee: platformFee } : {}),
        external_reference: orderId,
        back_urls: {
          success: `${process.env.FRONTEND_URL}/pedido/${orderId}/sucesso`,
          failure: `${process.env.FRONTEND_URL}/pedido/${orderId}/falha`,
          pending: `${process.env.FRONTEND_URL}/pedido/${orderId}/pendente`
        },
        auto_return: 'approved',
        notification_url: `${process.env.BACKEND_PUBLIC_URL}/api/orders/webhook/mercadopago${splitEnabled() ? `?seller_id=${encodeURIComponent(sellerIds[0])}` : ''}`
      }
    });

    await client.query(
      'UPDATE orders SET mp_preference_id = $1, mp_seller_account_id = $2, marketplace_fee = $3 WHERE id = $4',
      [mpResponse.id, sellerAccount?.id || null, platformFee, orderId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      orderId,
      checkoutUrl: mpResponse.init_point, // link para redirecionar o cliente ao pagamento
      preferenceId: mpResponse.id,
      split: splitEnabled() ? { enabled: true, marketplaceFee: platformFee, sellerNet } : { enabled: false },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar pedido/pagamento:', err);
    res.status(500).json({ error: 'Erro ao processar o pedido. Tente novamente.' });
  } finally {
    client.release();
  }
});

// GET /api/orders — lista os pedidos do usuário logado
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, json_agg(oi.*) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.userId]
    );
    res.json({ orders: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar pedidos.' });
  }
});

// POST /api/orders/webhook/mercadopago — o Mercado Pago chama essa rota automaticamente
// quando o status de um pagamento muda (aprovado, recusado, etc.)
router.post('/webhook/mercadopago', async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) return res.sendStatus(401);
    const { type, data } = req.body;

    if (type === 'payment') {
      let paymentClient = mpClient;
      if (splitEnabled() && req.query.seller_id) {
        const sellerAccount = await getSellerAccountBySellerId(req.query.seller_id);
        if (!sellerAccount) return res.sendStatus(409);
        paymentClient = new MercadoPagoConfig({ accessToken: await getSellerAccessToken(sellerAccount) });
      }
      const payment = new Payment(paymentClient);
      const paymentInfo = await payment.get({ id: data.id });

      const orderId = paymentInfo.external_reference;
      const status = paymentInfo.status; // approved, pending, rejected...

      const statusMap = {
        approved: 'pago',
        pending: 'aguardando_pagamento',
        rejected: 'cancelado'
      };

      await pool.query(
        `UPDATE orders SET status = $1, mp_payment_id = $2, updated_at = now() WHERE id = $3`,
        [statusMap[status] || 'aguardando_pagamento', paymentInfo.id, orderId]
      );
    }

    res.sendStatus(200); // o Mercado Pago exige resposta 200 rápida
  } catch (err) {
    console.error('Erro no webhook do Mercado Pago:', err);
    res.sendStatus(500);
  }
});

export default router;

