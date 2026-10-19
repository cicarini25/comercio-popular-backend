import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AliExpressAffiliateConnector, DEFAULT_ENDPOINT } from "../src/integrations/aliexpress/client.js";

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
  return {
    aliexpress_affiliate_product_query_response: {
      resp_result: {
        resp_code: 200,
        resp_msg: "success",
        result: {
          current_page_no: 2,
          current_record_count: 1,
          total_record_count: 1,
          products: { product: [product] }
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
    assert.equal(params.keywords, "luminaria");
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
