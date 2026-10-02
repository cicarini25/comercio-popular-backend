export function normalizeImageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).replace(/\\u002F/g, "/").replace(/\\u003A/g, ":"));
    if (url.protocol !== "https:") return null;
    if (!/(?:shopee\.com\.br|susercontent\.com|shopeemobile\.com)$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, "/")
    .replace(/\\\//g, "/");
}

export function extractShopeeMainImage(html) {
  if (!html) return null;
  const candidates = [];

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /"image":"(https?:\\\/\\\/[^"]+)"/i,
    /"image":"(https?:[^"]+)"/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) candidates.push(decodeHtml(match[1]));
  }

  for (const candidate of candidates) {
    const url = normalizeImageUrl(candidate);
    if (url) return url;
  }

  return null;
}

export async function resolveShopeeMainImage(productUrl, { timeoutMs = 12000 } = {}) {
  const url = new URL(productUrl);
  if (url.protocol !== "https:" || url.hostname !== "shopee.com.br") {
    throw new Error("Product Link Shopee inválido.");
  }

  const response = await fetch(url.href, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; ComercioPopularBot/1.0)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Shopee respondeu HTTP ${response.status}.`);
  }

  const html = await response.text();
  const image = extractShopeeMainImage(html);
  if (!image) {
    throw new Error("A página da Shopee não expôs uma imagem principal no HTML recebido.");
  }

  return image;
}
