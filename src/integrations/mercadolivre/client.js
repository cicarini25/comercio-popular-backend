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
      const url = new URL(`${API_BASE}/items/bulk`);
      url.searchParams.set("ids", batch.join(","));

      const headers = {
        accept: "application/json",
        "user-agent": "ComercioPopular/1.0"
      };

      if (this.accessToken) {
        headers.authorization = `Bearer ${this.accessToken}`;
      }

      let response = await fetch(url, { headers });
      let text = await response.text();

      // /items/bulk é um recurso de consulta de item. Caso o token OAuth
      // não tenha escopo para essa consulta, tenta novamente sem Bearer.
      if ((response.status === 401 || response.status === 403) && this.accessToken) {
        const publicHeaders = {
          accept: "application/json",
          "user-agent": "ComercioPopular/1.0"
        };
        response = await fetch(url, { headers: publicHeaders });
        text = await response.text();
      }

      if (!response.ok) {
        throw new Error(
          `Mercado Livre /items/bulk: HTTP ${response.status}; ` +
          text.slice(0, 300)
        );
      }

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Mercado Livre retornou uma resposta sem JSON válido.");
      }

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error(
          "Mercado Livre retornou uma lista vazia ou um formato inesperado."
        );
      }

      const batchResults = [];
      const receivedIds = new Set();

      for (const result of data) {
        const status = Number(result?.status_code ?? result?.code);
        const item = result?.body;
        const itemId = result?.id ?? item?.id ?? "não informado";

         if (status !== 200) {
         throw new Error(
        `Mercado Livre /items/bulk: item ${itemId}; ` +
        `HTTP ${Number.isFinite(status) ? status : "não informado"}; ` +
       `resposta: ${JSON.stringify(result)}`
           
        );
           
        }

        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(
            `Item ${itemId}: resposta sem os dados do produto em body.`
          );
        }

        if (!item.id || !batch.includes(String(item.id))) {
          throw new Error(
            `Item ${itemId}: ID ausente ou diferente dos IDs solicitados.`
          );
        }

        if (receivedIds.has(String(item.id))) {
          throw new Error(`Mercado Livre retornou o item ${item.id} duplicado.`);
        }

        this.normalizeProduct(item);
        receivedIds.add(String(item.id));

        // Mantém o formato esperado pelo importador existente.
        batchResults.push({ code: 200, body: item });
      }

      const missingIds = batch.filter((id) => !receivedIds.has(id));

      if (missingIds.length > 0) {
        throw new Error(
          `Mercado Livre não retornou os itens: ${missingIds.join(", ")}.`
        );
      }

      results.push(...batchResults);
    }

    return results;
  }

  normalizeProduct(rawProduct) {
    const wrapped =
      rawProduct &&
      typeof rawProduct === "object" &&
      (
        "body" in rawProduct ||
        "status_code" in rawProduct ||
        "code" in rawProduct
      );

    const item = wrapped ? rawProduct.body : rawProduct;

    if (!item?.id) {
      throw new Error("Resposta do Mercado Livre sem item.id dentro do produto.");
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
