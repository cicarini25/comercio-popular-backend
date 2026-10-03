import { normalizeFeedItem, affiliateLink } from './feed-importer.js';

export const MAX_BULK_ITEMS = 30000;

export const DEFAULT_LINK_CONCURRENCY = Math.min(
  Math.max(Number(process.env.SHOPEE_LINK_CONCURRENCY || 5), 1),
  10
);

export function normalizeShopeeBulkItems(items, { requireAffiliateLink = true } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_BULK_ITEMS) {
    throw new Error(`Envie de 1 a ${MAX_BULK_ITEMS} produtos em items.`);
  }

  const seen = new Set();
  return items.map((row) => {
    const product = normalizeFeedItem(row, { requireAffiliateLink, allowMissingImage: row.allowMissingImage === true });
    if (seen.has(product.id)) {
      throw new Error(`ID duplicado: ${product.id}.`);
    }
    seen.add(product.id);
    return product;
  });
}

export async function generateMissingShopeeAffiliateLinks(
  products,
  connector,
  { concurrency = DEFAULT_LINK_CONCURRENCY, subIds = [] } = {}
) {
  if (!Array.isArray(products) || !products.length) return { products: [], failures: [] };
  const output = products.map((product) => ({ ...product }));
  const missingIndexes = output
    .map((product, index) => (product.affiliateUrl ? null : index))
    .filter((index) => index !== null);

  if (!missingIndexes.length) {
    return { products: output, failures: [] };
  }

  if (!connector?.isConfigured?.()) {
    return {
      products: output.filter((product) => product.affiliateUrl),
      failures: missingIndexes.map((index) => ({
        itemId: output[index].id,
        message: 'Link de afiliado ausente e Shopee Affiliate Open API não configurada.'
      }))
    };
  }

  let cursor = 0;
  const failures = [];
  const workerCount = Math.min(
    Math.max(Number(concurrency) || DEFAULT_LINK_CONCURRENCY, 1),
    DEFAULT_LINK_CONCURRENCY
  );

  const workers = Array.from({ length: workerCount }, () => null).map(async () => {
    while (true) {
      const position = cursor++;
      if (position >= missingIndexes.length) return;
      const index = missingIndexes[position];
      const product = output[index];

      try {
        const result = await connector.generateAffiliateLink(product.productUrl, subIds);
        output[index].affiliateUrl = affiliateLink(result.affiliateUrl);
      } catch (error) {
        failures.push({
          itemId: product.id,
          message: error instanceof Error ? error.message : 'Falha ao gerar link de afiliado.'
        });
      }
    }
  });

  await Promise.all(workers);
  return {
    products: output.filter((product) => product.affiliateUrl),
    failures
  };
}
