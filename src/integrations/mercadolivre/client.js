import { MarketplaceConnector } from "../core/connector.js";
import { normalizeGtin, normalizeText } from "../core/normalizer.js";

const API_BASE = "https://api.mercadolibre.com";
const MAX_BULK = 20;

export class MercadoLivreConnector extends MarketplaceConnector {
  constructor({ accessToken } = {}) {
    super({ code: "mercadolivre", name: "Mercado Livre" });
    this.accessToken = accessToken?.trim() || undefined;
  }

  async getProductsBulk(externalIds) {
    const ids = [...new Set(externalIds.filter(Boolean).map(String))];
    const results = [];

    for (let index = 0; index < ids.length; index += MAX_BULK) {
      const batch = ids.slice(index, index + MAX_BULK);
      const url = new URL(`${API_BASE}/items`);
      url.searchParams.set("ids", batch.join(","));

      const headers = {
        accept: "application/json",
        "user-agent": "ComercioPopular/1.0"
      };
      if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;

      const response = await fetch(url, { headers });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Mercado Livre /items/bulk respondeu ${response.status}: ${body.slice(0, 300)}`);
      }

      results.push(...JSON.parse(body));
    }

    return results;
  }

  normalizeProduct(rawProduct) {
    const item = rawProduct?.body ?? rawProduct;
    if (!item?.id) throw new Error("Resposta do Mercado Livre sem item.id.");

    const brandAttribute = item.attributes?.find(
      (attribute) => attribute.id === "BRAND" || attribute.name === "Marca"
    );
    const modelAttribute = item.attributes?.find(
      (attribute) => attribute.id === "MODEL" || attribute.name === "Modelo"
    );
    const gtinAttribute = item.attributes?.find(
      (attribute) => ["GTIN", "EAN", "UPC"].includes(attribute.id)
    );

    return {
      marketplace: this.code,
      externalId: item.id,
      title: item.title ?? "",
      brand: brandAttribute?.value_name ?? "",
      model: modelAttribute?.value_name ?? "",
      gtin: normalizeGtin(gtinAttribute?.value_name),
      category: item.category_id ?? "",
      productUrl: item.permalink ?? "",
      imageUrl: item.thumbnail ?? item.pictures?.[0]?.url ?? "",
      price: item.price ?? null,
      originalPrice: item.original_price ?? null,
      currency: item.currency_id ?? "BRL",
      availableQuantity: item.available_quantity ?? null,
      condition: item.condition ?? "",
      attributes: Object.fromEntries(
        (item.attributes ?? [])
          .filter((attribute) => attribute.name && attribute.value_name)
          .map((attribute) => [normalizeText(attribute.name), attribute.value_name])
      ),
      raw: item
    };
  }
}
