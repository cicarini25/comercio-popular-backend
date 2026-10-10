import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveShopeeSiteCategory,
  normalizeShopeeSiteCategory
} from '../src/integrations/shopee/category-resolver.js';
import { normalizeFeedItem } from '../src/integrations/shopee/feed-importer.js';

test('classifica peças e acessórios de motocicletas pelo título mesmo se a categoria importada estiver errada', () => {
  assert.equal(
    resolveShopeeSiteCategory({
      category: 'Moda Feminina',
      title: 'Retrovisor esportivo para moto Honda CG 160',
      categoryOverride: 'Moda Feminina'
    }),
    'MOTOS & ACESSÓRIOS'
  );
  assert.equal(
    resolveShopeeSiteCategory({
      category: 'AUTO & ACESSÓRIOS',
      title: 'Capacete para motocross com viseira'
    }),
    'MOTOS & ACESSÓRIOS'
  );
  assert.equal(
    resolveShopeeSiteCategory({
      category: '',
      title: 'Suporte universal para motos e motociclistas'
    }),
    'MOTOS & ACESSÓRIOS'
  );
});

test('preserva a diferença entre motos, automotivo e bicicleta elétrica', () => {
  assert.equal(
    resolveShopeeSiteCategory({ title: 'Capa para banco de carro automotiva' }),
    'AUTO & ACESSÓRIOS'
  );
  assert.equal(
    resolveShopeeSiteCategory({ title: 'Bateria para bicicleta elétrica 36V' }),
    'Bike Elétrica e Acessórios'
  );
  assert.equal(
    normalizeShopeeSiteCategory('Motorcycle Accessories'),
    'MOTOS & ACESSÓRIOS'
  );
});

test('usa a categoria escolhida como fallback para títulos sem sinal suficiente, sem mandar desconhecidos para Utilidades', () => {
  assert.equal(
    resolveShopeeSiteCategory({
      category: 'Feed sem categoria reconhecida',
      title: 'Kit universal modelo XZ-99',
      categoryOverride: 'MOTOS & ACESSÓRIOS'
    }),
    'MOTOS & ACESSÓRIOS'
  );
  assert.equal(
    resolveShopeeSiteCategory({
      category: 'Feed sem categoria reconhecida',
      title: 'Kit universal modelo XZ-99'
    }),
    undefined
  );
});

test('normaliza cada produto na categoria correta antes de gravar o lote Shopee', () => {
  const product = normalizeFeedItem({
    itemid: '123',
    title: 'Retrovisor ajustável para moto Honda CG 160',
    price: '149.90',
    sale_price: '99.90',
    product_link: 'https://shopee.com.br/product/123456/123',
    image_link: 'https://cf.shopee.com.br/file/test-image.jpg',
    affiliateUrl: 'https://s.shopee.com.br/aB123c',
    global_category1: 'Moda Feminina',
    categoryOverride: 'Moda Feminina'
  });

  assert.equal(product.category, 'MOTOS & ACESSÓRIOS');
  assert.equal(product.categoryOverride, 'MOTOS & ACESSÓRIOS');
  assert.equal(product.price, 99.9);
  assert.equal(product.affiliateUrl, 'https://s.shopee.com.br/aB123c');
});
