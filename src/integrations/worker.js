import "dotenv/config";
import pool from "../db/pool.js";
import { importMercadoLivreProducts } from "./mercadolivre/importer.js";

const POLL_MS = Number(process.env.INTEGRATION_WORKER_POLL_MS || 3000);
const BATCH_SIZE = Math.min(Number(process.env.INTEGRATION_WORKER_BATCH_SIZE || 20), 20);
const MAX_JOB_ATTEMPTS = Number(process.env.INTEGRATION_WORKER_MAX_ATTEMPTS || 3);
const LEASE_MINUTES = Number(process.env.INTEGRATION_WORKER_LEASE_MINUTES || 30);

let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

export async function recoverStaleJobs() {
  await pool.query(
    `UPDATE catalog_import_jobs
        SET status = 'queued',
            updated_at = now(),
            metadata = COALESCE(metadata, '{}'::jsonb) || '{"recovered":true}'::jsonb
      WHERE status = 'processando'
        AND updated_at < now() - ($1::text || ' minutes')::interval`,
    [LEASE_MINUTES]
  );
}

export async function claimNextImportJob() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, platform_id, integration_connection_id, source_type, status,
              requested_count, discovered_count, imported_count, updated_count,
              matched_count, review_count, error_count, metadata
         FROM catalog_import_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );

    if (!result.rows[0]) {
      await client.query("COMMIT");
      return null;
    }

    const job = result.rows[0];

    await client.query(
      `UPDATE catalog_import_jobs
          SET status = 'processando',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [job.id]
    );

    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processNextMercadoLivreBatch(job) {
  const pending = await pool.query(
    `SELECT id, external_id, source_url, normalized_url
       FROM catalog_import_items
      WHERE job_id = $1
        AND import_status IN ('pending', 'retry')
      ORDER BY created_at ASC
      LIMIT $2`,
    [job.id, BATCH_SIZE]
  );

  if (!pending.rows.length) {
    await finalizeJob(job.id);
    return { processed: 0, finished: true };
  }

  const inputs = pending.rows.map((row) => row.external_id || row.normalized_url || row.source_url);

  try {
    const result = await importMercadoLivreProducts({
      items: inputs,
      accessToken: process.env.MELI_ACCESS_TOKEN,
      categoryOverride: job.metadata?.category
    });

    const ids = pending.rows.map((row) => row.external_id).filter(Boolean);

    if (ids.length) {
      await pool.query(
        `UPDATE catalog_import_items
            SET import_status = 'importado',
                product_id = po.product_id,
                updated_at = now(),
                error_message = NULL
          FROM product_offers po
         WHERE catalog_import_items.job_id = $1
           AND catalog_import_items.external_id = po.external_id
           AND po.platform_id = $2
           AND po.external_id = ANY($3::text[])`,
        [job.id, job.platform_id, ids]
      );
    }

    await pool.query(
      `UPDATE catalog_import_items
          SET import_status = 'erro',
              error_message = 'Produto não retornado pela API do Mercado Livre.',
              updated_at = now()
        WHERE job_id = $1
          AND id = ANY($2::uuid[])
          AND import_status IN ('pending', 'retry')`,
      [job.id, pending.rows.map((row) => row.id)]
    );

    await pool.query(
      `UPDATE catalog_import_jobs
          SET discovered_count = discovered_count + $2,
              imported_count = imported_count + $3,
              updated_count = updated_count + $4,
              error_count = error_count + $5,
              updated_at = now()
        WHERE id = $1`,
      [
        job.id,
        result.returnedByApi,
        result.imported,
        result.updated,
        result.skipped
      ]
    );

    return {
      processed: pending.rows.length,
      finished: false,
      result
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na importação.";

    await pool.query(
      `UPDATE catalog_import_items
          SET import_status = 'retry',
              error_message = $2,
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [pending.rows.map((row) => row.id), message.slice(0, 500)]
    );

    throw error;
  }
}

async function finalizeJob(jobId) {
  const pending = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM catalog_import_items
      WHERE job_id = $1
        AND import_status IN ('pending', 'retry')`,
    [jobId]
  );

  if (pending.rows[0].count > 0) return false;

  const errors = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM catalog_import_items
      WHERE job_id = $1
        AND import_status = 'erro'`,
    [jobId]
  );

  await pool.query(
    `UPDATE catalog_import_jobs
        SET status = CASE WHEN $2 > 0 THEN 'concluido_com_erros' ELSE 'concluido' END,
            finished_at = now(),
            updated_at = now()
      WHERE id = $1
        AND status <> 'concluido'`,
    [jobId, errors.rows[0].count]
  );

  return true;
}

export async function runWorker() {
  console.log(
    `Comércio Popular integration worker iniciado (poll=${POLL_MS}ms, batch=${BATCH_SIZE}).`
  );

  await recoverStaleJobs();

  while (!stopping) {
    const job = await claimNextImportJob();

    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }

    try {
      const platform = await pool.query(
        "SELECT code FROM affiliate_platforms WHERE id = $1 LIMIT 1",
        [job.platform_id]
      );

      if (platform.rows[0]?.code !== "mercadolivre") {
        throw new Error("Worker atual suporta apenas o conector Mercado Livre.");
      }

      await processNextMercadoLivreBatch(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida.";
      const attempts = Number(job.metadata?.attempts || 0) + 1;

      if (attempts >= MAX_JOB_ATTEMPTS) {
        await pool.query(
          `UPDATE catalog_import_jobs
              SET status = 'falhou',
                  finished_at = now(),
                  updated_at = now(),
                  metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE id = $1`,
          [job.id, JSON.stringify({ attempts, lastError: message.slice(0, 500) })]
        );
      } else {
        await pool.query(
          `UPDATE catalog_import_jobs
              SET status = 'queued',
                  updated_at = now(),
                  metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE id = $1`,
          [job.id, JSON.stringify({ attempts, lastError: message.slice(0, 500) })]
        );
      }
    }
  }

  await pool.end();
  console.log("Comércio Popular integration worker finalizado.");
}

if (process.argv[1]?.endsWith("/worker.js")) {
  runWorker().catch((error) => {
    console.error("Integration worker erro fatal:", error);
    process.exit(1);
  });
}
