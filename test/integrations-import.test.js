import test from "node:test";
import assert from "node:assert/strict";
import {
  extractMercadoLivreItemId,
  uniqueMercadoLivreItemIds
} from "../src/integrations/mercadolivre/importer.js";

test("extrai ITEM_ID de wid", () => {
  assert.equal(
    extractMercadoLivreItemId(
      "https://www.mercadolivre.com.br/produto/p/MLB123456?pdp_filters=item_id%3AMLB987654321&wid=MLB987654321"
    ),
    "MLB987654321"
  );
});

test("extrai ITEM_ID de pdp_filters", () => {
  assert.equal(
    extractMercadoLivreItemId(
      "https://www.mercadolivre.com.br/produto/p/MLB123456?pdp_filters=item_id%3AMLB987654321"
    ),
    "MLB987654321"
  );
});

test("deduplica IDs e ignora URL de outro domínio", () => {
  const result = uniqueMercadoLivreItemIds([
    "MLB123",
    "MLB123",
    "https://www.mercadolivre.com.br/produto/p/MLB1?wid=MLB456",
    "https://example.com/produto/MLB789"
  ]);

  assert.deepEqual(result, ["MLB123", "MLB456"]);
});

test("extrai ITEM_ID do padrão usado na lista TUDO PARA CASA", () => {
  assert.equal(
    extractMercadoLivreItemId(
      "https://www.mercadolivre.com.br/lixeira-inteligente/p/MLB54545450?pdp_filters=item_id%3AMLB4699336817"
    ),
    "MLB4699336817"
  );
});
