import crypto from 'node:crypto';
import pool from '../../db/pool.js';

const MP_API = 'https://api.mercadopago.com';
const MP_AUTH = 'https://auth.mercadopago.com.br/authorization';
let schemaReady;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Mercado Pago: variável ${name} não configurada.`);
  return value;
}

function encryptionKey() {
  const raw = required('MERCADOPAGO_OAUTH_ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('MERCADOPAGO_OAUTH_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais.');
  return Buffer.from(raw, 'hex');
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(value) {
  const [ivPart, tagPart, ciphertextPart] = String(value || '').split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Token Mercado Pago criptografado inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
}

function hashState(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function splitEnabled() {
  return String(process.env.MERCADOPAGO_SPLIT_ENABLED || '').toLowerCase() === 'true';
}

export function marketplaceFee(total) {
  const percent = Number(process.env.MERCADOPAGO_MARKETPLACE_FEE_PERCENT || 0);
  const fixed = Number(process.env.MERCADOPAGO_MARKETPLACE_FEE_FIXED || 0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('MERCADOPAGO_MARKETPLACE_FEE_PERCENT inválido.');
  if (!Number.isFinite(fixed) || fixed < 0) throw new Error('MERCADOPAGO_MARKETPLACE_FEE_FIXED inválido.');
  return Number(Math.min(total, (total * percent / 100) + fixed).toFixed(2));
}

export function sellerAmount(total, fee) {
  return Number(Math.max(0, total - fee).toFixed(2));
}

export async function ensureMarketplaceSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS mercadopago_seller_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        seller_id UUID NOT NULL UNIQUE REFERENCES sellers(id) ON DELETE CASCADE,
        mp_user_id VARCHAR(80) NOT NULL UNIQUE,
        public_key VARCHAR(255),
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        scope VARCHAR(255),
        live_mode BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(20) NOT NULL DEFAULT 'connected',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mercadopago_oauth_states (
        state_hash VARCHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_expires ON mercadopago_oauth_states(expires_at);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS mp_seller_account_id UUID REFERENCES mercadopago_seller_accounts(id) ON DELETE SET NULL;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketplace_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function createOAuthState(userId) {
  await ensureMarketplaceSchema();
  const raw = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO mercadopago_oauth_states (state_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
    [hashState(raw), userId],
  );
  return raw;
}

export async function consumeOAuthState(raw) {
  await ensureMarketplaceSchema();
  const result = await pool.query(
    `DELETE FROM mercadopago_oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id`,
    [hashState(raw)],
  );
  return result.rows[0]?.user_id || null;
}

export function marketplaceAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: required('MERCADOPAGO_CLIENT_ID'),
    response_type: 'code',
    platform_id: 'mp',
    redirect_uri: required('MERCADOPAGO_REDIRECT_URI'),
    state,
  });
  return `${MP_AUTH}?${params}`;
}

async function exchangeCode(code) {
  const response = await fetch(`${MP_API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: required('MERCADOPAGO_CLIENT_ID'),
      client_secret: required('MERCADOPAGO_CLIENT_SECRET'),
      grant_type: 'authorization_code',
      code,
      redirect_uri: required('MERCADOPAGO_REDIRECT_URI'),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token || !data.refresh_token || !data.user_id) {
    throw new Error(data.message || 'Não foi possível conectar a conta Mercado Pago do vendedor.');
  }
  return data;
}

export async function connectSellerAccount(userId, code) {
  const token = await exchangeCode(code);
  await ensureMarketplaceSchema();
  const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
  if (seller.rowCount !== 1) throw new Error('O usuário precisa ter um cadastro de vendedor ativo antes de conectar o Mercado Pago.');
  await pool.query(
    `INSERT INTO mercadopago_seller_accounts
      (seller_id, mp_user_id, public_key, access_token, refresh_token, token_expires_at, scope, live_mode, status)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 second'), $7, $8, 'connected')
     ON CONFLICT (seller_id) DO UPDATE SET mp_user_id = EXCLUDED.mp_user_id,
       public_key = EXCLUDED.public_key, access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at,
       scope = EXCLUDED.scope, live_mode = EXCLUDED.live_mode, status = 'connected', updated_at = now()`,
    [seller.rows[0].id, String(token.user_id), token.public_key || null, encrypt(token.access_token), encrypt(token.refresh_token), Number(token.expires_in || 15552000), token.scope || null, Boolean(token.live_mode)],
  );
  return token;
}

export async function getSellerAccountBySellerId(sellerId) {
  await ensureMarketplaceSchema();
  const result = await pool.query('SELECT * FROM mercadopago_seller_accounts WHERE seller_id = $1 AND status = \'connected\'', [sellerId]);
  return result.rows[0] || null;
}

export async function getSellerAccessToken(account) {
  if (!account) return null;
  if (new Date(account.token_expires_at).getTime() - Date.now() > 7 * 24 * 60 * 60 * 1000) return decrypt(account.access_token);
  const response = await fetch(`${MP_API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: required('MERCADOPAGO_CLIENT_ID'),
      client_secret: required('MERCADOPAGO_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: decrypt(account.refresh_token),
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token || !token.refresh_token) {
    await pool.query(`UPDATE mercadopago_seller_accounts SET status = 'reauthorization_required', updated_at = now() WHERE id = $1`, [account.id]);
    throw new Error('A autorização Mercado Pago do vendedor expirou; é necessário conectar novamente.');
  }
  await pool.query(
    `UPDATE mercadopago_seller_accounts SET access_token = $1, refresh_token = $2, token_expires_at = now() + ($3 * interval '1 second'), updated_at = now() WHERE id = $4`,
    [encrypt(token.access_token), encrypt(token.refresh_token), Number(token.expires_in || 15552000), account.id],
  );
  return token.access_token;
}

export async function getSellerAccountStatus(userId) {
  await ensureMarketplaceSchema();
  const result = await pool.query(
    `SELECT a.mp_user_id, a.public_key, a.status, a.live_mode, a.token_expires_at
       FROM mercadopago_seller_accounts a JOIN sellers s ON s.id = a.seller_id
      WHERE s.user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

export function verifyWebhookSignature(req) {
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  if (!secret) return String(process.env.MERCADOPAGO_REQUIRE_WEBHOOK_SIGNATURE || '').toLowerCase() !== 'true';
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const dataId = String(req.query['data.id'] || req.query.id || req.body?.data?.id || '').toLowerCase();
  const ts = signature.match(/(?:^|,)ts=([^,]+)/)?.[1];
  const v1 = signature.match(/(?:^|,)v1=([^,]+)/)?.[1];
  if (!ts || !v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(v1, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function splitConfiguration() {
  return {
    enabled: splitEnabled(),
    marketplaceFeePercent: Number(process.env.MERCADOPAGO_MARKETPLACE_FEE_PERCENT || 0),
    marketplaceFeeFixed: Number(process.env.MERCADOPAGO_MARKETPLACE_FEE_FIXED || 0),
    shippingToSeller: true,
    checkout: 'Checkout Pro',
    model: '1:1',
  };
}
