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

  if (response.status === 204) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || 'Não foi possível concluir a operação.')
    error.status = response.status
    throw error
  }
  return body
}

export function getPrometheusSession() {
  return request('/session')
}

export function endPrometheusSession() {
  return request('/session/logout', { method: 'POST' })
}

export function listConversations(limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50))
  return request(`/conversations?limit=${safeLimit}`)
}

export function createConversation(title = 'Nova conversa') {
  return request('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export function listConversationMessages(conversationId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100))
  return request(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${safeLimit}`)
}

export function sendConversationMessage(conversationId, content, provider) {
  return request(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, provider }),
  })
}

export function refreshConversationMessage(conversationId, messageId) {
  return request(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/refresh`, {
    method: 'POST',
  })
}

export function listProviders() {
  return request('/conversations/providers')
}

export function renameConversation(conversationId, title) {
  return request(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export function deleteConversation(conversationId) {
  return request(`/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
}
