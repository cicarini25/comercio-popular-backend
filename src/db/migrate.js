import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  console.log('Aplicando schema.sql no banco de dados...');
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'); // necessário para gen_random_uuid()
  await pool.query(sql);
  console.log('Schema aplicado com sucesso!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Erro ao migrar banco de dados:', err);
  process.exit(1);
});
