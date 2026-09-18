import test from "node:test";
import assert from "node:assert/strict";
import { MercadoLivreConnector, findBestMatches, scoreProductMatch, selectCatalogMatch } from "../src/integrations/index.js";

test("pareia por GTIN de forma determinística", () => {
  const result = scoreProductMatch(
    {
      title: "Cafeteira Elgin Coffee Break Preta",
      brand: "Elgin",
      model: "Coffee Break",
      gtin: "7897013551234"
    },
    {
      title: "Cafeteira Elgin Coffee Break 15 Xícaras",
      brand: "Elgin",
      model: "Coffee Break",
      gtin: "7897013551234"
    }
  );

  assert.equal(result.score, 1);
  assert.equal(result.decision, "automatico");
});

test("conflito de GTIN impede auto-pareamento", () => {
  const result = scoreProductMatch(
    {
      title: "Produto A",
      brand: "Marca X",
      model: "Modelo 1",
      gtin: "7897013551234"
    },
    {
      title: "Produto A",
      brand: "Marca X",
      model: "Modelo 1",
      gtin: "7897013559999"
    }
  );

  assert.equal(result.contradictions.includes("gtin_conflict"), true);
  assert.notEqual(result.decision, "automatico");
});

test("escolhe o melhor candidato por identidade e título", () => {
  const results = findBestMatches(
    {
      title: "Ventilador Mondial Super Power 40cm",
      brand: "Mondial",
      model: "VSP40 B",
      category: "eletroportateis"
    },
    [
      { id: "errado", title: "Ventilador Mondial 30cm", brand: "Mondial", model: "VSP30" },
      {
        id: "certo",
        title: "Ventilador de Mesa Super Power 40cm Mondial",
        brand: "Mondial",
        model: "VSP40 B",
        category: "eletroportateis"
      }
    ],
    2
  );

  assert.equal(results[0].candidate.id, "certo");
  assert.equal(results[0].match.basis.includes("model_exact"), true);
});

test("seleciona pareamento automático quando existe identidade forte", () => {
  const result = selectCatalogMatch(
    {
      title: "Fone Bluetooth Marca X Modelo Y",
      brand: "Marca X",
      model: "Modelo Y"
    },
    [
      { id: "master-1", title: "Fone Marca X Modelo Y", brand: "Marca X", model: "Modelo Y" }
    ]
  );

  assert.equal(result.decision, "automatico");
  assert.equal(result.automaticMatch.candidate.id, "master-1");
});

test("manda para revisão quando há similaridade suficiente sem identidade forte", () => {
  const result = selectCatalogMatch(
    {
      title: "Cadeira Escritório Ergonômica Apoio Lombar",
      brand: "Marca X",
      category: "moveis",
      attributes: { cor: "preta", material: "plastico" }
    },
    [
      {
        id: "master-2",
        title: "Cadeira Escritório Ergonômica com Apoio Lombar",
        brand: "Marca X",
        category: "moveis",
        attributes: { cor: "preta", material: "plastico" }
      }
    ]
  );

  assert.equal(result.decision, "revisao");
  assert.equal(result.reviewMatch.candidate.id, "master-2");
});

test("Mercado Livre quebra lotes em no máximo 20 IDs", async () => {
  const connector = new MercadoLivreConnector({ accessToken: "test-token" });
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response("[]", { status: 200 });
  };

  try {
    await connector.getProductsBulk(Array.from({ length: 21 }, (_, index) => `MLB${index + 1}`));
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]).searchParams.get("ids").split(",").length, 20);
  assert.equal(new URL(requestedUrls[1]).searchParams.get("ids").split(",").length, 1);
});
