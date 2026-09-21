import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

export const CURRENT_LEGAL_VERSION = '1';

export async function ensureLegalSchema(db = pool) {
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_version VARCHAR(32);
  `);
}

export function issueLegalPendingToken(userId, provider, env = process.env) {
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET não configurado.');
  return jwt.sign(
    { purpose: 'legal_acceptance', userId, provider, version: CURRENT_LEGAL_VERSION },
    secret,
    { expiresIn: '10m' },
  );
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: typeof user.email === 'string' ? user.email : '',
    cpf: user.cpf || '',
    phone: user.phone || '',
    is_verified_face: user.is_verified_face === true,
    is_verified_sms: user.is_verified_sms === true,
    is_seller: user.is_seller === true,
  };
}

export async function socialAuthResponse(user, provider, db = pool, env = process.env) {
  await ensureLegalSchema(db);
  const userForResponse = safeUser(user);

  if (!user.legal_accepted_at || user.legal_version !== CURRENT_LEGAL_VERSION) {
    return {
      status: 'legal_required',
      legalToken: issueLegalPendingToken(user.id, provider, env),
      user: userForResponse,
      legalVersion: CURRENT_LEGAL_VERSION,
    };
  }

  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET não configurado.');
  const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '30d' });
  return { status: 'authenticated', token, user: userForResponse };
}

const router = express.Router();

router.post('/accept', async (req, res) => {
  const { legalToken, accepted } = req.body || {};
  if (!legalToken || accepted !== true) {
    return res.status(400).json({ error: 'É necessário aceitar os Termos de Serviço e a Política de Privacidade.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(legalToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'A confirmação das regras expirou. Inicie o login novamente.' });
  }

  if (
    decoded?.purpose !== 'legal_acceptance'
    || !decoded?.userId
    || decoded?.version !== CURRENT_LEGAL_VERSION
  ) {
    return res.status(401).json({ error: 'Confirmação das regras inválida.' });
  }

  try {
    await ensureLegalSchema();
    const result = await pool.query(
      `UPDATE users
       SET legal_accepted_at = now(), legal_version = $1
       WHERE id = $2
       RETURNING id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller`,
      [CURRENT_LEGAL_VERSION, decoded.userId],
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    return res.json({ status: 'authenticated', token, user });
  } catch (err) {
    console.error('Erro ao registrar aceite das regras:', err);
    return res.status(500).json({ error: 'Não foi possível registrar a confirmação das regras.' });
  }
});

export default router;
