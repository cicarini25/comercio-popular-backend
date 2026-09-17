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

export function issueLegalPendingToken(userId, provider) {
  return jwt.sign(
    { purpose: 'legal_acceptance', userId, provider, version: CURRENT_LEGAL_VERSION },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
}

export async function socialAuthResponse(user, provider, db = pool) {
  await ensureLegalSchema(db);
  if (!user.legal_accepted_at || user.legal_version !== CURRENT_LEGAL_VERSION) {
    return {
      status: 'legal_required',
      legalToken: issueLegalPendingToken(user.id, provider),
      user,
      legalVersion: CURRENT_LEGAL_VERSION,
    };
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  return { status: 'authenticated', token, user };
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
