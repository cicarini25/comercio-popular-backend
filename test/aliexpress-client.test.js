import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AliExpressAffiliateConnector, DEFAULT_ENDPOINT } from "../src/integrations/aliexpress/client.js";
import { buildAliExpressKeywords, filterRelevantAliExpressProducts, isRelevantAliExpressProduct, scoreProductTitleMatch } from "../src/integrations/aliexpress/search-relevance.js";
import { SITE_CATEGORY_TREE, classifySiteProduct, normalizeSiteCategory } from "../src/integrations/core/site-category-resolver.js";

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
    assert.equal(result.products[0].siteCategory, "LUMINÁRIAS");
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
  assert.equal(buildAliExpressKeywords("pneus", "AUTO & ACESSÓRIOS"), "tire");
  assert.equal(buildAliExpressKeywords("pneus", "MOTOS & ACESSÓRIOS"), "tire");
  assert.equal(buildAliExpressKeywords("luminárias"), "lighting fixtures");
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

test("busca simples por PNEUS mantém pneus de todos os veículos e remove acessórios citados pelo usuário", () => {
  const accessoryTitles = [
    "Carhome 2x roda talão porca capa tampas ferramenta de remoção rápida pneu carro",
    "Peso de Equilíbrio de Ferro para Pneus de Carros, Motocicletas e Veículos Leves",
    "Correntes de Pneus Antiderrapantes para Carro em TPU e Aço",
    "Adesivos Refletivos para Carrinho de Bebê com aviso para Pneus Noturnos",
    "Kit com 4 Válvulas de Pneu Tubeless para Carros e Motocicletas",
    "Tampas Decorativas para Válvulas de Pneus de Carro",
    "Adesivos de Aviso de Segurança para Pneu e Roda de Carro",
    "Ferramenta de Remoção e Instalação de Válvulas para Pneus de Carro",
    "Rebites Pontiagudos para Rodas e Aros de Carro com Tampa para Pneus"
  ].map((title) => ({ title }));
  const actualTires = [
    { title: "Pneu de carro radial 205/55 R16" },
    { title: "Pneu dianteiro para motocicleta 120/70-17" },
    { title: "Mountain bike tire 29 inch" }
  ];

  const result = filterRelevantAliExpressProducts([...accessoryTitles, ...actualTires], "PNEUS");
  assert.deepEqual(result.products, actualTires);
  assert.equal(result.filteredOut, accessoryTitles.length);
  for (const product of accessoryTitles) {
    assert.equal(isRelevantAliExpressProduct(product, "pneus"), false, product.title);
  }
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


test("motor único resolve categorias do site e separa produto principal de acessórios em várias categorias", () => {
  assert.equal(normalizeSiteCategory("lighting fixtures"), "LUMINÁRIAS");
  assert.equal(normalizeSiteCategory("electrical and plumbing"), "ELÉTRICA & HIDRÁULICA");
  assert.equal(normalizeSiteCategory("handbags backpacks"), "BOLSAS & MOCHILAS");
  assert.ok(SITE_CATEGORY_TREE.length >= 6);
  assert.equal(classifySiteProduct({ title: "Air Fryer Digital 6L", categoryOverride: "Móveis" }), "Eletrodomésticos");
  assert.equal(classifySiteProduct({ title: "Air Fryer Digital 6L with removable basket" }), "Eletrodomésticos");
  assert.equal(classifySiteProduct({ title: "Silicone liner for air fryer" }), "Utilidades");
  assert.equal(classifySiteProduct({ title: "Refrigerator organizer bins" }), "Utilidades");
  assert.equal(classifySiteProduct({ title: "Toy kitchen set for kids" }), "Brinquedos");
  assert.equal(classifySiteProduct({ title: "Modern ceiling light fixture" }), "LUMINÁRIAS");
  assert.equal(classifySiteProduct({ title: "LED light bulb E27" }), "LUMINÁRIAS");
  assert.equal(classifySiteProduct({ title: "Lamp socket holder E27" }), "ELÉTRICA & HIDRÁULICA");
  assert.equal(classifySiteProduct({ title: "USB cable extension cord" }), "ELÉTRICA & HIDRÁULICA");
  assert.equal(classifySiteProduct({ title: "Kitchen faucet tap" }), "ELÉTRICA & HIDRÁULICA");
  assert.equal(classifySiteProduct({ title: "School backpack for children" }), "BOLSAS & MOCHILAS");
});

test("correspondência aproximada corrige transposição e resiste a falsos positivos por uma letra", () => {
  assert.equal(buildAliExpressKeywords("pnues"), "tire");
  assert.equal(isRelevantAliExpressProduct({ title: "Car tire 205/55 R16" }, "pnues"), true);
  assert.equal(isRelevantAliExpressProduct({ title: "Wooden chair dining room" }, "chain"), false);
  assert.equal(scoreProductTitleMatch({ title: "Air Fryer Digital 6L" }, "air fryre").accepted, true);
});

test("a categoria inferida do texto pesquisado prevalece sobre a categoria de destino conflitante", () => {
  assert.equal(scoreProductTitleMatch({ title: "Air Fryer Digital 6L" }, "air fryer", "Móveis").requestedCategory, "Eletrodomésticos");
  assert.equal(isRelevantAliExpressProduct({ title: "Air Fryer Digital 6L with removable basket" }, "air fryer"), true);
  assert.equal(isRelevantAliExpressProduct({ title: "Replacement basket for air fryer" }, "air fryer"), false);
  assert.equal(isRelevantAliExpressProduct({ title: "Silicone liner for air fryer" }, "air fryer", "Móveis"), false);
  assert.equal(isRelevantAliExpressProduct({ title: "Gas stove two burner" }, "air fryer"), false);
  assert.equal(isRelevantAliExpressProduct({ title: "Pneu de carro radial 205/55 R16" }, "pneus"), true);
});

test("busca pelo nome da categoria inclui tipos variados de brinquedo sem abrir mão da categoria correta", () => {
  const toys = [
    { title: "Magnetic Building Blocks Set 100 Pieces", category: "Toys & Hobbies" },
    { title: "Wooden Jigsaw Puzzle for Kids", category: "Toys & Hobbies" },
    { title: "Anime Action Figure Doll", category: "Toys & Hobbies" },
    { title: "Crochet Plush Bat Toy", category: "Toys & Hobbies" }
  ];
  const notToys = [
    { title: "Replacement Strap for Toy", category: "Toys & Hobbies" },
    { title: "USB Phone Charger", category: "Toys & Hobbies" }
  ];

  const result = filterRelevantAliExpressProducts([...toys, ...notToys], "Brinquedos");
  assert.deepEqual(result.products.map((product) => product.title), toys.map((product) => product.title));
  assert.equal(result.receivedCount, 6);
  assert.equal(result.filteredOut, 2);
  assert.equal(scoreProductTitleMatch({ title: "Gas Stove Two Burner" }, "air fryer").accepted, false);
});
