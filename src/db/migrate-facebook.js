import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pool from './pool.js';
try {
  await pool.query(await readFile(new URL('./facebook.sql', import.meta.url), 'utf8'));
  console.log('Migração Facebook concluída.');
} catch { console.error('Falha na migração Facebook. Confira DATABASE_URL e acesso ao banco.'); process.exitCode = 1; }
finally { await pool.end(); }
