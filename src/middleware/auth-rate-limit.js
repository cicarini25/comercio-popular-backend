const attempts = new Map();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip;
  return `${req.path}:${ip || 'unknown'}`;
}

function prune(now) {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}

/**
 * Limits repeated authentication attempts on one backend instance.
 * A shared store should replace this map before running multiple backend replicas.
 */
export function authRateLimit(req, res, next) {
  const now = Date.now();
  prune(now);

  const key = clientKey(req);
  const entry = attempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };
  const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);

  res.setHeader('X-RateLimit-Limit', String(MAX_ATTEMPTS));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count >= MAX_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  }

  let settled = false;
  const recordFailure = () => {
    if (settled) return;
    settled = true;
    if (res.statusCode >= 400) {
      const current = attempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };
      attempts.set(key, { count: current.count + 1, resetAt: current.resetAt });
    } else {
      attempts.delete(key);
    }
  };

  res.once('finish', recordFailure);
  res.once('close', recordFailure);
  next();
}

