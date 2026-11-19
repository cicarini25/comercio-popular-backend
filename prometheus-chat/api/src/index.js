import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pool from './db.js'
import conversationsRouter from './routes/conversations.js'
import sessionRouter from './routes/session.js'
import { requirePrometheusUser } from './middleware/auth.js'

const app = express()
const port = Number.parseInt(process.env.PORT || '3334', 10)
const allowedOrigins = new Set(
  (process.env.PROMETHEUS_ORIGINS || process.env.PROMETHEUS_PUBLIC_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
)

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não foi configurada.')

app.disable('x-powered-by')
app.set('trust proxy', 1)

function isAllowedOrigin(req, origin) {
  const normalized = typeof origin === 'string' ? origin.replace(/\/$/, '') : ''
  if (normalized && allowedOrigins.has(normalized)) return true
  try {
    return new URL(normalized).origin === `${req.protocol}://${req.get('host')}`
  } catch {
    return false
  }
}

app.use(cors((req, callback) => {
  const origin = req.get('origin')
  callback(null, {
    origin: origin && isAllowedOrigin(req, origin) ? origin : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Prometheus-Request'],
  })
}))
app.use(express.json({ limit: '32kb' }))
app.use('/api/prometheus', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

app.use('/api/prometheus', (req, res, next) => {
  const origin = req.get('origin')
  const originIsAllowed = origin ? isAllowedOrigin(req, origin) : req.get('sec-fetch-site') === 'same-origin'
  if (!originIsAllowed || req.get('x-prometheus-request') !== '1') {
    return res.status(403).json({ error: 'Origem ou cabeçalho de segurança não autorizado.' })
  }
  return next()
})

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    return res.json({ status: 'ok', service: 'prometheus-chat-api' })
  } catch {
    return res.status(503).json({ status: 'unavailable' })
  }
})

app.use('/api/prometheus/session', sessionRouter)
app.use('/api/prometheus/conversations', requirePrometheusUser, conversationsRouter)

async function purgeOldRateBuckets() {
  try {
    await pool.query(
      `DELETE FROM prometheus_chat_rate_buckets
        WHERE window_start_epoch < floor(extract(epoch FROM now()))::bigint - 86400`,
    )
  } catch {
    console.error('Não foi possível limpar limites antigos do Prometheus Chat.')
  }
}

void purgeOldRateBuckets()
const rateBucketCleanupTimer = setInterval(purgeOldRateBuckets, 60 * 60 * 1000)
rateBucketCleanupTimer.unref()

app.use((error, _req, res, _next) => {
  if (error?.message === 'Origem não autorizada.') {
    return res.status(403).json({ error: 'Origem não autorizada.' })
  }
  console.error('Erro inesperado na API do Prometheus Chat.')
  console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500
  const message = status === 500 ? 'O serviço está temporariamente indisponível.' : error.message
  return res.status(status).json({ error: message })
})

const publicDirectory = path.resolve(fileURLToPath(new URL('../../public', import.meta.url)))
const publicIndex = path.join(publicDirectory, 'index.html')
if (existsSync(publicIndex)) {
  app.use(express.static(publicDirectory, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/healthz') return next()
    return res.sendFile(publicIndex)
  })
}

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }))

const server = app.listen(port, () => {
  console.log(`Prometheus Chat API local disponível na porta ${port}.`)
})

async function shutdown() {
  clearInterval(rateBucketCleanupTimer)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
