import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

const router = express.Router();

const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 10 * 60 * 1000;

const clientSecret = () => process.env.TIKTOK_CLIENT_SECRET || process.env.SEGREDO_DO_CLIENTE_TIKTOK;
const frontendUrl = () => process.env.FRONTEND_URL || process.env.URL_FRONTEND || 'https://comerciopopular.shop';

function requireConfig() {
  const missing = [];
  if (!process.env.TIKTOK_CLIENT_KEY) missing.push('TIKTOK_CLIENT_KEY');
  if (!clientSecret()) missing.push('TIKTOK_CLIENT_SECRET/SEGREDO_DO_CLIENTE_TIKTOK');
  if (!process.env.TIKTOK_REDIRECT_URI) missing.push('TIKTOK_REDIRECT_URI');
  if (!frontendUrl()) missing.push('FRONTEND_URL/URL_FRONTEND');
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (missing.length) throw new Error(`Variáveis do TikTok ausentes: ${missing.join(', ')}`);
}

async function ensureSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await pool.query(`
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_open_id VARCHAR(255) UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_display_name VARCHAR(150);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_avatar_url TEXT;

    CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      state_hash VARCHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tiktok_oauth_handoffs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code_hash VARCHAR(64) UNIQUE NOT NULL,
      tiktok_open_id VARCHAR(255) NOT NULL,
      display_name VARCHAR(150),
      avatar_url TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_states_expires ON tiktok_oauth_states(expires_at);
    CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_handoffs_expires ON tiktok_oauth_handoffs(expires_at);
  `);
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1
          ? [part, '']
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function setOAuthCookie(res, state) {
  res.setHeader('Set-Cookie', [
    `cp_tiktok_oauth=${encodeURIComponent(state)}`,
    'Path=/api/auth/tiktok',
    'Max-Age=600',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; '));
}

function clearOAuthCookie(res) {
  res.setHeader('Set-Cookie', 'cp_tiktok_oauth=; Path=/api/auth/tiktok; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
}

function redirectToFrontend(path) {
  return `${frontendUrl().replace(/\/$/, '')}${path}`;
}

function issueToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function getTikTokUser(accessToken, fallbackOpenId) {
  const url = new URL(TIKTOK_USER_INFO_URL);
  url.searchParams.set('fields', 'open_id,display_name,avatar_url');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || (data?.error?.code && data.error.code !== 'ok')) {
    throw new Error(data?.error?.message || 'Não foi possível obter os dados básicos do TikTok.');
  }

  const user = data?.data?.user || {};
  return {
    openId: user.open_id || fallbackOpenId,
    displayName: user.display_name || null,
    avatarUrl: user.avatar_url || null,
  };
}

router.get('/tiktok', async (_req, res) => {
  try {
    requireConfig();
    await ensureSchema();

    const state = randomToken();
    await pool.query(
      'INSERT INTO tiktok_oauth_states (state_hash, expires_at) VALUES ($1, $2)',
      [sha256(state), new Date(Date.now() + STATE_TTL_MS)],
    );
    setOAuthCookie(res, state);

    const url = new URL(TIKTOK_AUTHORIZE_URL);
    url.searchParams.set('client_key', process.env.TIKTOK_CLIENT_KEY);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'user.info.basic');
    url.searchParams.set('redirect_uri', process.env.TIKTOK_REDIRECT_URI);
    url.searchParams.set('state', state);
    return res.redirect(url.toString());
  } catch (err) {
    console.error('Erro ao iniciar login TikTok:', err);
    return res.status(500).json({ error: 'Login com TikTok não está configurado corretamente.' });
  }
});

router.get('/tiktok/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    const params = new URLSearchParams({
      oauth: 'tiktok',
      error: String(errorDescription || error || 'Login com TikTok cancelado.'),
    });
    return res.redirect(redirectToFrontend(`/login?${params.toString()}`));
  }
  if (!code || !state) return res.status(400).send('Callback do TikTok inválido: code/state ausente.');

  try {
    requireConfig();
    await ensureSchema();

    const cookies = parseCookies(req);
    const expectedState = Buffer.from(String(state));
    const receivedState = Buffer.from(String(cookies.cp_tiktok_oauth || ''));
    const stateMatches = expectedState.length === receivedState.length
      && crypto.timingSafeEqual(expectedState, receivedState);
    clearOAuthCookie(res);
    if (!stateMatches) return res.status(400).send('Callback do TikTok inválido: estado da sessão não confere.');

    const stateResult = await pool.query(
      'DELETE FROM tiktok_oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING id',
      [sha256(String(state))],
    );
    if (stateResult.rowCount !== 1) {
      const params = new URLSearchParams({
        oauth: 'tiktok',
        error: 'A autorização do TikTok expirou ou não é válida. Tente novamente.',
      });
      return res.redirect(redirectToFrontend(`/login?${params.toString()}`));
    }

    const tokenResponse = await fetch(TIKTOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: clientSecret(),
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData?.open_id || !tokenData?.access_token) {
      console.error('Resposta de token TikTok:', tokenData);
      throw new Error(tokenData?.error_description || tokenData?.error?.message || 'TikTok não autorizou a troca do código.');
    }

    const tiktokUser = await getTikTokUser(tokenData.access_token, tokenData.open_id);
    if (!tiktokUser.openId) throw new Error('TikTok não retornou o identificador do usuário.');

    const handoff = randomToken();
    await pool.query(
      `INSERT INTO tiktok_oauth_handoffs
       (code_hash, tiktok_open_id, display_name, avatar_url, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sha256(handoff), tiktokUser.openId, tiktokUser.displayName, tiktokUser.avatarUrl, new Date(Date.now() + HANDOFF_TTL_MS)],
    );

    const params = new URLSearchParams({ oauth: 'tiktok', code: handoff });
    return res.redirect(redirectToFrontend(`/login?${params.toString()}`));
  } catch (err) {
    console.error('Erro no callback do TikTok:', err);
    const params = new URLSearchParams({
      oauth: 'tiktok',
      error: 'Não foi possível concluir o login com TikTok. Tente novamente.',
    });
    return res.redirect(redirectToFrontend(`/login?${params.toString()}`));
  }
});

router.post('/tiktok/exchange', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Código do TikTok ausente.' });

  try {
    await ensureSchema();
    const result = await pool.query(
      `UPDATE tiktok_oauth_handoffs
       SET used_at = now()
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING tiktok_open_id, display_name, avatar_url`,
      [sha256(String(code))],
    );
    if (result.rowCount !== 1) return res.status(401).json({ error: 'Código do login TikTok inválido ou expirado.' });

    const handoff = result.rows[0];
    let userResult = await pool.query(
      `SELECT id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller
       FROM users WHERE tiktok_open_id = $1`,
      [handoff.tiktok_open_id],
    );

    if (userResult.rowCount === 0) {
      try {
        userResult = await pool.query(
          `INSERT INTO users (name, email, password_hash, cpf, phone, tiktok_open_id, tiktok_display_name, tiktok_avatar_url)
           VALUES ($1, NULL, NULL, NULL, NULL, $2, $3, $4)
           RETURNING id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller`,
          [handoff.display_name || 'Cliente TikTok', handoff.tiktok_open_id, handoff.display_name, handoff.avatar_url],
        );
      } catch (err) {
        if (err.code !== '23505') throw err;
        userResult = await pool.query(
          `SELECT id, name, email, cpf, phone, is_verified_face, is_verified_sms, is_seller
           FROM users WHERE tiktok_open_id = $1`,
          [handoff.tiktok_open_id],
        );
      }
    }

    const user = userResult.rows[0];
    if (!user) return res.status(500).json({ error: 'Não foi possível criar a identidade do TikTok.' });
    const token = issueToken(user.id);
    return res.json({ status: 'authenticated', user, token });
  } catch (err) {
    console.error('Erro ao concluir exchange do TikTok:', err);
    return res.status(500).json({ error: 'Erro ao processar o login com TikTok.' });
  }
});

export default router;
