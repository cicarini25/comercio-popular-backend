import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeShopeeBulkItems,
  generateMissingShopeeAffiliateLinks
} from '../src/integrations/shopee/bulk-importer.js';

const base = {
  itemid: '58263625348',
  title: 'Produto Shopee',
  price: '99.90',
  sale_price: '79.90',
  description: 'Descrição',
  global_category1: 'Teste',
  image_link: 'https://cf.shopee.com.br/file/test.jpg',
  product_link: 'https://shopee.com.br/product/1862185018/58263625348'
};

test('exige Offer Link no lote de importação por padrão', () => {
  assert.throws(
    () => normalizeShopeeBulkItems([base]),
    /link de afiliado ausente/i
  );
});

test('permite normalização sem Offer Link somente quando explicitamente solicitado', () => {
  const [product] = normalizeShopeeBulkItems([base], { requireAffiliateLink: false });
  assert.equal(product.id, base.itemid);
  assert.equal(product.affiliateUrl, undefined);
});

test('preserva Offer Link fornecido pelo CSV', () => {
  const [product] = normalizeShopeeBulkItems([{
    ...base,
    affiliateUrl: 'https://s.shopee.com.br/existing1'
  }]);
  assert.equal(product.affiliateUrl, 'https://s.shopee.com.br/existing1');
});

test('gera links ausentes em paralelo controlado e preserva os já existentes', async () => {
  let calls = 0;
  const connector = {
    isConfigured: () => true,
    async generateAffiliateLink(url) {
      calls += 1;
      return {
        affiliateUrl: `https://s.shopee.com.br/${url.endsWith('58263625348') ? 'abc123' : 'def456'}`
      };
    }
  };

  const products = normalizeShopeeBulkItems([
    base,
    {
      ...base,
      itemid: '22793658128',
      product_link: 'https://shopee.com.br/product/1012119571/22793658128',
      affiliateUrl: 'https://s.shopee.com.br/existing1'
    },
    {
      ...base,
      itemid: '25846308994',
      product_link: 'https://shopee.com.br/product/858929102/25846308994'
    }
  ], { requireAffiliateLink: false });

  const result = await generateMissingShopeeAffiliateLinks(products, connector, { concurrency: 2 });
  assert.equal(calls, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(result.products.length, 3);
  assert.equal(result.products[1].affiliateUrl, 'https://s.shopee.com.br/existing1');
  assert.match(result.products[0].affiliateUrl, /^https:\/\/s\.shopee\.com\.br\//);
});
