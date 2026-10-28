import "dotenv/config";
import pool from "./pool.js";

try {
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url TEXT");
  console.log("Coluna products.video_url verificada.");
} catch (error) {
  console.error("Falha ao preparar a coluna products.video_url:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
