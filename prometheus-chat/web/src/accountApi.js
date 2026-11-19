const API_BASE = (import.meta.env.VITE_PROMETHEUS_API_URL || (import.meta.env.DEV
  ? 'http://localhost:3334/api/prometheus'
  : '/api/prometheus')).replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-Prometheus-Request': '1',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Não foi possível validar sua conta.')
  return body
}

export function signInWithEmail(identifier, password) {
  return request('/session/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: identifier.trim(), password }),
  })
}

export function signUpWithEmail({ name, email, password, cpf, phone }) {
  return request('/session/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email: email.trim(), password, cpf, phone }),
  })
}

export function signInWithGoogleIdToken(idToken) {
  return request('/session/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  })
}

export function acceptGoogleLoginTerms(legalToken) {
  return request('/session/legal/accept', {
    method: 'POST',
    body: JSON.stringify({ legalToken, accepted: true }),
  })
}
