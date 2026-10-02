import pool from "../db/pool.js";

export async function restoreShopeeCatalogState() {
  try {
    const result = await pool.query(`
      WITH shopee AS (
        SELECT id FROM affiliate_platforms
        WHERE code='shopee'
        LIMIT 1
      ),
      reactivated_offers AS (
        UPDATE product_offers po
           SET is_active=TRUE,
               updated_at=now()
         FROM shopee s
        WHERE po.platform_id=s.id
          AND po.affiliate_url IS NOT NULL
          AND po.affiliate_url <> ''
        RETURNING po.product_id
      )
      UPDATE products p
         SET status='ativo',
             is_achadinho=TRUE,
             updated_at=now()
       WHERE p.source='shopee'
         AND (p.status <> 'ativo'
              OR p.is_achadinho=FALSE
              OR p.id IN (SELECT product_id FROM reactivated_offers))
      RETURNING p.id
    `);
    console.log(`Shopee catalog state restored: ${result.rowCount} products.`);
  } catch (error) {
    console.error(
      "Shopee catalog state restore failed:",
      error instanceof Error ? error.message : error
    );
  }
}

void restoreShopeeCatalogState();
