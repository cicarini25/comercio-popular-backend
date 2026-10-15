import express from 'express';
import crypto from 'crypto';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const CODE_TTL_MS = 5 * 60 * 1000;
const HOURLY_LIMIT = 5;
const MAX_ATTEMPTS = 5;

async function ensureSmsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_verification_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone VARCHAR(20) NOT NULL,
      code_hash VARCHAR(128) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts SMALLINT NOT NULL DEFAULT 0,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sms_codes_user_created
      ON sms_verification_codes(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sms_codes_expiry
      ON sms_verification_codes(expires_at);
  `);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 15 && digits.startsWith('55')) return digits;
  return null;
}

function maskPhone(phone) {
  return phone.length >= 4 ? `+${phone.slice(0, 2)} (***) ***-${phone.slice(-4)}` : '+55 (***) ***-****';
}

function createCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(userId, code) {
  const secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('OTP_HASH_SECRET/JWT_SECRET não configurado.');
  return crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

function getZenviaConfig() {
  const token = process.env.ZENVIA_API_TOKEN || process.env.ZENVIA_TOKEN;
  const sender = process.env.ZENVIA_SMS_FROM || process.env.ZENVIA_SMS_SENDER;
  if (!token || !sender) throw new Error('Zenvia SMS ainda não está configurado no Railway.');
  return {
    token,
    sender,
    url: process.env.ZENVIA_SMS_URL || 'https://api.zenvia.com/v2/channels/sms/messages',
  };
}

async function sendZenviaCode({ userId, phone, code }) {
  const config = getZenviaConfig();
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-TOKEN': config.token,
    },
    body: JSON.stringify({
      externalId: `comercio-popular-otp-${userId}`,
      from: config.sender,
      to: phone,
      contents: [{
        type: 'text',
        text: `Comercio Popular: seu codigo e ${code}. Valido por 5 minutos. Nao compartilhe.`,
      }],
    }),
  });

  if (!response.ok) {
    console.error('Falha no envio de OTP pela Zenvia. Status:', response.status);
    throw new Error('A Zenvia não aceitou o envio do código. Tente novamente.');
  }
}

router.post('/request', requireAuth, async (req, res) => {
  try {
    await ensureSmsSchema();

    const userResult = await pool.query(
      'SELECT id, phone, is_verified_sms FROM users WHERE id = $1',
      [req.userId],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!user.phone) return res.status(400).json({ error: 'Cadastre um telefone antes de solicitar o código.' });
    if (user.is_verified_sms === true) return res.json({ verified: true, message: 'Este telefone já está verificado.' });

    const phone = normalizePhone(user.phone);
    if (!phone) return res.status(400).json({ error: 'O telefone cadastrado não é válido.' });

    const recent = await pool.query(
      `SELECT id FROM sms_verification_codes
       WHERE user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '60 seconds'
       ORDER BY created_at DESC LIMIT 1`,
      [req.userId],
    );
    if (recent.rowCount) return res.status(429).json({ error: 'Aguarde um minuto antes de solicitar outro código.' });

    const hourly = await pool.query(
      `SELECT COUNT(*)::int AS total FROM sms_verification_codes
       WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [req.userId],
    );
    if (Number(hourly.rows[0]?.total || 0) >= HOURLY_LIMIT) {
      return res.status(429).json({ error: 'Limite de códigos atingido. Tente novamente mais tarde.' });
    }

    const code = createCode();
    const codeHash = hashCode(req.userId, code);
    const inserted = await pool.query(
      `INSERT INTO sms_verification_codes (user_id, phone, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.userId, phone, codeHash, new Date(Date.now() + CODE_TTL_MS)],
    );

    try {
      await sendZenviaCode({ userId: req.userId, phone, code });
    } catch (sendError) {
      await pool.query('DELETE FROM sms_verification_codes WHERE id = $1', [inserted.rows[0].id]);
      throw sendError;
    }

    return res.json({ sent: true, expiresIn: CODE_TTL_MS / 1000, phone: maskPhone(phone) });
  } catch (err) {
    console.error('Erro ao solicitar OTP:', err);
    return res.status(503).json({ error: err instanceof Error ? err.message : 'Não foi possível enviar o código SMS.' });
  }
});

router.post('/verify', requireAuth, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Digite o código de 6 números.' });

  try {
    await ensureSmsSchema();
    const result = await pool.query(
      `SELECT id, code_hash, expires_at, attempts
       FROM sms_verification_codes
       WHERE user_id = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [req.userId],
    );
    const pending = result.rows[0];

    if (!pending) return res.status(400).json({ error: 'Solicite um novo código.' });
    if (new Date(pending.expires_at).getTime() <= Date.now()) return res.status(400).json({ error: 'O código expirou. Solicite outro.' });
    if (pending.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Limite de tentativas atingido. Solicite outro código.' });

    await pool.query(
      'UPDATE sms_verification_codes SET attempts = attempts + 1 WHERE id = $1 AND consumed_at IS NULL',
      [pending.id],
    );

    const expected = Buffer.from(pending.code_hash, 'hex');
    const received = Buffer.from(hashCode(req.userId, code), 'hex');
    const matches = expected.length === received.length && crypto.timingSafeEqual(expected, received);
    if (!matches) return res.status(400).json({ error: 'Código inválido.' });

    const consumed = await pool.query(
      `UPDATE sms_verification_codes SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
      [pending.id],
    );
    if (consumed.rowCount !== 1) return res.status(409).json({ error: 'Esse código já foi utilizado.' });

    const userResult = await pool.query(
      `UPDATE users SET is_verified_sms = TRUE
       WHERE id = $1
       RETURNING id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller`,
      [req.userId],
    );

    return res.json({ verified: true, user: userResult.rows[0] });
  } catch (err) {
    console.error('Erro ao verificar OTP:', err);
    return res.status(500).json({ error: 'Não foi possível validar o código.' });
  }
});

export default router;

