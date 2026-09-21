import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import pool from '../db/pool.js';
import { ensureLegalSchema, socialAuthResponse } from './legal.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

function isValidCPF(cpf) {
  const digits = String(cpf ?? '').replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(digits[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(digits[10]);
}


export async function verifyFacebook(accessToken, env = process.env, fetcher = fetch) {
  const { FACEBOOK_APP_ID: appId, FACEBOOK_APP_SECRET: secret } = env;
  const version = env.FACEBOOK_GRAPH_VERSION || 'v26.0';
  if (!appId || !secret || !/^v\d+\.\d+$/.test(version)) throw fail(503, 'O Facebook ainda precisa ser configurado no servidor.');
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 4096) throw fail(400, 'Autorização do Facebook ausente.');

  const graph = async (path, params, bearer) => {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    url.search = new URLSearchParams(params).toString();
    let response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw fail(502, 'O Facebook não respondeu. Tente novamente.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) throw fail(401, 'Não foi possível validar o login com Facebook.');
    return data;
  };

  const { data } = await graph('debug_token', { input_token: accessToken }, `${appId}|${secret}`);
  const now = Date.now() / 1000;
  if (!data?.is_valid || String(data.app_id) !== appId || !data.user_id || data.type !== 'USER' ||
      !(data.expires_at > now) || (data.data_access_expires_at && data.data_access_expires_at <= now)) {
    throw fail(401, 'A autorização do Facebook expirou ou não pertence a este aplicativo.');
  }

  const profile = await graph(
    'me',
    { fields: 'id,name,email', appsecret_proof: createHmac('sha256', secret).update(accessToken).digest('hex') },
    accessToken,
  );
  if (profile.id !== data.user_id) throw fail(401, 'Identidade do Facebook inválida.');
  return profile;
}

export function createFacebookRouter({ db = pool, verify = verifyFacebook, env = process.env } = {}) {
  const router = express.Router();
  const attempts = new Map();

  router.get('/config', (_req, res) => {
    if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) return res.status(503).json({ error: 'Facebook ainda não configurado.' });
    res.json({ appId: env.FACEBOOK_APP_ID, version: env.FACEBOOK_GRAPH_VERSION || 'v26.0' });
  });

  router.post('/', async (req, res) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.ip;
    const record = attempts.get(key) || { count: 0, until: now + 60000 };
    if (++record.count > 30 || attempts.size > 10000) return res.status(429).json({ error: 'Aguarde um minuto antes de tentar novamente.' });
    attempts.set(key, record);

    let client;
    try {
      if (!env.JWT_SECRET) throw fail(503, 'Autenticação ainda não configurada.');
      const body = req.body || {};
      const profile = await verify(body.accessToken, env);
      client = await db.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`facebook:${profile.id}`]);
      await client.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;');
      await client.query('ALTER TABLE users ALTER COLUMN email DROP NOT NULL;');
      await ensureLegalSchema(client);

      let { rows: [user] } = await client.query(
        'SELECT u.* FROM users u JOIN facebook_identities f ON f.user_id=u.id WHERE f.facebook_id=$1',
        [profile.id],
      );

      if (!user) {
        const hasEmail = typeof profile.email === 'string'
          && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
          && profile.email.length <= 150;
        const email = hasEmail ? profile.email.trim().toLowerCase() : null;
        const name = typeof profile.name === 'string' && profile.name.trim()
          ? profile.name.trim().slice(0, 150)
          : 'Cliente';

        if (!hasEmail) {
          throw fail(400, 'O Facebook não retornou um e-mail válido. Complete o cadastro pelo Comércio Popular.');
        }

        {
          const existing = await client.query('SELECT * FROM users WHERE lower(email)=$1', [email]);
          if (existing.rows.length > 1) throw fail(409, 'Entre com o método original da sua conta.');
          user = existing.rows[0];
          if (user && !body.action) {
            await client.query('ROLLBACK');
            return res.json({ status: 'link_required', profile: { name, email } });
          }
        }

        if (!user && body.action !== 'register') {
          await client.query('ROLLBACK');
          return res.json({ status: 'registration_required', profile: { name, email } });
        }

        if (body.action === 'register') {
          if (typeof body.password !== 'string' || body.password.length < 6 || Buffer.byteLength(body.password) > 72) {
            throw fail(400, 'Informe uma senha com pelo menos 6 caracteres.');
          }
          if (!isValidCPF(body.cpf)) throw fail(400, 'CPF inválido.');
          if (typeof body.phone !== 'string' || String(body.phone).replace(/\D/g, '').length < 10) {
            throw fail(400, 'Informe um telefone válido.');
          }
          if (user) throw fail(409, 'Este e-mail já possui uma conta. Use a opção de vinculação.');
        }

        if (user) {
          if (body.action !== 'link') throw fail(409, 'Este e-mail já tem conta. Volte e entre novamente pelo Facebook.');
          if (!user.password_hash) throw fail(409, 'Esta conta utiliza outro login social. Entre pelo método original para acessá-la.');
          if (typeof body.password !== 'string' || body.password.length < 6 || Buffer.byteLength(body.password) > 72) {
            throw fail(400, 'Informe a senha da sua conta do Comércio Popular.');
          }
          if (!await bcrypt.compare(body.password, user.password_hash)) throw fail(401, 'Senha da loja incorreta.');
        } else {
          const result = await client.query(
            `INSERT INTO users(name,email,password_hash,cpf,phone)
             VALUES($1,$2,NULL,NULL,NULL)
             RETURNING *`,
            [name, email],
          );
          user = result.rows[0];
        }

        await client.query(
          'INSERT INTO facebook_identities(facebook_id,user_id) VALUES($1,$2)',
          [profile.id, user.id],
        );
      }

      const auth = await socialAuthResponse(user, 'Facebook', client, env);
      await client.query('COMMIT');
      return res.json(auth);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const status = error.code === '23505' ? 409 : error.status || 500;
      return res.status(status).json({
        error: error.code === '23505'
          ? 'Já existe uma conta com estes dados. Entre pelo método original.'
          : error.status
            ? error.message
            : 'Não foi possível entrar com Facebook. Confira a configuração e a migração do servidor.',
      });
    } finally {
      client?.release();
    }
  });

  return router;
}

export default createFacebookRouter();
