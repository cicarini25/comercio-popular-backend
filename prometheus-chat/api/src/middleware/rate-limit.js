import pool from '../db.js'

export function userRateLimit({ key, limit, windowSeconds = 60 }) {
  const windowMs = windowSeconds * 1000

  return async function limitByUser(req, res, next) {
    const now = Date.now()
    const windowStart = Math.floor(now / windowMs) * windowSeconds
    const resetAt = (windowStart + windowSeconds) * 1000

    try {
      const result = await pool.query(
        `INSERT INTO prometheus_chat_rate_buckets
           (user_id, route_key, window_start_epoch, request_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (user_id, route_key, window_start_epoch)
         DO UPDATE SET request_count = prometheus_chat_rate_buckets.request_count + 1
         RETURNING request_count`,
        [req.userId, key, windowStart],
      )

      const count = Number(result.rows[0]?.request_count || 0)
      res.setHeader('RateLimit-Limit', String(limit))
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)))
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)))

      if (count > limit) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))))
        return res.status(429).json({ error: 'Você atingiu o limite temporário. Tente novamente em instantes.' })
      }

      return next()
    } catch (error) {
      console.error('Falha ao verificar limite do Prometheus Chat.')
      console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
      return res.status(503).json({ error: 'O serviço está temporariamente indisponível. Tente novamente.' })
    }
  }
}
