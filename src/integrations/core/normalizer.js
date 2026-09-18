const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCompactText(value = "") {
  return normalizeText(value).replace(/\s+/g, "");
}

export function normalizeGtin(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return GTIN_LENGTHS.has(digits.length) ? digits : undefined;
}

export function normalizeBrand(value) {
  return normalizeCompactText(value);
}

export function normalizeModel(value) {
  return normalizeCompactText(value);
}

export function tokenize(value = "") {
  return normalizeText(value).split(" ").filter((token) => token.length >= 2);
}

export function buildNormalizedProduct(product) {
  const title = normalizeText(product.title);
  const brand = normalizeBrand(product.brand);
  const model = normalizeModel(product.model);
  const gtin = normalizeGtin(product.gtin ?? product.ean);

  const attributeEntries = Object.entries(product.attributes ?? {})
    .map(([key, value]) => [normalizeText(key), normalizeText(value)])
    .filter(([key, value]) => key && value);

  return {
    title,
    brand,
    model,
    gtin,
    category: normalizeText(product.category),
    attributes: Object.fromEntries(attributeEntries)
  };
}
