import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pool from './db.js'

try {
  const sqlPath = new URL('./schema.sql', import.meta.url)
  const sql = await readFile(fileURLToPath(sqlPath), 'utf8')
  await pool.query(sql)
  console.log('Estrutura do Prometheus Chat aplicada.')
} catch (error) {
  console.error('Não foi possível aplicar a estrutura do Prometheus Chat.')
  console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
  process.exitCode = 1
} finally {
  await pool.end()
}
