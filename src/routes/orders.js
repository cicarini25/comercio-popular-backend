import express from 'express';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const total = subtotal + Number(shippingFee);

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, subtotal, shipping_fee, total, status)
       VALUES ($1, $2, $3, $4, 'aguardando_pagamento')
       RETURNING id`,
      [req.userId, subtotal, shippingFee, total]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, seller_id, title, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.productId || null, item.sellerId || null, item.title, item.unitPrice, item.quantity]
      );
    }

    // Cria a preferência de pagamento no Mercado Pago (Checkout Pro)
    const preference = new Preference(mpClient);
    const mpResponse = await preference.create({
      body: {
        items: items.map((i) => ({
          title: i.title,
          quantity: i.quantity,
          unit_price: Number(i.unitPrice),
          currency_id: 'BRL'
        })),
        shipments: {
          cost: Number(shippingFee),
          mode: 'not_specified'
        },
        external_reference: orderId,
        back_urls: {
          success: `${process.env.FRONTEND_URL}/pedido/${orderId}/sucesso`,
          failure: `${process.env.FRONTEND_URL}/pedido/${orderId}/falha`,
          pending: `${process.env.FRONTEND_URL}/pedido/${orderId}/pendente`
        },
        auto_return: 'approved',
        notification_url: `${process.env.BACKEND_PUBLIC_URL}/api/orders/webhook/mercadopago`
      }
    });

    await client.query(
      'UPDATE orders SET mp_preference_id = $1 WHERE id = $2',
      [mpResponse.id, orderId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      orderId,
      checkoutUrl: mpResponse.init_point, // link para redirecionar o cliente ao pagamento
      preferenceId: mpResponse.id
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
    const { type, data } = req.body;

    if (type === 'payment') {
      const payment = new Payment(mpClient);
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
    res.sendStatus(200); // responde 200 mesmo assim, para o MP não ficar reenviando indefinidamente
  }
});

export default router;
