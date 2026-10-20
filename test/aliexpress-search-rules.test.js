import test from "node:test";
import assert from "node:assert/strict";
import { AliExpressAffiliateConnector } from "../src/integrations/aliexpress/client.js";
import {
  ALIEXPRESS_SEARCH_RULES,
  filterByAliExpressSearchRule,
  getAliExpressSearchRule,
  isEligibleByAliExpressSearchRule,
  validateAliExpressSearchCandidate
} from "../src/integrations/aliexpress/search-rules.js";

function candidate(title, price, currency = "BRL", extra = {}) {
  return { title, price, currency, ...extra };
}

test("exporta regras congeladas e reconhece intenções apenas por limites de palavra", () => {
  assert.ok(Object.isFrozen(ALIEXPRESS_SEARCH_RULES));
  assert.ok(Object.isFrozen(ALIEXPRESS_SEARCH_RULES[0]));
  assert.equal(getAliExpressSearchRule("pneus automotivos")?.key, "pneus");
  assert.equal(getAliExpressSearchRule("refrigerator")?.key, "geladeiras");
  assert.equal(getAliExpressSearchRule("action figure")?.key, "brinquedos");
  assert.equal(getAliExpressSearchRule("pneumatic tool"), undefined);
});

test("aceita pneu real acima do piso BRL e rejeita acessório, título sem produto e outra moeda", () => {
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Pneu automotivo radial 205/55 R16", 120), "pneus"),
    true
  );
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Kit de reparo para pneu", 1.97), "pneus"),
    false
  );
  assert.equal(
    validateAliExpressSearchCandidate(candidate("Roda de liga leve aro 16", 500), "pneus").reason,
    "missing-product-term"
  );
  assert.equal(
    validateAliExpressSearchCandidate(candidate("Car tire 205/55 R16", 500, "USD"), "pneus").reason,
    "non-brl-currency"
  );
});

test("aplica termos proibidos e piso de venda para geladeiras sem usar preço original", () => {
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Geladeira frost free 400L", 800, "BRL", { originalPrice: 1200 }), "geladeira"),
    true
  );
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Puxador para geladeira", 900), "geladeiras"),
    false
  );
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Refrigerator filter replacement", 900), "refrigerator"),
    false
  );
  assert.equal(
    validateAliExpressSearchCandidate(candidate("Fridge 120L", 799.99), "fridge").reason,
    "below-minimum-sale-price"
  );
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Refrigerador 400L", 1200, "EUR"), "refrigerador"),
    false
  );
});

test("aceita brinquedos reais a partir de R$15, rejeita peça e não proíbe kit genericamente", () => {
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Anime action figure colecionável", 15), "brinquedos"),
    true
  );
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Peça de reposição para brinquedo", 9.99), "brinquedo"),
    false
  );
  assert.equal(
    isEligibleByAliExpressSearchRule(candidate("Kit de brinquedo educativo", 20), "brinquedo"),
    true
  );
});

test("busca não mapeada não altera a camada de filtro de regras", () => {
  const products = [
    candidate("Produto sem relação", 1, "USD"),
    candidate("Outro produto", 2, "BRL")
  ];
  const result = filterByAliExpressSearchRule(products, "luminaria");
  assert.deepEqual(result.products, products);
  assert.equal(result.receivedCount, products.length);
  assert.equal(result.filteredOut, 0);
});

test("integra a regra no resultado do cliente AliExpress com mock de fetch", async () => {
  const connector = new AliExpressAffiliateConnector({
    appKey: "app-key-test",
    appSecret: "app-secret-test",
    trackingId: "comercio_popular"
  });
  const apiProduct = (id, title, price, currency = "BRL") => ({
    product_id: id,
    product_title: title,
    target_sale_price: String(price),
    target_sale_price_currency: currency,
    target_original_price: "999.00",
    product_detail_url: `https://www.aliexpress.com/item/${id}.html`,
    promotion_link: `https://s.click.aliexpress.com/e/_${id}`,
    product_main_image_url: "https://ae-pic-a1.aliexpress-media.com/kf/Ssample.jpg",
    first_level_category_name: "Auto & Acessórios",
    shop_id: `shop-${id}`
  });
  const products = [
    apiProduct("1", "Pneu automotivo radial 205/55 R16", 150),
    apiProduct("2", "Kit repair kit for tire", 1.97),
    apiProduct("3", "Pneu automotivo radial 175/70 R14", 100),
    apiProduct("4", "Car tire 205/55 R16", 300, "USD")
  ];
  const payload = {
    aliexpress_affiliate_product_query_response: {
      resp_result: {
        resp_code: 200,
        resp_msg: "Call succeeds",
        result: {
          current_page_no: 1,
          current_record_count: products.length,
          total_record_count: products.length,
          products: { product: products }
        }
      }
    }
  };
  const originalFetch = global.fetch;
  let capturedUrl;
  global.fetch = async (url) => {
    capturedUrl = new URL(url);
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  try {
    const result = await connector.searchProducts({ keywords: "pneus" });
    assert.deepEqual(result.products.map((product) => product.externalId), ["1"]);
    assert.equal(result.receivedCount, 4);
    assert.equal(result.filteredOut, 3);
    assert.equal(capturedUrl.searchParams.get("min_sale_price"), null);
  } finally {
    global.fetch = originalFetch;
  }
});
