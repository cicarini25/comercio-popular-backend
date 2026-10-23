import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDITED_PRODUCT_CATEGORY_OVERRIDES } from '../src/catalog-product-category-overrides.js';

test('overrides da auditoria usam 215 UUIDs válidos e categorias do catálogo', () => {
  const entries = Object.entries(AUDITED_PRODUCT_CATEGORY_OVERRIDES);
  const validCategories = new Set([
    'Aparelhos de Som', 'ARMARINHOS & TRICÔ', 'AUTO & ACESSÓRIOS',
    'Acessórios para celulares', 'BOLSAS & MOCHILAS', 'Bike Elétrica e Acessórios',
    'Brinquedos', 'CAMA/MESA/BANHO', 'CALÇADOS INFANTIS M/F', 'Calçados Femininos',
    'Calçados Masculino', 'Casa & Cozinha', 'Computadores', 'Cuidado & Beleza',
    'Eletrodomésticos', 'ELETRÔNICOS', 'ELETRO & ACESSÓRIOS',
    'ELÉTRICA & HIDRÁULICA', 'Esportes & Lazer', 'Ferramentas',
    'Fones & Headphones', 'Games', 'LUMINÁRIAS', 'MÁQUINAS & IMPRESSORAS',
    'MODA INFANTIL FEMININA', 'MODA INFANTIL MASCULINA', 'MODA VERÃO PRAIA',
    'Moda Feminina', 'Moda Masculina', 'Móveis', 'MOTOS & ACESSÓRIOS',
    'Notebook', 'Pets', 'RELÓGIOS', 'Smartphones', 'TVs', 'Utilidades',
    'Alimentos & Bebidas', 'Instrumentos Musicais',
  ]);
  assert.equal(entries.length, 215);
  assert.equal(new Set(entries.map(([id]) => id)).size, 215);
  for (const [id, category] of entries) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.ok(validCategories.has(category), 'Categoria fora da taxonomia: ' + category);
  }
});

test('mantém decisões anteriores e não muda artigos de relógio para acessórios de telemóvel', () => {
  assert.equal(AUDITED_PRODUCT_CATEGORY_OVERRIDES['282b3aaf-9b88-4cbb-bb68-c8a8fbfdb566'], 'BOLSAS & MOCHILAS');
  assert.equal(AUDITED_PRODUCT_CATEGORY_OVERRIDES['787e81a4-3687-4abe-b699-072ba6fe9722'], undefined);
  assert.equal(AUDITED_PRODUCT_CATEGORY_OVERRIDES['63a85548-2ba5-4e81-b57e-d81af5399c1e'], undefined);
  assert.equal(AUDITED_PRODUCT_CATEGORY_OVERRIDES['95113ca2-c2f1-45bb-b3c3-8292daacb142'], undefined);
});
