import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
let schemaReady;

function clean(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function optionalUserId(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return payload.userId || null;
  } catch {
    return null;
  }
}

function validCpf(value) {
  if (value.length !== 11 || /^(\d)\1{10}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(value[index]) * (10 - index);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(value[9])) return false;
  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(value[index]) * (11 - index);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(value[10]);
}

function validCnpj(value) {
  if (value.length !== 14 || /^(\d)\1{13}$/.test(value)) return false;
  const calculate = (length) => {
    let sum = 0;
    let weight = length - 5;
    for (let index = 0; index < length; index += 1) {
      sum += Number(value[index]) * weight;
      weight -= 1;
      if (weight === 1) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(value[12]) && calculate(13) === Number(value[13]);
}

function validDocument(entityType, document) {
  const value = digits(document);
  return entityType === 'PJ' ? validCnpj(value) : validCpf(value);
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        plan VARCHAR(50) NOT NULL,
        entity_type VARCHAR(2) NOT NULL CHECK (entity_type IN ('PF', 'PJ')),
        store_name VARCHAR(150) NOT NULL,
        legal_name VARCHAR(180) NOT NULL,
        business_activity VARCHAR(180) NOT NULL,
        street VARCHAR(180) NOT NULL,
        address_number VARCHAR(30) NOT NULL,
        neighborhood VARCHAR(120) NOT NULL,
        cep VARCHAR(12) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(2) NOT NULL,
        phone VARCHAR(25) NOT NULL,
        email VARCHAR(150) NOT NULL,
        document_number VARCHAR(18) NOT NULL,
        website VARCHAR(220),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        review_notes TEXT,
        reviewed_at TIMESTAMPTZ,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_merchant_applications_user ON merchant_applications(user_id);
      CREATE INDEX IF NOT EXISTS idx_merchant_applications_status ON merchant_applications(status);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_merchant_applications_pending_document
        ON merchant_applications(document_number) WHERE status = 'pending';
      CREATE UNIQUE INDEX IF NOT EXISTS ux_sellers_user ON sellers(user_id);
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

router.post('/', async (req, res) => {
  const body = req.body || {};
  const entityType = body.entityType === 'PJ' ? 'PJ' : 'PF';
  const plan = clean(body.plan, 50);
  const storeName = clean(body.storeName, 150);
  const legalName = clean(body.legalName, 180);
  const businessActivity = clean(body.businessActivity, 180);
  const street = clean(body.street, 180);
  const addressNumber = clean(body.addressNumber, 30);
  const neighborhood = clean(body.neighborhood, 120);
  const cep = clean(body.cep, 12);
  const city = clean(body.city, 100);
  const state = clean(body.state, 2).toUpperCase();
  const phone = clean(body.phone, 25);
  const email = clean(body.email, 150).toLowerCase();
  const documentNumber = digits(body.documentNumber);
  const website = clean(body.website, 220) || null;
  const password = String(body.password || '');

  if (!plan || !storeName || !legalName || !businessActivity || !street || !addressNumber || !neighborhood || !cep || !city || !state || !phone || !email || !documentNumber || !password) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios do cadastro.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter no mínimo 6 caracteres.' });
  if (!validDocument(entityType, documentNumber)) return res.status(400).json({ error: entityType === 'PJ' ? 'CNPJ inválido.' : 'CPF inválido.' });

  const userIdFromToken = optionalUserId(req);
  const client = await pool.connect();
  try {
    await ensureSchema();
    await client.query('BEGIN');

    let userId = userIdFromToken;
    if (userId) {
      const current = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (current.rowCount !== 1) userId = null;
    }

    if (!userId) {
      const existing = await client.query('SELECT id, password_hash FROM users WHERE lower(email) = $1', [email]);
      if (existing.rowCount > 0) {
        if (!existing.rows[0].password_hash || !(await bcrypt.compare(password, existing.rows[0].password_hash))) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Este e-mail já possui conta. Entre com sua senha ou use outro e-mail.' });
        }
        userId = existing.rows[0].id;
      } else {
        const passwordHash = await bcrypt.hash(password, 10);
        const created = await client.query(
          `INSERT INTO users (name, email, password_hash, cpf, phone)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [legalName, email, passwordHash, entityType === 'PF' ? documentNumber : null, phone],
        );
        userId = created.rows[0].id;
      }
    }

    const duplicate = await client.query(
      `SELECT id FROM merchant_applications
       WHERE (email = $1 OR document_number = $2) AND status = 'pending'`,
      [email, documentNumber],
    );
    if (duplicate.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Já existe uma solicitação pendente para este e-mail ou documento.' });
    }

    const result = await client.query(
      `INSERT INTO merchant_applications
        (user_id, plan, entity_type, store_name, legal_name, business_activity, street,
         address_number, neighborhood, cep, city, state, phone, email, document_number, website)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, plan, store_name, status, created_at`,
      [userId, plan, entityType, storeName, legalName, businessActivity, street, addressNumber, neighborhood, cep, city, state, phone, email, documentNumber, website],
    );

    await client.query('COMMIT');
    return res.status(201).json({ application: result.rows[0], message: 'Cadastro enviado para análise.' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Já existe uma solicitação pendente para este documento.' });
    console.error('Erro no cadastro de comerciante:', error);
    return res.status(500).json({ error: 'Não foi possível enviar o cadastro. Tente novamente.' });
  } finally {
    client.release();
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id, plan, entity_type, store_name, legal_name, status, review_notes, created_at, updated_at
       FROM merchant_applications WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.userId],
    );
    return res.json({ applications: result.rows });
  } catch (error) {
    console.error('Erro ao consultar cadastro de comerciante:', error);
    return res.status(500).json({ error: 'Não foi possível consultar o cadastro.' });
  }
});

function requireAdmin(req, res, next) {
  const allowed = String(process.env.ADMIN_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return res.status(403).json({ error: 'A análise administrativa ainda não foi configurada.' });
  pool.query('SELECT email FROM users WHERE id = $1', [req.userId]).then(({ rows }) => {
    if (!rows[0] || !allowed.includes(String(rows[0].email).toLowerCase())) return res.status(403).json({ error: 'Acesso restrito à análise de cadastros.' });
    next();
  }).catch(() => res.status(500).json({ error: 'Não foi possível validar o administrador.' }));
}

router.patch('/:id/review', requireAuth, requireAdmin, async (req, res) => {
  const status = req.body?.status === 'approved' ? 'approved' : req.body?.status === 'rejected' ? 'rejected' : null;
  if (!status) return res.status(400).json({ error: 'Informe status approved ou rejected.' });
  const client = await pool.connect();
  try {
    await ensureSchema();
    await client.query('BEGIN');
    const application = await client.query('SELECT * FROM merchant_applications WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (application.rowCount !== 1) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cadastro não encontrado.' }); }
    const row = application.rows[0];
    await client.query(
      `UPDATE merchant_applications SET status = $1, review_notes = $2, reviewed_at = now(), reviewed_by = $3, updated_at = now() WHERE id = $4`,
      [status, clean(req.body?.reviewNotes, 1000) || null, req.userId, row.id],
    );
    if (status === 'approved') {
      await client.query(
        `INSERT INTO sellers (user_id, store_name, plan, plan_status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT DO NOTHING`,
        [row.user_id, row.store_name, row.plan],
      );
      await client.query('UPDATE users SET is_seller = TRUE WHERE id = $1', [row.user_id]);
    }
    await client.query('COMMIT');
    return res.json({ status, message: status === 'approved' ? 'Comerciante aprovado.' : 'Cadastro recusado.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao analisar cadastro de comerciante:', error);
    return res.status(500).json({ error: 'Não foi possível concluir a análise.' });
  } finally {
    client.release();
  }
});

export default router;

