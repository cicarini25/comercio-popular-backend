import jwt from 'jsonwebtoken'
import pool from '../db.js'

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function userIdFromAccountToken(token) {
  const secret = process.env.JWT_SECRET
  if (!secret || typeof token !== 'string' || !token) return null
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
    const userId = typeof payload?.userId === 'string' ? payload.userId : ''
    return USER_ID_PATTERN.test(userId) ? userId : null
  } catch {
    return null
  }
}

function readCookie(req, name) {
  const cookieHeader = req.get('cookie') || ''
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try { return decodeURIComponent(value.join('=')) } catch { return '' }
    }
  }
  return ''
}

export async function requirePrometheusUser(req, res, next) {
  const token = readCookie(req, 'prometheus_session')

  if (!token) {
    return res.status(401).json({ error: 'Entre na sua conta para acessar suas conversas.' })
  }

  try {
    const userId = userIdFromAccountToken(token)
    if (!userId) {
      return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' })
    }

    const account = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId])
    if (!account.rowCount) {
      return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' })
    }

    req.userId = userId
    return next()
  } catch (error) {
    if (error?.code) {
      console.error('Falha ao validar a conta do Prometheus Chat.')
      return res.status(503).json({ error: 'O serviço está temporariamente indisponível.' })
    }
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Entre novamente.' })
  }
}
