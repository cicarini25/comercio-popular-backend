import express from 'express'
import pool from '../db.js'
import { requirePrometheusUser, userIdFromAccountToken } from '../middleware/auth.js'

const router = express.Router()
const rawUpstreamBase = (process.env.ACCOUNT_API_BASE_URL || 'http://localhost:3333/api').trim().replace(/\/$/, '')
const upstreamBase = /^https?:\/\//i.test(rawUpstreamBase) ? rawUpstreamBase : `https://${rawUpstreamBase}`
const accountRequestTimeoutMs = Number.parseInt(process.env.PROMETHEUS_ACCOUNT_TIMEOUT_MS || '15000', 10)
const loginWindowMs = 15 * 60 * 1000
const maxLoginAttempts = 8
const loginAttempts = new Map()

function limitLoginAttempts(req, res, next) {
  const now = Date.now()
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(key)
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + loginWindowMs }
  if (entry.count >= maxLoginAttempts) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
  }

  let settled = false
  const recordResult = () => {
    if (settled) return
    settled = true
    if (res.statusCode >= 400) {
      const current = loginAttempts.get(ip) || { count: 0, resetAt: now + loginWindowMs }
      loginAttempts.set(ip, { count: current.count + 1, resetAt: current.resetAt })
    } else {
      loginAttempts.delete(ip)
    }
  }
  res.once('finish', recordResult)
  res.once('close', recordResult)
  return next()
}

function sessionCookieOptions() {
  const secure = process.env.PROMETHEUS_COOKIE_SECURE === 'true'
    || (process.env.PROMETHEUS_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production')
  const requestedSameSite = (process.env.PROMETHEUS_COOKIE_SAME_SITE || 'lax').toLowerCase()
  const sameSite = ['lax', 'strict', 'none'].includes(requestedSameSite) ? requestedSameSite : 'lax'
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/prometheus',
    maxAge: 8 * 60 * 60 * 1000,
  }
}

function isSafeAccountApiBase() {
  try {
    const url = new URL(upstreamBase)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return false
    return true
  } catch {
    return false
  }
}

async function accountPost(path, payload, clientIp) {
  if (!isSafeAccountApiBase()) {
    const error = new Error('O serviço de contas não está configurado para este ambiente.')
    error.status = 503
    throw error
  }

  let response
  try {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (typeof clientIp === 'string' && clientIp.length > 0 && clientIp.length <= 100) {
      headers['X-Forwarded-For'] = clientIp
    }
    response = await fetch(`${upstreamBase}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(accountRequestTimeoutMs),
    })
  } catch (cause) {
    const error = new Error(cause?.name === 'TimeoutError'
      ? 'O serviço de contas demorou além do limite. Tente novamente.'
      : 'Não foi possível alcançar o serviço de contas.')
    error.status = cause?.name === 'TimeoutError' ? 504 : 503
    throw error
  }

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const upstreamMessage = typeof result?.error === 'string' ? result.error.trim().slice(0, 240) : ''
    const error = new Error(upstreamMessage || 'Não foi possível validar os dados da conta.')
    error.status = [400, 401, 403, 409, 422, 429].includes(response.status) ? response.status : 502
    throw error
  }
  return result
}

async function openPrometheusSession(res, result) {
  if (result?.status === 'legal_required' && typeof result.legalToken === 'string') {
    return res.json({ status: 'legal_required', legalToken: result.legalToken, user: result.user || null })
  }

  const token = typeof result?.token === 'string' ? result.token : ''
  const userId = userIdFromAccountToken(token)
  if (!userId) return res.status(502).json({ error: 'O serviço de contas não retornou uma sessão válida.' })

  try {
    const account = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1 LIMIT 1',
      [userId],
    )
    if (!account.rowCount) return res.status(401).json({ error: 'A conta não está disponível neste banco.' })
    const options = sessionCookieOptions()
    if (options.sameSite === 'none' && !options.secure) {
      return res.status(500).json({ error: 'A sessão segura está configurada incorretamente.' })
    }
    res.cookie('prometheus_session', token, options)
    return res.json({ status: 'authenticated', user: account.rows[0], expiresInSeconds: 8 * 60 * 60 })
  } catch (error) {
    console.error('Falha ao criar a sessão do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(503).json({ error: 'O serviço está temporariamente indisponível.' })
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

router.post('/login', limitLoginAttempts, asyncRoute(async (req, res) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : ''
  const password = req.body?.password
  if (!identifier || identifier.length > 150 || typeof password !== 'string' || !password || password.length > 256) {
    return res.status(400).json({ error: 'Informe um e-mail ou CPF e uma senha válidos.' })
  }

  const cpfDigits = identifier.replace(/\D/g, '')
  const isCpf = /^\d{11}$/.test(cpfDigits) && /^[\d.\-/\s]+$/.test(identifier)
  let email = identifier
  if (isCpf) {
    const account = await pool.query('SELECT email FROM users WHERE cpf = $1 LIMIT 1', [cpfDigits])
    email = typeof account.rows[0]?.email === 'string' ? account.rows[0].email.trim() : ''
    if (!email) return res.status(401).json({ error: 'E-mail/CPF ou senha incorretos.' })
  }

  const result = await accountPost('/auth/login', { email, password }, req.ip)
  return openPrometheusSession(res, result)
}))

router.post('/signup', asyncRoute(async (req, res) => {
  const { name, email, password, cpf, phone } = req.body || {}
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 150
    || typeof email !== 'string' || !email.trim() || email.trim().length > 150
    || typeof password !== 'string' || password.length < 6 || password.length > 256
    || typeof cpf !== 'string' || !/^\d{11}$/.test(cpf)) {
    return res.status(400).json({ error: 'Confira nome, e-mail, senha e CPF antes de criar a conta.' })
  }
  const payload = { name: name.trim(), email: email.trim(), password, cpf }
  if (typeof phone === 'string' && phone.trim().length <= 30) payload.phone = phone.trim()
  const result = await accountPost('/auth/signup', payload, req.ip)
  return openPrometheusSession(res, result)
}))

router.post('/google', asyncRoute(async (req, res) => {
  const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : ''
  if (!idToken || idToken.length > 12_000) return res.status(400).json({ error: 'O Google não retornou um token válido.' })
  const result = await accountPost('/auth/google', { idToken }, req.ip)
  return openPrometheusSession(res, result)
}))

router.post('/legal/accept', asyncRoute(async (req, res) => {
  const legalToken = typeof req.body?.legalToken === 'string' ? req.body.legalToken : ''
  if (!legalToken || legalToken.length > 12_000 || req.body?.accepted !== true) {
    return res.status(400).json({ error: 'É necessário aceitar os Termos de Serviço e a Política de Privacidade.' })
  }
  const result = await accountPost('/auth/legal/accept', { legalToken, accepted: true }, req.ip)
  return openPrometheusSession(res, result)
}))

router.get('/', requirePrometheusUser, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email FROM users WHERE id = $1 LIMIT 1',
    [req.userId],
  )
  if (!result.rowCount) return res.status(401).json({ error: 'A conta não está disponível.' })
  return res.json({ user: result.rows[0] })
}))

router.post('/logout', (_req, res) => {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions()
  res.clearCookie('prometheus_session', options)
  return res.status(204).end()
})

export default router
