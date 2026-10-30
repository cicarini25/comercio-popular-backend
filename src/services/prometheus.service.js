import pool from '../db/pool.js';

const WHATSAPP_URL = 'https://wa.me/5541996184115?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20no%20Com%C3%A9rcio%20Popular.';
const MAX_PRODUCTS = 5;

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function response(message, intent, extras = {}) {
  return { message, intent, products: [], quickReplies: [], requiresHuman: false, ...extras };
}

function mapProduct(row) {
  const image = row.image_url || '';
  return {
    id: String(row.id),
    title: row.title,
    description: row.description || '',
    price: Number(row.offer_price ?? row.price ?? 0),
    originalPrice: row.original_price == null ? undefined : Number(row.original_price),
    platform: row.platform_code || (row.source === 'proprio' ? 'parceiro' : 'parceiro'),
    affiliateUrl: row.affiliate_url || row.affiliate_link || undefined,
    affiliateOfferId: row.offer_id ? String(row.offer_id) : undefined,
    rating: 0,
    reviewCount: 0,
    images: image ? [image] : [],
    category: row.category || 'Geral',
    isAchadinho: Boolean(row.is_achadinho),
    stockUnits: row.offer_stock_units ?? row.stock_units ?? null,
    isFreeShipping: row.is_free_shipping ?? undefined,
    isFastShipping: row.is_fast_shipping ?? undefined,
    seller: row.seller_id ? {
      id: String(row.seller_id),
      name: row.seller_store_name || 'Comerciante parceiro',
      city: '',
      state: '',
      verified: row.seller_verification_status === 'verified',
      plan: row.seller_plan || '',
      rating: 0,
      salesCount: 0,
    } : undefined,
  };
}

async function searchCatalog(searchText, currentProductId = null) {
  const values = [];
  const where = [
    "p.status = 'ativo'",
    "((p.source = 'proprio' AND p.seller_id IS NOT NULL AND COALESCE(p.stock_units, 0) > 0 AND EXISTS (SELECT 1 FROM sellers s JOIN users su ON su.id = s.user_id WHERE s.id = p.seller_id AND s.plan_status = 'active' AND s.verification_status = 'verified' AND su.is_seller = TRUE)) OR EXISTS (SELECT 1 FROM product_offers po_filter JOIN affiliate_platforms ap_filter ON ap_filter.id = po_filter.platform_id WHERE po_filter.product_id = p.id AND po_filter.is_active = TRUE AND po_filter.offer_type = 'afiliada' AND ap_filter.is_active = TRUE))",
  ];

  const normalizedSearch = normalize(searchText).slice(0, 100);
  if (normalizedSearch) {
    values.push(`%${normalizedSearch}%`);
    where.push("translate(lower(COALESCE(p.title, '') || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.category, '') || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.ean, '')), 'áàãâäéêëíîïóôöõúùüç', 'aaaaaeeeiiiooouuuc') LIKE $" + values.length);
  }

  if (currentProductId && /^[0-9a-f-]{36}$/i.test(currentProductId)) {
    values.push(currentProductId);
    where.push(`p.id = $${values.length}`);
  }

  values.push(MAX_PRODUCTS);
  const limitParam = values.length;
  const result = await pool.query(
    `SELECT p.id, p.source, p.seller_id, p.title, p.description, p.price, p.image_url,
            p.affiliate_link, p.category, p.stock_units, p.is_achadinho,
            s.store_name AS seller_store_name, s.plan AS seller_plan,
            s.verification_status AS seller_verification_status,
            offer.id AS offer_id, offer.affiliate_url, offer.price AS offer_price,
            offer.original_price, offer.stock_units AS offer_stock_units,
            offer.is_free_shipping, offer.is_fast_shipping,
            ap.code AS platform_code
       FROM products p
       LEFT JOIN sellers s ON s.id = p.seller_id
       LEFT JOIN LATERAL (
         SELECT po.* FROM product_offers po
         WHERE po.product_id = p.id AND po.is_active = TRUE
           AND po.offer_type = 'afiliada'
         ORDER BY po.price NULLS LAST, po.updated_at DESC NULLS LAST
         LIMIT 1
       ) offer ON TRUE
       LEFT JOIN affiliate_platforms ap ON ap.id = offer.platform_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.is_achadinho DESC, p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT $${limitParam}`,
    values,
  );

  return result.rows.map(mapProduct);
}

async function orderSummary(userId, message) {
  if (!userId) {
    return response('Para consultar uma encomenda, entre na sua conta. Por segurança, não mostro dados de pedidos sem autenticação.', 'order_status_auth_required', {
      quickReplies: ['Entrar', 'Falar com atendimento'],
    });
  }

  const values = [userId];
  let filter = '';
  const idMatch = String(message).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  if (idMatch) {
    values.push(idMatch[0]);
    filter = `AND o.id = $${values.length}`;
  }

  const result = await pool.query(
    `SELECT o.id, o.status, o.total, o.tracking_code, o.created_at,
            COALESCE(json_agg(json_build_object('title', oi.title, 'quantity', oi.quantity, 'unitPrice', oi.unit_price) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = $1 ${filter}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 3`,
    values,
  );

  if (!result.rows.length) {
    return response('Não encontrei encomendas associadas à sua conta. Confirme se entrou com a conta utilizada na compra.', 'order_not_found', {
      quickReplies: ['Ver produtos', 'Falar com atendimento'],
    });
  }

  const latest = result.rows[0];
  return response(`A sua encomenda mais recente está com o estado “${latest.status}”.${latest.tracking_code ? ` Código de rastreio: ${latest.tracking_code}.` : ''}`, 'order_status', {
    orders: result.rows.map((order) => ({
      id: String(order.id), status: order.status, total: Number(order.total), trackingCode: order.tracking_code || null, createdAt: order.created_at, items: order.items,
    })),
    quickReplies: ['Consultar outra encomenda', 'Falar com atendimento'],
  });
}

export async function answerPrometheusMessage({ userId, message, context = {} }) {
  const text = normalize(message);

  if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda)$/.test(text)) {
    return response('Olá! Sou a PROMETHEUS. Posso ajudar com produtos, preços, disponibilidade, entrega, encomendas e atendimento.', 'greeting', {
      quickReplies: ['Encontrar um produto', 'Consultar entrega e frete', 'Rastrear meu pedido', 'Falar com atendimento'],
    });
  }

  if (text.includes('atendimento') || text.includes('humano') || text.includes('whatsapp') || text.includes('falar com')) {
    return response('Claro. Pode falar diretamente com a nossa equipa através do WhatsApp.', 'human_handoff', {
      requiresHuman: true, whatsappUrl: WHATSAPP_URL, quickReplies: ['Voltar ao catálogo'],
    });
  }

  if (text.includes('rastre') || text.includes('pedido') || text.includes('encomenda')) return orderSummary(userId, message);

  if (text.includes('entrega') || text.includes('frete') || text.includes('envio') || text.includes('cep')) {
    return response('O prazo e o valor do frete dependem do produto e do CEP. Abra o produto ou o carrinho para consultar as condições disponíveis.', 'shipping', {
      quickReplies: ['Encontrar um produto', 'Rastrear meu pedido', 'Falar com atendimento'],
    });
  }

  if (text.includes('pagamento') || text.includes('pix') || text.includes('cartao')) {
    return response('O Comércio Popular aceita Pix e cartão através do checkout seguro. As opções disponíveis podem variar conforme o vendedor e o produto.', 'payment', {
      quickReplies: ['Encontrar um produto', 'Consultar entrega', 'Falar com atendimento'],
    });
  }

  const products = await searchCatalog(message, context.currentProductId);
  if (products.length) {
    return response(`Encontrei ${products.length} opção(ões) relacionadas. Posso ajudar a comparar os produtos.`, 'product_search', {
      products, quickReplies: ['Consultar entrega', 'Ver outras opções', 'Falar com atendimento'],
    });
  }

  return response('Ainda não encontrei uma correspondência exata. Diga o nome do produto, a categoria ou o que pretende resolver.', 'fallback', {
    quickReplies: ['Encontrar um produto', 'Consultar entrega e frete', 'Falar com atendimento'],
  });
}
