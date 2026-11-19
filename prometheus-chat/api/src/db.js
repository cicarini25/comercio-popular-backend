import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não foi configurada.')
}

const sslEnabled = process.env.PGSSL === 'true'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled
    ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  max: Number.parseInt(process.env.PG_POOL_MAX || '10', 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
})

pool.on('error', (error) => {
  console.error('Erro inesperado na conexão PostgreSQL do Prometheus Chat.')
  console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
})

export default pool
