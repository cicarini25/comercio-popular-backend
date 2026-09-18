import express from "express";
import { importMercadoLivreProducts } from "../integrations/mercadolivre/importer.js";

const router = express.Router();

function requireIntegrationAdmin(req, res, next) {
  const configured = process.env.INTEGRATION_ADMIN_TOKEN?.trim();
  const authorization = req.headers.authorization ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : req.headers["x-integration-token"];

  if (!configured) {
    return res.status(503).json({
      error: "Integrações administrativas não configuradas. Defina INTEGRATION_ADMIN_TOKEN."
    });
  }

  if (!provided || provided !== configured) {
    return res.status(401).json({ error: "Credencial de integração inválida." });
  }

  next();
}

// POST /api/integrations/mercadolivre/import
// Importa uma carga de URLs/ITEM_IDs usando a API oficial de catálogo do Mercado Livre.
// Este endpoint é administrativo e nunca deve ficar exposto sem INTEGRATION_ADMIN_TOKEN.
router.post("/mercadolivre/import", requireIntegrationAdmin, async (req, res) => {
  try {
    const result = await importMercadoLivreProducts({
      items: req.body?.items,
      accessToken: process.env.MELI_ACCESS_TOKEN,
      categoryOverride: req.body?.category
    });

    res.status(200).json({
      ok: true,
      marketplace: "mercadolivre",
      ...result
    });
  } catch (error) {
    console.error("Erro na importação Mercado Livre:", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Falha na importação."
    });
  }
});

export default router;
