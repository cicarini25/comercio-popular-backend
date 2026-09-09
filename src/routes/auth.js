import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function isValidCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let digit1 = (sum * 10) % 11;
  if (digit1 === 10) digit1 = 0;
  if (digit1 !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let digit2 = (sum * 10) % 11;
  if (digit2 === 10) digit2 = 0;
  return digit2 === parseInt(cpf[10]);
}

function issueToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/signup
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
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR cpf = $2',
      [email, cpf]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma conta com este e-mail ou CPF.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, cpf, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller`,
      [name, email, passwordHash, cpf, phone]
    );

    const user = result.rows[0];
    const token = issueToken(user.id);

    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Erro no cadastro:', err);
    res.status(500).json({ error: 'Erro ao criar conta. Tente novamente.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
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
