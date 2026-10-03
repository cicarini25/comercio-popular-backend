const DEFAULT_CONCURRENCY = Math.min(Math.max(Number(process.env.SHOPEE_IMAGE_CONCURRENCY || 4), 1), 8);
const MAX_ITEMS = 100;

function imageUrlFromKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.startsWith("http://") || key.startsWith("https://")) return key || null;
  return `https://down-br.img.susercontent.com/file/${key.replace(/^\/+/,"")}`;
}

export function extractShopeeImageUrl(payload) {
  const item = payload?.data?.item;
  if (!item || typeof item !== "object") return null;

  const candidates = [
    item.image,
    item.image_url,
    item.imageUrl,
    Array.isArray(item.images) ? item.images[0] : null,
    Array.isArray(item.image_list) ? item.image_list[0] : null
  ];

  for (const candidate of candidates) {
    const url = imageUrlFromKey(candidate);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" &&
          (parsed.hostname === "down-br.img.susercontent.com" || parsed.hostname === "cf.shopee.com.br")) {
        return parsed.href;
      }
    } catch {
      // ignore malformed image values
    }
  }

  return null;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      referer: options.referer || "https://shopee.com.br/",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON response */ }

  if (!response.ok) {
    throw new Error(`Shopee image endpoint HTTP ${response.status}.`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Shopee image endpoint retornou resposta inválida.");
  }

  return data;
}

async function resolveOne(item) {
  const id = String(item?.itemid ?? item?.itemId ?? "").trim();
  const productUrl = String(item?.product_link ?? item?.productUrl ?? "").trim();
  const match = productUrl.match(/^https:\/\/shopee\.com\.br\/product\/(\d+)\/(\d+)$/);
  if (!/^\d+$/.test(id) || !match || match[2] !== id) {
    throw new Error("Item/URL incompatível.");
  }

  const shopId = match[1];
  const endpoints = [
    {
      url: `https://shopee.com.br/api/v4/item/get?itemid=${id}&shopid=${shopId}`,
      options: { method: "GET", referer: productUrl }
    },
    {
      url: `https://shopee.com.br/api/v4/pdp/get?shop_id=${shopId}&item_id=${id}`,
      options: { method: "GET", referer: productUrl }
    }
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const payload = await requestJson(endpoint.url, endpoint.options);
      const returnedItem = payload?.data?.item ?? payload?.data;
      const returnedId = returnedItem?.item_id == null && returnedItem?.itemid == null
        ? null
        : String(returnedItem.item_id ?? returnedItem.itemid);
      const returnedShop = returnedItem?.shop_id == null && returnedItem?.shopid == null
        ? null
        : String(returnedItem.shop_id ?? returnedItem.shopid);
      if (returnedId && returnedId !== id) continue;
      if (returnedShop && returnedShop !== shopId) continue;

      const image = extractShopeeImageUrl(payload);
      if (image) return { itemId: id, imageUrl: image, source: endpoint.url };
      lastError = new Error("Endpoint Shopee não retornou imagem.");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Imagem não encontrada.");
}

export async function resolveShopeeImages(items, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  if (!Array.isArray(items)) throw new Error("items deve ser um array.");
  if (items.length > MAX_ITEMS) throw new Error(`Resolva no máximo ${MAX_ITEMS} imagens por chamada.`);

  const safeConcurrency = Math.min(Math.max(Number(concurrency) || DEFAULT_CONCURRENCY, 1), DEFAULT_CONCURRENCY);
  const resolved = [];
  const missing = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(safeConcurrency, Math.max(items.length, 1)) }, () => (async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      try {
        resolved.push(await resolveOne(item));
      } catch (error) {
        missing.push({
          itemId: String(item?.itemid ?? item?.itemId ?? ""),
          message: error instanceof Error ? error.message : "Falha ao recuperar imagem."
        });
      }
    }
  })());

  await Promise.all(workers);
  resolved.sort((a,b) => a.itemId.localeCompare(b.itemId));
  missing.sort((a,b) => a.itemId.localeCompare(b.itemId));
  return { resolved, missing };
}
