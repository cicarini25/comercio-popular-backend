import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import pool from '../db/pool.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export async function verifyFacebook(accessToken, env = process.env, fetcher = fetch) {
  const { FACEBOOK_APP_ID: appId, FACEBOOK_APP_SECRET: secret } = env;
  const version = env.FACEBOOK_GRAPH_VERSION || 'v26.0';
  if (!appId || !secret || !/^v\d+\.\d+$/.test(version)) throw fail(503, 'O Facebook ainda precisa ser configurado no servidor.');
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 4096) throw fail(400, 'Autorização do Facebook ausente.');
  const graph = async (path, params, bearer) => {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    url.search = new URLSearchParams(params).toString();
    let response;
    try { response = await fetcher(url, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(10000) }); }
    catch { throw fail(502, 'O Facebook não respondeu. Tente novamente.'); }
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
  const profile = await graph('me', { fields: 'id,name,email', appsecret_proof: createHmac('sha256', secret).update(accessToken).digest('hex') }, accessToken);
  if (profile.id !== data.user_id) throw fail(401, 'Identidade do Facebook inválida.');
  return profile;
}
function validCPF(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  return [9, 10].every(n => {
    let sum = 0; for (let i = 0; i < n; i++) sum += Number(cpf[i]) * (n + 1 - i);
    return ((sum * 10) % 11) % 10 === Number(cpf[n]);
  });
}
export function createFacebookRouter({ db = pool, verify = verifyFacebook, env = process.env } = {}) {
  const router = express.Router();
  // Bounded per-process throttle. No tokens, passwords or personal data are logged.
  const attempts = new Map();
  router.get('/config', (req, res) => {
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
      // Serialize requests for the same identity; unique constraints handle other races.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`facebook:${profile.id}`]);
      let { rows: [user] } = await client.query('SELECT u.* FROM users u JOIN facebook_identities f ON f.user_id=u.id WHERE f.facebook_id=$1', [profile.id]);
      if (!user) {
        const hasEmail = typeof profile.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) && profile.email.length <= 150;
        if (!hasEmail && !body.action) {
          await client.query('ROLLBACK');
          return res.json({ status: 'link_required', emailRequired: true, profile: { name: typeof profile.name === 'string' ? profile.name.slice(0,150) : 'Cliente', email: '' } });
        }
        // A manually supplied email only selects an EXISTING account. Its password
        // must be verified before binding the independently verified Facebook ID.
        if (!hasEmail && (body.action !== 'link' || typeof body.email !== 'string' || body.email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))) {
          throw fail(400, 'Informe o e-mail e a senha da sua conta existente para vincular o Facebook.');
        }
        const email = hasEmail ? profile.email.toLowerCase() : body.email.trim().toLowerCase();
        const existing = await client.query('SELECT * FROM users WHERE lower(email)=$1', [email]);
        if (existing.rows.length > 1) throw fail(409, 'Entre com o método original da sua conta.');
        user = existing.rows[0];
        if (!hasEmail && !user) throw fail(401, 'E-mail ou senha da loja incorretos.');
        const name = typeof profile.name === 'string' ? profile.name.slice(0,150) : 'Cliente';
        if (!body.action) {
          await client.query('ROLLBACK');
          return res.json({ status: user ? 'link_required' : 'registration_required', profile: { name, email } });
        }
        if (typeof body.password !== 'string' || body.password.length < 6 || Buffer.byteLength(body.password) > 72) throw fail(400, 'Informe uma senha de pelo menos 6 caracteres (máximo 72 bytes).');
        if (user) {
          if (body.action !== 'link') throw fail(409, 'Este e-mail já tem conta. Volte e entre novamente pelo Facebook.');
          if (!user.password_hash) throw fail(409, 'Esta conta utiliza Google. Entre com Google para acessá-la.');
          if (!await bcrypt.compare(body.password, user.password_hash)) throw fail(401, 'Senha da loja incorreta.');
        } else {
          if (body.action !== 'register') throw fail(409, 'Volte e escolha novamente sua conta Facebook.');
          const cpf = typeof body.cpf === 'string' ? body.cpf.replace(/\D/g, '') : '';
          const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
          if (!validCPF(cpf) || !/^\d{10,11}$/.test(phone)) throw fail(400, 'Confira seu CPF e telefone com DDD.');
          const result = await client.query('INSERT INTO users(name,email,password_hash,cpf,phone) VALUES($1,$2,$3,$4,$5) RETURNING *', [name,email,await bcrypt.hash(body.password,10),cpf,phone]);
          user = result.rows[0];
        }
        await client.query('INSERT INTO facebook_identities(facebook_id,user_id) VALUES($1,$2)', [profile.id,user.id]);
      }
      const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: '30d' });
      await client.query('COMMIT');
      const { id,name,email,cpf,phone,is_verified_face,is_verified_sms,is_seller } = user;
      res.json({ status: 'authenticated', token, user: { id,name,email,cpf,phone,is_verified_face,is_verified_sms,is_seller } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const status = error.code === '23505' ? 409 : error.status || 500;
      res.status(status).json({ error: error.code === '23505' ? 'Já existe uma conta com estes dados. Entre pelo método original.' : error.status ? error.message : 'Não foi possível entrar com Facebook. Confira a configuração e a migração do servidor.' });
    } finally { client?.release(); }
  });
  return router;
}
export default createFacebookRouter();
