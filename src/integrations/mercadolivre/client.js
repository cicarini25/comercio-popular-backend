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
    const ids = [
      ...new Set(
        externalIds
          .filter(Boolean)
          .map((id) => String(id).trim())
          .filter(Boolean)
      )
    ];

    const results = [];

    for (let index = 0; index < ids.length; index += MAX_BULK) {
      const batch = ids.slice(index, index + MAX_BULK);
      const url = new URL(`${API_BASE}/items`);
      url.searchParams.set("ids", batch.join(","));

      const headers = {
        accept: "application/json",
        "user-agent": "ComercioPopular/1.0"
      };

      if (this.accessToken) {
        headers.authorization = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(url, { headers });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(
          `Mercado Livre /items respondeu ${response.status}: ${body.slice(0, 300)}`
        );
      }

      const data = JSON.parse(body);

      if (!Array.isArray(data)) {
        throw new Error("Mercado Livre retornou um formato inesperado.");
      }

      if (data.length === 0) {
        throw new Error(
          `Mercado Livre retornou uma lista vazia para: ${batch.join(", ")}.`
        );
      }

      for (const result of data) {
        if (result?.code != null && Number(result.code) !== 200) {
          const detail = result.body ?? {};

          throw new Error(
            `Mercado Livre: HTTP ${result.code}; ` +
            `erro: ${detail.error ?? "não informado"}; ` +
            `mensagem: ${detail.message ?? "não informada"}`
          );
        }

        this.normalizeProduct(result);
      }

      results.push(...data);
    }

    return results;
  }

  normalizeProduct(rawProduct) {
    const item = rawProduct?.body ?? rawProduct;

    if (!item?.id) {
      throw new Error("Resposta do Mercado Livre sem item.id.");
    }

    if (typeof item.title !== "string" || !item.title.trim()) {
      throw new Error(
        `Item ${item.id} retornou sem título. Importação cancelada.`
      );
    }

    if (
      typeof item.price !== "number" ||
      !Number.isFinite(item.price) ||
      item.price <= 0
    ) {
      throw new Error(
        `Item ${item.id} retornou sem preço válido. Importação cancelada.`
      );
    }

    const attributes = Array.isArray(item.attributes)
      ? item.attributes.filter(Boolean)
      : [];

    const brandAttribute = attributes.find(
      (attribute) =>
        attribute.id === "BRAND" || attribute.name === "Marca"
    );

    const modelAttribute = attributes.find(
      (attribute) =>
        attribute.id === "MODEL" || attribute.name === "Modelo"
    );

    const gtinAttribute = attributes.find(
      (attribute) => ["GTIN", "EAN", "UPC"].includes(attribute.id)
    );

    return {
      marketplace: this.code,
      externalId: item.id,
      title: item.title.trim(),
      brand: brandAttribute?.value_name ?? "",
      model: modelAttribute?.value_name ?? "",
      gtin: normalizeGtin(gtinAttribute?.value_name),
      category: item.category_id ?? "",
      productUrl: item.permalink ?? "",
      imageUrl:
        item.pictures?.[0]?.secure_url ||
        item.pictures?.[0]?.url ||
        item.secure_thumbnail ||
        item.thumbnail ||
        "",
      price: item.price,
      originalPrice: item.original_price ?? null,
      currency: item.currency_id ?? "BRL",
      availableQuantity: item.available_quantity ?? null,
      condition: item.condition ?? "",
      attributes: Object.fromEntries(
        attributes
          .filter((attribute) => attribute.name && attribute.value_name)
          .map((attribute) => [
            normalizeText(attribute.name),
            attribute.value_name
          ])
      ),
      raw: item
    };
  }
}
