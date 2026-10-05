import pool from '../../db/pool.js';

export const MAX_SYNC_ITEMS = 200;

// Domínios aceitos. Podem ser ajustados no Railway sem mexer no código:
//   SHEIN_AFFILIATE_HOSTS=shein.top,onelink.shein.com
//   SHEIN_PRODUCT_HOSTS=br.shein.com
function allowedHosts(envName, defaults) {
  const raw = process.env[envName];
  const list = raw ? raw.split(',') : defaults;
  return list.map(host => host.trim().toLowerCase()).filter(Boolean);
}

// Valida o link gerado no painel de afiliados da SHEIN ("Link do conversor").
export function sheinAffiliateLink(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('Link de afiliado da SHEIN inválido.');
  }
  const hosts = allowedHosts('SHEIN_AFFILIATE_HOSTS', ['shein.top', 'onelink.shein.com']);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !hosts.includes(url.hostname)) {
    throw new Error('Use o link original gerado no painel de afiliados da SHEIN (https e domínio permitido).');
  }
  if (url.pathname === '/' && !url.search) {
    throw new Error('Link de afiliado da SHEIN incompleto.');
  }
  return url.href;
}

// Aceita "49,90", "R$ 1.234,56" e números.
function parsePrice(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === 'number') return value;
  let text = String(value).replace(/[R$\s]/g, '');
  if (!text) return NaN;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  return Number(text);
}

function firstFilled(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

export function normalizeSheinItem(row, { requireAffiliateLink = true } = {}) {
  if (!row || typeof row !== 'object') throw new Error('Produto inválido.');

  // Endereço do produto (opcional): https://br.shein.com/Nome-do-produto-p-12345678-cat-1234.html
  const productRaw = firstFilled(row.product_link, row.productUrl, row.link_produto);
  let productUrl = null;
  let urlId;
  if (productRaw) {
    let parsed;
    try {
      parsed = new URL(String(productRaw).trim());
    } catch {
      throw new Error('Endereço do produto inválido.');
    }
    const hosts = allowedHosts('SHEIN_PRODUCT_HOSTS', ['br.shein.com']);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !hosts.includes(parsed.hostname)) {
      throw new Error('Endereço do produto fora do domínio da SHEIN.');
    }
    urlId = parsed.pathname.match(/-p-(\d+)/)?.[1];
    productUrl = parsed.href;
  }

  const id = String(firstFilled(row.id, row.itemid, row.goods_id, row.id_externo, urlId) ?? '');
  if (!/^\d+$/.test(id)) throw new Error('ID ausente ou inválido.');
  if (urlId && urlId !== id) throw new Error(`Item ${id}: endereço do produto incompatível com o ID.`);

  const title = String(firstFilled(row.title, row.titulo, row.productName) ?? '').trim();
  if (!title || title.length > 255) throw new Error(`Item ${id}: título inválido.`);

  const saleRaw = firstFilled(row.sale_price, row.salePrice);
  const priceRaw = saleRaw ?? firstFilled(row.preco, row.price);
  const price = parsePrice(priceRaw);
  const originalRaw = firstFilled(
    row.original_price, row.originalPrice, row.preco_original,
    saleRaw !== undefined ? row.price : undefined
  );
  const original = originalRaw === undefined ? price : parsePrice(originalRaw);
  if (!Number.isFinite(price) || price <= 0 || price >= 100000000 ||
      !Number.isFinite(original) || original <= 0 || original >= 100000000) {
    throw new Error(`Item ${id}: preço inválido.`);
  }

  let image;
  try {
    image = new URL(String(firstFilled(row.image_link, row.imageUrl, row.imagem_url) ?? '').trim());
  } catch {
    throw new Error(`Item ${id}: imagem inválida.`);
  }
  if (image.protocol !== 'https:' || image.username || image.password) {
    throw new Error(`Item ${id}: imagem inválida.`);
  }

  const affiliateRaw = firstFilled(row.affiliateUrl, row.affiliate_url, row.link_afiliado);
  let affiliateUrl;
  if (affiliateRaw) {
    try {
      affiliateUrl = sheinAffiliateLink(affiliateRaw);
    } catch (error) {
      throw new Error(`Item ${id}: ${error.message}`);
    }
  } else if (requireAffiliateLink) {
    throw new Error(`Item ${id}: link de afiliado ausente.`);
  }

  return {
    id,
    title,
    price,
    originalPrice: original > price ? original : null,
    description: String(firstFilled(row.description, row.descricao) ?? '').slice(0, 50000),
    category: String(firstFilled(row.category, row.categoria) ?? 'SHEIN').slice(0, 100),
    seller: 'SHEIN',
    image: image.href,
    productUrl,
    affiliateUrl
  };
}

export function normalizeSheinItems(items, { requireAffiliateLink = true } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_SYNC_ITEMS) {
    throw new Error(`Envie de 1 a ${MAX_SYNC_ITEMS} produtos em items.`);
  }

  const seen = new Set();
  return items.map(row => {
    const product = normalizeSheinItem(row, { requireAffiliateLink });
    if (seen.has(product.id)) throw new Error(`ID duplicado: ${product.id}.`);
    seen.add(product.id);
    return product;
  });
}

export async function upsertSheinProducts(products, db = pool) {
  if (!Array.isArray(products) || !products.length) {
    throw new Error('Nenhum produto SHEIN pronto para gravação.');
  }
  if (products.some(product => !product.affiliateUrl)) {
    throw new Error('Todos os produtos precisam de link de afiliado antes da gravação.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shein-feed-import'))");
    const platform = await client.query("SELECT id FROM affiliate_platforms WHERE code='shein' AND is_active=TRUE LIMIT 1");
    if (!platform.rows[0]) throw new Error('Plataforma SHEIN não cadastrada ou inativa. Execute a migração (npm run migrate).');
    const platformId = platform.rows[0].id;
    const offers = [];

    for (const p of products) {
      const existing = await client.query('SELECT id, product_id FROM product_offers WHERE platform_id=$1 AND external_id=$2', [platformId, p.id]);
      let productId = existing.rows[0]?.product_id;
      const metadata = JSON.stringify({ importedFrom: 'shein-feed', availabilityKnown: false });

      if (productId) {
        await client.query(`UPDATE products SET title=$1, description=$2, price=$3, image_url=COALESCE($4,image_url),
          category=$5, affiliate_link=$6, metadata=COALESCE(metadata,'{}'::jsonb)||$7::jsonb,
          updated_at=now() WHERE id=$8 AND source='shein'`,
        [p.title, p.description, p.price, p.image, p.category, p.affiliateUrl, metadata, productId]);
      } else {
        const inserted = await client.query(`INSERT INTO products
          (source, external_id, title, description, price, image_url, category, affiliate_link,
           stock_units, product_kind, status, metadata)
          VALUES ('shein',$1,$2,$3,$4,$5,$6,$7,NULL,'afiliado','ativo',$8::jsonb) RETURNING id`,
        [p.id, p.title, p.description, p.price, p.image, p.category, p.affiliateUrl, metadata]);
        productId = inserted.rows[0].id;
      }

      const offer = await client.query(`INSERT INTO product_offers
        (product_id,platform_id,external_id,offer_type,product_url,affiliate_url,price,original_price,
         currency,stock_units,availability,seller_name,sync_status,last_synced_at,metadata)
        VALUES ($1,$2,$3,'afiliada',$4,$5,$6,$7,'BRL',NULL,'desconhecida',$8,'feed',now(),$9::jsonb)
        ON CONFLICT (platform_id,external_id) WHERE external_id IS NOT NULL
        DO UPDATE SET is_active=TRUE,product_url=EXCLUDED.product_url,affiliate_url=EXCLUDED.affiliate_url,
          price=EXCLUDED.price,original_price=EXCLUDED.original_price,stock_units=NULL,
          availability='desconhecida',seller_name=EXCLUDED.seller_name,sync_status='feed',
          last_synced_at=now(),updated_at=now(),metadata=EXCLUDED.metadata
        RETURNING id`,
      [productId, platformId, p.id, p.productUrl, p.affiliateUrl, p.price, p.originalPrice, p.seller, metadata]);

      offers.push({
        itemId: p.id,
        productId,
        offerId: offer.rows[0].id,
        action: existing.rows.length ? 'updated' : 'imported',
        buyPath: `/api/catalog/offers/${offer.rows[0].id}/go`
      });
    }

    await client.query('COMMIT');
    return { count: offers.length, offers };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Prévia por padrão (dryRun=true): valida tudo e não grava nada no banco.
export async function importSheinFeed({ items, dryRun = true }, db = pool) {
  if (typeof dryRun !== 'boolean') throw new Error('dryRun deve ser true ou false.');
  const products = normalizeSheinItems(items, { requireAffiliateLink: true });
  if (dryRun) return { dryRun: true, count: products.length, products };
  const result = await upsertSheinProducts(products, db);
  return { dryRun: false, ...result };
}
