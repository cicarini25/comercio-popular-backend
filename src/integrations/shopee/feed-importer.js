import pool from '../../db/pool.js';

export function affiliateLink(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 's.shopee.com.br' ||
      url.username || url.password || url.port || !/^\/[A-Za-z0-9]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('Use o link original https://s.shopee.com.br/... gerado no painel de afiliados.');
  }
  return url.href;
}

export function normalizeFeedItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new Error('Envie de 1 a 100 produtos selecionados em items.');
  }
  const seen = new Set();
  return items.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Produto inválido.');
    const id = String(row.itemid ?? '');
    if (!/^\d+$/.test(id) || seen.has(id)) throw new Error('ID ausente, inválido ou duplicado.');
    seen.add(id);
    const title = String(row.title ?? '').trim();
    if (!title || title.length > 255) throw new Error(`Item ${id}: título inválido.`);
    const price = Number(row.sale_price || row.price);
    const original = Number(row.price);
    if (!Number.isFinite(price) || price <= 0 || price >= 100000000 ||
        !Number.isFinite(original) || original <= 0 || original >= 100000000) {
      throw new Error(`Item ${id}: preço inválido.`);
    }
    const product = new URL(row.product_link);
    const match = product.pathname.match(/^\/product\/(\d+)\/(\d+)$/);
    if (product.protocol !== 'https:' || product.hostname !== 'shopee.com.br' ||
        product.username || product.password || product.port || !match || match[2] !== id) {
      throw new Error(`Item ${id}: endereço do produto incompatível.`);
    }
    const image = new URL(row.image_link);
    if (image.protocol !== 'https:' || image.username || image.password) throw new Error(`Item ${id}: imagem inválida.`);
    return {
      id, title, price, originalPrice: original > price ? original : null,
      description: String(row.description ?? '').slice(0, 50000),
      category: String(row.category || row.global_category1 || 'Shopee').slice(0, 100),
      seller: String(row.shop_name ?? '').slice(0, 180), image: image.href,
      productUrl: product.href, affiliateUrl: affiliateLink(row.affiliateUrl),
      shopId: match[1]
    };
  });
}

// Somente produtos com links fornecidos pelo administrador. Não fabrica atribuição.
export async function importShopeeFeed({ items, dryRun = true }, db = pool) {
  if (typeof dryRun !== 'boolean') throw new Error('dryRun deve ser true ou false.');
  const products = normalizeFeedItems(items);
  if (dryRun) return { dryRun: true, count: products.length, products };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serializa importações Shopee para evitar produtos órfãos em cargas simultâneas.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shopee-feed-import'))");
    const platform = await client.query("SELECT id FROM affiliate_platforms WHERE code='shopee' AND is_active=TRUE LIMIT 1");
    if (!platform.rows[0]) throw new Error('Plataforma Shopee não cadastrada ou inativa. Execute a migração existente e confira a configuração.');
    const platformId = platform.rows[0].id;
    const offers = [];
    for (const p of products) {
      const existing = await client.query('SELECT id, product_id FROM product_offers WHERE platform_id=$1 AND external_id=$2', [platformId, p.id]);
      let productId = existing.rows[0]?.product_id;
      const metadata = JSON.stringify({ importedFrom: 'shopee-feed', shopId: p.shopId, availabilityKnown: false });
      if (productId) {
        // Não sobrescreve um produto compartilhado com outra origem.
        await client.query(`UPDATE products SET title=$1, description=$2, price=$3, image_url=$4,
          category=$5, affiliate_link=$6, metadata=COALESCE(metadata,'{}'::jsonb)||$7::jsonb,
          updated_at=now() WHERE id=$8 AND source='shopee'`,
        [p.title,p.description,p.price,p.image,p.category,p.affiliateUrl,metadata,productId]);
      } else {
        const inserted = await client.query(`INSERT INTO products
          (source, external_id, title, description, price, image_url, category, affiliate_link,
           stock_units, product_kind, status, metadata)
          VALUES ('shopee',$1,$2,$3,$4,$5,$6,$7,NULL,'afiliado','ativo',$8::jsonb) RETURNING id`,
        [p.id,p.title,p.description,p.price,p.image,p.category,p.affiliateUrl,metadata]);
        productId = inserted.rows[0].id;
      }
      const offer = await client.query(`INSERT INTO product_offers
        (product_id,platform_id,external_id,offer_type,product_url,affiliate_url,price,original_price,
         currency,stock_units,availability,seller_name,sync_status,last_synced_at,metadata)
        VALUES ($1,$2,$3,'afiliada',$4,$5,$6,$7,'BRL',NULL,'desconhecida',$8,'feed',now(),$9::jsonb)
        ON CONFLICT (platform_id,external_id) WHERE external_id IS NOT NULL
        DO UPDATE SET product_url=EXCLUDED.product_url,affiliate_url=EXCLUDED.affiliate_url,
          price=EXCLUDED.price,original_price=EXCLUDED.original_price,stock_units=NULL,
          availability='desconhecida',seller_name=EXCLUDED.seller_name,sync_status='feed',
          last_synced_at=now(),updated_at=now(),metadata=EXCLUDED.metadata
        RETURNING id`,
      [productId,platformId,p.id,p.productUrl,p.affiliateUrl,p.price,p.originalPrice,p.seller,metadata]);
      offers.push({ itemId: p.id, productId, offerId: offer.rows[0].id,
        action: existing.rows.length ? 'updated' : 'imported',
        buyPath: `/api/catalog/offers/${offer.rows[0].id}/go` });
    }
    await client.query('COMMIT');
    return { dryRun: false, count: offers.length, offers };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
