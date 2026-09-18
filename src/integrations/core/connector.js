export class MarketplaceConnector {
  constructor({ code, name }) {
    this.code = code;
    this.name = name;
  }

  async getProductsBulk(_externalIds) {
    throw new Error(`${this.name}: getProductsBulk não implementado.`);
  }

  normalizeProduct(_rawProduct) {
    throw new Error(`${this.name}: normalizeProduct não implementado.`);
  }

  async generateAffiliateLink(_productUrl) {
    throw new Error(`${this.name}: geração de link de afiliado não disponível neste conector.`);
  }
}
