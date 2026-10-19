import crypto from "crypto";
import { MarketplaceConnector } from "../core/connector.js";
import { normalizeGtin, normalizeText } from "../core/normalizer.js";

// The current affiliate product API documentation lists the TOP router for affiliate calls. Seller APIs use a different Open Platform endpoint.
const DEFAULT_ENDPOINT = "https://eco.taobao.com/router/rest";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;

/**
 * AliExpress Affiliate Open Platform connector.
 * The affiliate product APIs use signed TOP requests and do not require a
 * seller OAuth session. Credentials stay on the backend.
 */
export class AliExpressAffiliateConnector extends MarketplaceConnector {
  constructor({ appKey, appSecret, trackingId, endpoint, partnerId } = {}) {
    super({ code: "aliexpress", name: "AliExpress" });
    this.appKey = String(appKey ?? "").trim() || undefined;
    this.appSecret = String(appSecret ?? "").trim() || undefined;
    this.trackingId = String(trackingId ?? "").trim() || undefined;
    this.endpoint = String(endpoint ?? DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
    this.partnerId = String(partnerId ?? "comercio-popular").trim() || "comercio-popular";
  }

  isConfigured() {
    return Boolean(this.appKey && this.appSecret && this.trackingId);
  }

  async searchProducts({
    keywords = "",
    categoryIds,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    minSalePrice,
    maxSalePrice,
    sort = "SALE_PRICE_ASC",
    shipToCountry = "BR",
    targetCurrency = "BRL",
    targetLanguage = "PT",
    deliveryDays
  } = {}) {
    this.assertConfigured();

    const safePage = Math.max(Number(page) || 1, 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const params = {
      app_signature: this.trackingId,
      fields: [
        "commission_rate", "app_sale_price", "app_sale_price_currency", "original_price",
        "original_price_currency", "discount", "evaluate_rate", "first_level_category_id",
        "first_level_category_name", "second_level_category_id", "second_level_category_name",
        "product_detail_url", "product_id", "product_main_image_url", "product_small_image_urls",
        "product_title", "promotion_link", "sale_price", "sale_price_currency", "shop_id",
        "shop_url", "target_app_sale_price", "target_app_sale_price_currency",
        "target_original_price", "target_original_price_currency", "target_sale_price",
        "target_sale_price_currency"
      ].join(","),
      page_no: safePage,
      page_size: safePageSize,
      sort,
      target_currency: targetCurrency,
      target_language: targetLanguage,
      tracking_id: this.trackingId,
      ship_to_country: shipToCountry
    };

    if (String(keywords).trim()) params.keywords = String(keywords).trim();
    if (categoryIds) params.category_ids = String(categoryIds).trim();
    if (minSalePrice !== undefined && minSalePrice !== "") params.min_sale_price = Number(minSalePrice);
    if (maxSalePrice !== undefined && maxSalePrice !== "") params.max_sale_price = Number(maxSalePrice);
    if (deliveryDays !== undefined && deliveryDays !== "") params.delivery_days = String(deliveryDays);

    const response = await this.request("aliexpress.affiliate.product.query", params);
    const result = extractAffiliateResult(response);
    const products = Array.isArray(result?.products?.product)
      ? result.products.product
      : Array.isArray(result?.products)
        ? result.products
        : [];

    return {
      products: products.map((product) => this.normalizeProduct(product)),
      pageInfo: {
        page: Number(result?.current_page_no ?? safePage),
        pageSize: Number(result?.current_record_count ?? products.length),
        total: Number(result?.total_record_count ?? products.length),
        hasNextPage: products.length >= safePageSize
      },
      raw: response
    };
  }

  normalizeProduct(rawProduct) {
    const item = rawProduct?.product ?? rawProduct;
    const externalId = String(item?.product_id ?? item?.productId ?? item?.externalId ?? "").trim();
    const title = String(item?.product_title ?? item?.title ?? "").trim();
    const price = toPositiveNumber(
      item?.target_sale_price ?? item?.app_sale_price ?? item?.sale_price ?? item?.price
    );
    const originalPrice = toPositiveNumber(
      item?.target_original_price ?? item?.original_price
    );
    const productUrl = String(item?.product_detail_url ?? item?.productUrl ?? "").trim();
    const affiliateUrl = String(item?.promotion_link ?? item?.promotionLink ?? item?.affiliateUrl ?? "").trim();

    if (!externalId || !title || !price || !productUrl || !affiliateUrl) {
      throw new Error("AliExpress retornou um produto sem ID, título, preço ou link válido.");
    }

    const imageUrls = [
      item?.product_main_image_url ?? item?.imageUrl,
      ...(Array.isArray(item?.product_small_image_urls?.string) ? item.product_small_image_urls.string : []),
      ...(Array.isArray(item?.product_small_image_urls) ? item.product_small_image_urls : [])
    ].filter((value) => typeof value === "string" && value.trim());

    const category = String(
      item?.first_level_category_name || item?.second_level_category_name || item?.category || "AliExpress"
    ).trim();

    return {
      marketplace: this.code,
      externalId,
      title,
      brand: String(item?.brand_name ?? item?.brand ?? "").trim(),
      model: String(item?.model ?? "").trim(),
      gtin: normalizeGtin(item?.ean ?? item?.upc ?? item?.gtin),
      category,
      productUrl,
      affiliateUrl,
      imageUrl: imageUrls[0] || "",
      imageUrls: [...new Set(imageUrls)],
      price,
      originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
      currency: String(item?.target_sale_price_currency || item?.app_sale_price_currency || item?.currency || "BRL"),
      commissionRate: String(item?.commission_rate ?? "").trim(),
      rating: String(item?.evaluate_rate ?? "").trim(),
      shopId: item?.shop_id ? String(item.shop_id) : "",
      shopUrl: String(item?.shop_url ?? "").trim(),
      attributes: {
        category: normalizeText(category),
        shop: normalizeText(item?.shop_id ?? "")
      },
      raw: item
    };
  }

  async request(method, serviceParams = {}) {
    this.assertConfigured();
    const publicParams = {
      app_key: this.appKey,
      format: "json",
      method,
      partner_id: this.partnerId,
      sign_method: "hmac",
      timestamp: formatAliExpressTimestamp(),
      v: "2.0"
    };
    const params = { ...publicParams, ...serviceParams };
    const signPayload = Object.keys(params)
      .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== "")
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join("");
    params.sign = crypto.createHmac("md5", this.appSecret).update(signPayload, "utf8").digest("hex").toUpperCase();

    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value) !== "") body.set(key, String(value));
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
        "user-agent": "ComercioPopular/1.0"
      },
      body,
      signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(`AliExpress respondeu conteúdo inválido (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(`AliExpress respondeu HTTP ${response.status}.`);

    const envelope = extractAffiliateEnvelope(parsed);
    const result = extractAffiliateResult(parsed);
    const responseCode = Number(envelope?.resp_code ?? parsed?.code ?? 200);
    const responseMessage = envelope?.resp_msg || result?.resp_msg || parsed?.msg || parsed?.message;
    if (responseCode !== 200 || responseMessage && String(responseMessage).toLowerCase() !== "success") {
      throw new Error(`AliExpress: ${responseMessage || "a API recusou a consulta."}`);
    }
    return parsed;
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error(
        "AliExpress Affiliate API não configurada. Defina ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET e ALIEXPRESS_TRACKING_ID."
      );
    }
  }
}

function extractAffiliateResult(payload) {
  const envelope = extractAffiliateEnvelope(payload);
  return envelope?.result ?? envelope ?? {};
}

function extractAffiliateEnvelope(payload) {
  const wrapper = Object.values(payload ?? {}).find((value) => value && typeof value === "object" && (
    "resp_result" in value || "result" in value || "products" in value || "resp_code" in value
  ));
  if (!wrapper) return payload?.result ?? payload ?? {};
  return wrapper.resp_result ?? wrapper;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatAliExpressTimestamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

export { DEFAULT_ENDPOINT, MAX_PAGE_SIZE, extractAffiliateResult, extractAffiliateEnvelope, formatAliExpressTimestamp };

