import crypto from "crypto";
import { MarketplaceConnector } from "../core/connector.js";
import { normalizeText } from "../core/normalizer.js";

const DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export class ShopeeAffiliateConnector extends MarketplaceConnector {
  constructor({ appId, secret, endpoint, subIds } = {}) {
    super({ code: "shopee", name: "Shopee" });
    this.appId = appId?.trim() || undefined;
    this.secret = secret?.trim() || undefined;
    this.endpoint = endpoint?.trim() || DEFAULT_ENDPOINT;
    this.subIds = Array.isArray(subIds) ? subIds.filter(Boolean).slice(0, 5) : [];
  }

  isConfigured() {
    return Boolean(this.appId && this.secret);
  }

  async generateAffiliateLink(productUrl, subIds = this.subIds) {
    this.assertConfigured();

    const query = `mutation GenerateShortLink($input: GenerateShortLinkInput!) {
  generateShortLink(input: $input) {
    shortLink
  }
}`;

    const payloadObject = {
      query,
      operationName: "GenerateShortLink",
      variables: {
        input: {
          originUrl: productUrl,
          ...(subIds.length ? { subIds: subIds.slice(0, 5) } : {})
        }
      }
    };

    const payload = JSON.stringify(payloadObject);
    const response = await this.request(payload);
    const shortLink = response?.data?.generateShortLink?.shortLink;

    if (!shortLink) {
      throw new Error(extractShopeeError(response) || "Shopee não retornou shortLink.");
    }

    return {
      affiliateUrl: shortLink,
      provider: "shopee",
      source: "generateShortLink",
      raw: response
    };
  }

  async searchOffers({ keyword = "", categoryId, itemId, shopId, page = 1, limit = DEFAULT_LIMIT } = {}) {
    this.assertConfigured();

    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const safePage = Math.max(Number(page) || 1, 1);

    const query = `query ProductOfferV2(
  $productCatId: Int,
  $itemId: Int64,
  $shopId: Int64,
  $keyword: String,
  $sortType: Int,
  $page: Int,
  $limit: Int
) {
  productOfferV2(
    productCatId: $productCatId,
    itemId: $itemId,
    shopId: $shopId,
    keyword: $keyword,
    sortType: $sortType,
    page: $page,
    limit: $limit
  ) {
    nodes {
      itemId
      productName
      productLink
      offerLink
      imageUrl
      priceMin
      priceMax
      priceDiscountRate
      sales
      ratingStar
      commissionRate
      sellerCommissionRate
      shopeeCommissionRate
      commission
      shopId
      shopName
      shopType
      productCatIds
      periodStartTime
      periodEndTime
    }
    pageInfo {
      page
      limit
      hasNextPage
    }
  }
}`;

    const variables = {
      sortType: 5,
      page: safePage,
      limit: safeLimit
    };

    if (keyword?.trim()) variables.keyword = keyword.trim();
    if (itemId !== undefined && itemId !== null && /^\d+$/.test(String(itemId))) {
      variables.itemId = Number(itemId);
    }
    if (shopId !== undefined && shopId !== null && /^\d+$/.test(String(shopId))) {
      variables.shopId = Number(shopId);
    }
    if (categoryId !== undefined && categoryId !== null && categoryId !== "") {
      variables.productCatId = Number(categoryId);
    }

    const payload = JSON.stringify({
      query,
      operationName: "ProductOfferV2",
      variables
    });

    const response = await this.request(payload);
    const data = response?.data?.productOfferV2;

    if (!data) {
      throw new Error(extractShopeeError(response) || "Shopee não retornou productOfferV2.");
    }

    return {
      products: (data.nodes ?? []).map(mapShopeeOffer),
      pageInfo: data.pageInfo ?? {
        page: safePage,
        limit: safeLimit,
        hasNextPage: false
      }
    };
  }

  normalizeProduct(rawProduct) {
    const item = rawProduct?.node ?? rawProduct;
    if (!item?.itemId && !item?.productName) {
      throw new Error("Resposta Shopee sem identificador/título do produto.");
    }

    return mapShopeeOffer(item);
  }

  async request(payload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHash("sha256")
      .update(`${this.appId}${timestamp}${payload}${this.secret}`)
      .digest("hex");

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `SHA256 Credential=${this.appId},Timestamp=${timestamp},Signature=${signature}`,
        "user-agent": "ComercioPopular/1.0"
      },
      body: payload
    });

    const text = await response.text();
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Shopee respondeu conteúdo inválido (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(
        extractShopeeError(parsed) || `Shopee respondeu HTTP ${response.status}.`
      );
    }

    if (parsed?.errors?.length) {
      throw new Error(extractShopeeError(parsed) || "Shopee retornou erro GraphQL.");
    }

    return parsed;
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error(
        "Shopee Affiliate Open API não configurada. Defina SHOPEE_AFFILIATE_APP_ID e SHOPEE_AFFILIATE_SECRET."
      );
    }
  }
}

function mapShopeeOffer(item) {
  const priceMin = toNumber(item.priceMin);
  const priceMax = toNumber(item.priceMax);
  const commissionRate = toNumber(item.commissionRate);
  const discountRate = toNumber(item.priceDiscountRate);

  return {
    marketplace: "shopee",
    externalId: item.itemId ? String(item.itemId) : undefined,
    title: item.productName ?? "",
    productUrl: item.productLink ?? "",
    affiliateUrl: item.offerLink ?? undefined,
    imageUrl: item.imageUrl ?? undefined,
    price: priceMin,
    priceMax,
    originalPrice: discountRate > 0 && priceMin !== undefined
      ? Number((priceMin / (1 - discountRate / 100)).toFixed(2))
      : undefined,
    discountPercent: discountRate,
    commissionRate,
    commissionAmount: toNumber(item.commission),
    sellerCommissionRate: toNumber(item.sellerCommissionRate),
    shopeeCommissionRate: toNumber(item.shopeeCommissionRate),
    sales: toNumber(item.sales),
    rating: toNumber(item.ratingStar),
    shopId: item.shopId ? String(item.shopId) : undefined,
    shopName: item.shopName ?? undefined,
    categoryIds: item.productCatIds ?? [],
    periodStartTime: item.periodStartTime ?? undefined,
    periodEndTime: item.periodEndTime ?? undefined,
    attributes: {
      shop: normalizeText(item.shopName ?? "")
    },
    raw: item
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractShopeeError(payload) {
  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length) {
    const first = errors[0];
    const code = first?.extensions?.code;
    const message = first?.message ?? first?.extensions?.message;
    return code ? `Shopee [${code}]: ${message ?? "erro"}` : message;
  }

  return payload?.error?.message ?? payload?.message;
}

export { DEFAULT_ENDPOINT, MAX_LIMIT };

