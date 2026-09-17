import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function isValidCPF(cpf) {
  cpf = String(cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let digit1 = (sum * 10) % 11;
  if (digit1 === 10) digit1 = 0;
  if (digit1 !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let digit2 = (sum * 10) % 11;
  if (digit2 === 10) digit2 = 0;
  return digit2 === parseInt(cpf[10], 10);
}

function issueToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/signup — cadastro tradicional continua exigindo identidade completa.
router.post('/signup', async (req, res) => {
  const { name, email, password, cpf, phone } = req.body;

  if (!name || !email || !password || !cpf) {
    return res.status(400).json({ error: 'Nome, e-mail, senha e CPF são obrigatórios.' });
  }
  if (!isValidCPF(cpf)) {
    return res.status(400).json({ error: 'CPF inválido.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha precisa ter no mínimo 6 caracteres.' });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanCpf = String(cpf).replace(/\D/g, '');
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR cpf = $2',
      [normalizedEmail, cleanCpf]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma conta com este e-mail ou CPF.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, cpf, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller`,
      [name, normalizedEmail, passwordHash, cleanCpf, phone]
    );

    const user = result.rows[0];
    const token = issueToken(user.id);

    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Erro no cadastro:', err);
    res.status(500).json({ error: 'Erro ao criar conta. Tente novamente.' });
  }
});

// POST /api/auth/login — login tradicional por e-mail/senha.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const token = issueToken(user.id);
    delete user.password_hash;

    res.json({ user, token });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro ao entrar na conta. Tente novamente.' });
  }
});

// POST /api/auth/google — primeiro acesso social entra direto e recebe uma conta Comércio Popular.
router.post('/google', async (req, res) => {
  const { idToken } = req.body || {};

  if (!idToken) {
    return res.status(400).json({ error: 'Token do Google ausente.' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error('Erro ao verificar token do Google:', err);
    return res.status(401).json({ error: 'Não foi possível validar o login com o Google.' });
  }

  const googleId = payload?.sub;
  const email = typeof payload?.email === 'string' && payload.email.length <= 150
    ? payload.email.trim().toLowerCase()
    : null;
  const name = typeof payload?.name === 'string' && payload.name.trim()
    ? payload.name.trim().slice(0, 150)
    : 'Cliente';

  if (!googleId) return res.status(401).json({ error: 'O Google não retornou a identidade da conta.' });
  if (payload?.email && payload?.email_verified !== true) {
    return res.status(401).json({ error: 'O e-mail da conta Google não está verificado.' });
  }

  try {
    let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    let user = result.rows[0];

    if (!user && email) {
      result = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
      user = result.rows[0];
      if (user) {
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]);
      }
    }

    if (!user) {
      const insertResult = await pool.query(
        `INSERT INTO users (name, email, password_hash, cpf, phone, google_id)
         VALUES ($1, $2, NULL, NULL, NULL, $3)
         RETURNING id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller`,
        [name, email, googleId]
      );
      user = insertResult.rows[0];
    }

    const token = issueToken(user.id);
    res.json({ status: 'authenticated', user, token });
  } catch (err) {
    console.error('Erro no login com Google:', err);
    const status = err.code === '23505' ? 409 : 500;
    res.status(status).json({ error: status === 409 ? 'Esta identidade já está vinculada a outra conta.' : 'Erro ao entrar com Google. Tente novamente.' });
  }
});

// GET /api/auth/me — retorna os dados do usuário logado a partir do token
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller
       FROM users WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });
  }
});

export default router;
