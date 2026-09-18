import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { ShopeeAffiliateConnector } from "../src/integrations/shopee/client.js";

test("gera assinatura SHA-256 sobre o payload enviado", async () => {
  const connector = new ShopeeAffiliateConnector({ appId: "123", secret: "abc" });
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  let captured;

  global.fetch = async (_url, options) => {
    captured = options;
    return new Response(JSON.stringify({
      data: { generateShortLink: { shortLink: "https://shope.ee/test" } }
    }), { status: 200 });
  };
  Date.now = () => 1700000000000;

  try {
    const result = await connector.generateAffiliateLink("https://shopee.com.br/produto");
    assert.equal(result.affiliateUrl, "https://shope.ee/test");

    const timestamp = 1700000000;
    const expected = crypto
      .createHash("sha256")
      .update(`123${timestamp}${captured.body}abc`)
      .digest("hex");

    assert.match(captured.headers.authorization, new RegExp(`Signature=${expected}`));
  } finally {
    Date.now = originalDateNow;
    global.fetch = originalFetch;
  }
});

test("retorna erro claro sem credenciais Shopee", async () => {
  const connector = new ShopeeAffiliateConnector();
  await assert.rejects(
    () => connector.generateAffiliateLink("https://shopee.com.br/produto"),
    /SHOPEE_AFFILIATE_APP_ID/
  );
});

test("normaliza oferta Shopee", () => {
  const connector = new ShopeeAffiliateConnector({ appId: "123", secret: "abc" });
  const product = connector.normalizeProduct({
    itemId: 123456,
    productName: "Produto Teste",
    productLink: "https://shopee.com.br/p",
    offerLink: "https://shope.ee/a",
    imageUrl: "https://cdn.example/image.jpg",
    priceMin: "99.90",
    commissionRate: "0.10",
    priceDiscountRate: 10,
    shopId: 77,
    shopName: "Loja"
  });

  assert.equal(product.marketplace, "shopee");
  assert.equal(product.externalId, "123456");
  assert.equal(product.price, 99.9);
  assert.equal(product.affiliateUrl, "https://shope.ee/a");
  assert.equal(product.discountPercent, 10);
});
