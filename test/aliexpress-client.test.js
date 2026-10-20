import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AliExpressAffiliateConnector, DEFAULT_ENDPOINT } from "../src/integrations/aliexpress/client.js";
import { buildAliExpressKeywords, filterRelevantAliExpressProducts, isRelevantAliExpressProduct } from "../src/integrations/aliexpress/search-relevance.js";

const sampleProduct = {
  product_id: "1005001234567890",
  product_title: "Luminária de mesa",
  target_sale_price: "39.90",
  target_original_price: "59.90",
  target_sale_price_currency: "BRL",
  product_detail_url: "https://www.aliexpress.com/item/1005001234567890.html",
  promotion_link: "https://s.click.aliexpress.com/e/_test",
  product_main_image_url: "https://ae-pic-a1.aliexpress-media.com/kf/Ssample.jpg",
  first_level_category_name: "Iluminação",
  shop_id: "shop-1",
  commission_rate: "0.08"
};

function affiliateResponse(product = sampleProduct) {
  const products = Array.isArray(product) ? product : [product];
  return {
    aliexpress_affiliate_product_query_response: {
      resp_result: {
        resp_code: 200,
        resp_msg: "Call succeeds",
        result: {
          current_page_no: 2,
          current_record_count: products.length,
          total_record_count: products.length,
          products: { product: products }
        }
      }
    }
  };
}

test("usa o gateway oficial, assina a query e normaliza o produto afiliado", async () => {
  const connector = new AliExpressAffiliateConnector({
    appKey: "app-key-test",
    appSecret: "app-secret-test",
    trackingId: "comercio_popular"
  });
  const originalFetch = global.fetch;
  let capturedUrl;
  let capturedOptions;

  global.fetch = async (url, options) => {
    capturedUrl = new URL(url);
    capturedOptions = options;
    return new Response(JSON.stringify(affiliateResponse()), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await connector.searchProducts({ keywords: "luminaria", page: 2, pageSize: 20 });
    const params = Object.fromEntries(capturedUrl.searchParams.entries());
    const unsigned = { ...params };
    delete unsigned.sign;
    const signPayload = Object.keys(unsigned).sort().map((key) => `${key}${unsigned[key]}`).join("");
    const expectedSignature = crypto.createHmac("md5", "app-secret-test")
      .update(signPayload, "utf8")
      .digest("hex")
      .toUpperCase();

    assert.equal(DEFAULT_ENDPOINT, "https://api-sg.aliexpress.com/sync");
    assert.equal(capturedUrl.origin, "https://api-sg.aliexpress.com");
    assert.equal(capturedUrl.pathname, "/sync");
    assert.equal(params.method, "aliexpress.affiliate.product.query");
    assert.equal(params.app_key, "app-key-test");
    assert.equal(params.tracking_id, "comercio_popular");
    assert.equal(params.keywords, "lighting fixture");
    assert.equal(params.page_no, "2");
    assert.equal(params.page_size, "20");
    assert.equal(params.partner_id, undefined);
    assert.equal(params.app_signature, undefined);
    assert.equal(params.sign, expectedSignature);
    assert.equal(capturedOptions.method, "GET");
    assert.equal(capturedOptions.body, undefined);
    assert.match(params.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(result.products[0].externalId, sampleProduct.product_id);
    assert.equal(result.products[0].title, sampleProduct.product_title);
    assert.equal(result.products[0].price, 39.9);
    assert.equal(result.products[0].affiliateUrl, sampleProduct.promotion_link);
    assert.equal(result.pageInfo.page, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("converte o endereço antigo eco.taobao para o gateway oficial", async () => {
  const connector = new AliExpressAffiliateConnector({
    appKey: "app-key-test",
    appSecret: "app-secret-test",
    trackingId: "comercio_popular",
    endpoint: "https://eco.taobao.com/router/rest"
  });
  const originalFetch = global.fetch;
  let capturedUrl;

  global.fetch = async (url) => {
    capturedUrl = new URL(url);
    return new Response(JSON.stringify(affiliateResponse()), { status: 200 });
  };

  try {
    await connector.searchProducts({ keywords: "luminaria" });
    assert.equal(capturedUrl.origin, "https://api-sg.aliexpress.com");
    assert.equal(capturedUrl.pathname, "/sync");
  } finally {
    global.fetch = originalFetch;
  }
});

test("requer as três credenciais e apresenta uma mensagem clara", async () => {
  const connector = new AliExpressAffiliateConnector();
  await assert.rejects(
    () => connector.searchProducts({ keywords: "produto" }),
    /ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET e ALIEXPRESS_TRACKING_ID/
  );
});

test("aceita a imagem no domínio CDN oficial do AliExpress ao preparar o import", async () => {
  const { normalizeAliExpressImportItem } = await import("../src/integrations/aliexpress/importer.js");
  const connector = new AliExpressAffiliateConnector();
  const product = normalizeAliExpressImportItem(sampleProduct, connector);
  assert.equal(product.imageUrl, sampleProduct.product_main_image_url);
  assert.equal(product.affiliateUrl, sampleProduct.promotion_link);
});

test("traduz consultas portuguesas representativas de categorias para pesquisa internacional", () => {
  assert.equal(buildAliExpressKeywords("pneus automotivos"), "car tire");
  assert.equal(buildAliExpressKeywords("pneus de moto"), "motorcycle tire");
  assert.equal(buildAliExpressKeywords("pneus de bicicleta"), "bicycle tire");
  assert.equal(buildAliExpressKeywords("pneus", "AUTO & ACESSÓRIOS"), "car tire");
  assert.equal(buildAliExpressKeywords("pneus", "MOTOS & ACESSÓRIOS"), "motorcycle tire");
  assert.equal(buildAliExpressKeywords("luminárias"), "lighting fixture");
  assert.equal(buildAliExpressKeywords("mesa de jantar"), "dining table");
  assert.equal(buildAliExpressKeywords("mochila escolar", "BOLSAS & MOCHILAS"), "backpack school");
  assert.equal(buildAliExpressKeywords("cadeiras gamer", "Móveis"), "chairs gaming");
});

test("separa pneus automotivos de pneus de moto/bicicleta e remove acessórios de pneus", () => {
  const car = { title: "Car tire 205/55 R16" };
  const motorcycle = { title: "Motorcycle tire 120/70-17" };
  const bicycle = { title: "Mountain bike tire 29 inch" };
  const wheelStud = { title: "Car wheel stud bolt" };
  const pressureGauge = { title: "Digital tire pressure gauge" };

  assert.equal(isRelevantAliExpressProduct(car, "pneus automotivos"), true);
  assert.equal(isRelevantAliExpressProduct(motorcycle, "pneus automotivos"), false);
  assert.equal(isRelevantAliExpressProduct(bicycle, "pneus automotivos"), false);
  assert.equal(isRelevantAliExpressProduct(motorcycle, "pneus de moto"), true);
  assert.equal(isRelevantAliExpressProduct(car, "pneus de moto"), false);
  assert.equal(isRelevantAliExpressProduct(bicycle, "pneus de bicicleta"), true);
  assert.equal(isRelevantAliExpressProduct(wheelStud, "pneus automotivos"), false);
  assert.equal(isRelevantAliExpressProduct(pressureGauge, "pneus automotivos"), false);
});

test("filtra acessórios de iluminação sem excluir lâmpadas como produto", () => {
  const result = filterRelevantAliExpressProducts([
    { title: "Modern ceiling light fixture" },
    { title: "LED light bulbs E27" },
    { title: "Light socket holder E27" },
    { title: "Wireless doorbell" },
    { title: "Electrical wall switch" },
    { title: "USB cable" }
  ], "luminárias");

  assert.deepEqual(result.products.map((product) => product.title), ["Modern ceiling light fixture", "LED light bulbs E27"]);
  assert.equal(result.receivedCount, 6);
  assert.equal(result.filteredOut, 4);
});

test("filtra falsos positivos em consultas genéricas de várias categorias", () => {
  const cases = [
    ["mochilas", { title: "School backpack for children" }, true],
    ["mochilas", { title: "Replacement backpack shoulder strap" }, false],
    ["lixeira rosa", { title: "Pink bathroom trash bin" }, true],
    ["lixeira rosa", { title: "Pink flower wall sticker" }, false],
    ["toalhas", { title: "Cotton bath towels set" }, true],
    ["toalhas", { title: "Kids beach poncho" }, false],
    ["carregador celular", { title: "USB phone charger fast charging" }, true],
    ["carregador celular", { title: "Phone case with charging cable" }, false]
  ];
  for (const [keywords, product, expected] of cases) {
    assert.equal(isRelevantAliExpressProduct(product, keywords), expected, `${keywords}: ${product.title}`);
  }
});
