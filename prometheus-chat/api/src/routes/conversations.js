import express from 'express'
import pool from '../db.js'
import { userRateLimit } from '../middleware/rate-limit.js'
import { createManusReply, generateOllamaReply, getProviderAvailability, pollManusReply, ProviderError } from '../providers/index.js'

const router = express.Router()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseLimit(value, fallback = 50, maximum = 100) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(maximum, parsed))
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function publicMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    provider: row.provider,
    model: row.model,
    created_at: row.created_at,
  }
}

function displayTitle(content) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > 120 ? `${normalized.slice(0, 117).trim()}…` : normalized
}

router.get('/', userRateLimit({ key: 'conversation-list', limit: 60 }), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 100)
    const result = await pool.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT MAX(m.created_at)
                 FROM prometheus_chat_messages m
                WHERE m.conversation_id = c.id AND m.user_id = c.user_id) AS last_message_at
         FROM prometheus_chat_conversations c
        WHERE c.user_id = $1
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $2`,
      [req.userId, limit],
    )
    return res.json({ conversations: result.rows })
  } catch (error) {
    console.error('Falha ao listar conversas do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(500).json({ error: 'Não foi possível carregar suas conversas.' })
  }
})

router.post('/', userRateLimit({ key: 'conversation-create', limit: 10 }), async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : 'Nova conversa'
  if (!title || title.length > 120) {
    return res.status(400).json({ error: 'O título deve ter entre 1 e 120 caracteres.' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO prometheus_chat_conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [req.userId, title],
    )
    return res.status(201).json({ conversation: result.rows[0] })
  } catch (error) {
    console.error('Falha ao criar conversa do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(500).json({ error: 'Não foi possível criar a conversa.' })
  }
})

router.get('/:conversationId/messages', userRateLimit({ key: 'conversation-messages', limit: 60 }), async (req, res) => {
  const { conversationId } = req.params
  if (!isUuid(conversationId)) return res.status(404).json({ error: 'Conversa não encontrada.' })

  try {
    const owned = await pool.query(
      'SELECT id FROM prometheus_chat_conversations WHERE id = $1 AND user_id = $2',
      [conversationId, req.userId],
    )
    if (!owned.rowCount) return res.status(404).json({ error: 'Conversa não encontrada.' })

    const limit = parseLimit(req.query.limit, 100, 200)
    const result = await pool.query(
      `SELECT id, role, content, status, provider, model, created_at
         FROM prometheus_chat_messages
        WHERE conversation_id = $1 AND user_id = $2
        ORDER BY sequence DESC
        LIMIT $3`,
      [conversationId, req.userId, limit],
    )
    return res.json({ messages: result.rows.reverse().map(publicMessage) })
  } catch (error) {
    console.error('Falha ao carregar mensagens do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(500).json({ error: 'Não foi possível carregar esta conversa.' })
  }
})

router.get('/providers', userRateLimit({ key: 'provider-status', limit: 60 }), (_req, res) => {
  return res.json({ providers: getProviderAvailability() })
})

router.post('/:conversationId/messages', userRateLimit({ key: 'message-send', limit: 12 }), async (req, res) => {
  const { conversationId } = req.params
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : ''
  if (!isUuid(conversationId)) return res.status(404).json({ error: 'Conversa não encontrada.' })
  if (!content || content.length > 8_000) {
    return res.status(400).json({ error: 'A mensagem deve ter entre 1 e 8.000 caracteres.' })
  }
  if (!['ollama', 'manus'].includes(provider)) {
    return res.status(400).json({ error: 'Selecione um provedor disponível.' })
  }

  const availability = getProviderAvailability()[provider]
  if (!availability.configured) {
    const label = provider === 'ollama' ? 'Ollama' : 'Manus'
    return res.status(503).json({ error: `${label} ainda não está configurado no backend do Prometheus.` })
  }

  let client
  try {
    client = await pool.connect()
  } catch (error) {
    console.error('Não foi possível iniciar a transação da mensagem do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(503).json({ error: 'O serviço está ocupado. Tente novamente em instantes.' })
  }
  let history = []
  let insertedUser
  let insertedAssistant
  try {
    await client.query('BEGIN')
    const owned = await client.query(
      'SELECT id, title FROM prometheus_chat_conversations WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [conversationId, req.userId],
    )
    if (!owned.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Conversa não encontrada.' })
    }

    await client.query(
      `UPDATE prometheus_chat_messages
          SET status = 'failed', provider_task_id = NULL,
              content = 'A resposta expirou e não pôde ser retomada. Envie uma nova mensagem para tentar novamente.'
        WHERE conversation_id = $1 AND user_id = $2 AND role = 'assistant'
          AND status = 'running' AND created_at < now() - interval '20 minutes'`,
      [conversationId, req.userId],
    )
    const pending = await client.query(
      `SELECT 1 FROM prometheus_chat_messages
        WHERE conversation_id = $1 AND user_id = $2 AND role = 'assistant' AND status = 'running'
        LIMIT 1`,
      [conversationId, req.userId],
    )
    if (pending.rowCount) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'A resposta anterior ainda está sendo preparada.' })
    }

    const previous = await client.query(
      `SELECT role, content FROM prometheus_chat_messages
        WHERE conversation_id = $1 AND user_id = $2 AND status = 'complete'
        ORDER BY sequence DESC LIMIT $3`,
      [conversationId, req.userId, 23],
    )
    history = previous.rows.reverse()

    const userResult = await client.query(
      `INSERT INTO prometheus_chat_messages (conversation_id, user_id, role, content, status)
       VALUES ($1, $2, 'user', $3, 'complete')
       RETURNING id, role, content, status, provider, model, created_at`,
      [conversationId, req.userId, content],
    )
    insertedUser = publicMessage(userResult.rows[0])

    const assistantResult = await client.query(
      `INSERT INTO prometheus_chat_messages (conversation_id, user_id, role, content, status, provider, model)
       VALUES ($1, $2, 'assistant', $3, 'running', $4, $5)
       RETURNING id, role, content, status, provider, model, created_at`,
      [conversationId, req.userId, 'Preparando resposta…', provider, availability.model],
    )
    insertedAssistant = publicMessage(assistantResult.rows[0])

    await client.query(
      `UPDATE prometheus_chat_conversations
          SET title = CASE WHEN title = 'Nova conversa' THEN $3 ELSE title END,
              updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [conversationId, req.userId, displayTitle(content)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Falha ao preparar a mensagem do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(500).json({ error: 'Não foi possível registrar esta mensagem.' })
  } finally {
    client.release()
  }

  try {
    if (provider === 'ollama') {
      const answer = await generateOllamaReply([...history, { role: 'user', content }])
      const saved = await pool.query(
        `UPDATE prometheus_chat_messages
            SET content = $3, status = 'complete', model = $4
          WHERE id = $1 AND user_id = $2
          RETURNING id, role, content, status, provider, model, created_at`,
        [insertedAssistant.id, req.userId, answer.content, answer.model],
      )
      if (!saved.rowCount) return res.status(410).json({ error: 'A conversa foi excluída antes da resposta terminar.' })
      insertedAssistant = publicMessage(saved.rows[0])
    } else {
      const task = await createManusReply([...history, { role: 'user', content }])
      const saved = await pool.query(
        `UPDATE prometheus_chat_messages
            SET content = $3, provider_task_id = $4, model = $5
          WHERE id = $1 AND user_id = $2
          RETURNING id, role, content, status, provider, model, created_at`,
        [insertedAssistant.id, req.userId, 'A Manus está preparando sua resposta. Esta conversa será atualizada quando a tarefa terminar.', task.taskId, task.model],
      )
      if (!saved.rowCount) return res.status(410).json({ error: 'A conversa foi excluída antes da resposta terminar.' })
      insertedAssistant = publicMessage(saved.rows[0])
    }
    return res.status(provider === 'manus' ? 202 : 200).json({ userMessage: insertedUser, assistantMessage: insertedAssistant })
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : 'O provedor não conseguiu concluir esta resposta.'
    console.error(`Falha na resposta do provedor ${provider}.`)
    if (!(error instanceof ProviderError)) console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    try {
      const failed = await pool.query(
        `UPDATE prometheus_chat_messages
            SET content = $3, status = 'failed', provider_task_id = NULL
          WHERE id = $1 AND user_id = $2
          RETURNING id, role, content, status, provider, model, created_at`,
        [insertedAssistant.id, req.userId, message],
      )
      insertedAssistant = publicMessage(failed.rows[0])
    } catch (saveError) {
      console.error('Não foi possível registrar o erro do provedor.')
      console.error(saveError instanceof Error ? saveError.message : 'Erro desconhecido.')
      return res.status(500).json({ error: 'A mensagem foi recebida, mas não foi possível salvar o estado da resposta.' })
    }
    return res.json({ userMessage: insertedUser, assistantMessage: insertedAssistant })
  }
})

router.post('/:conversationId/messages/:messageId/refresh', userRateLimit({ key: 'message-refresh', limit: 30 }), async (req, res) => {
  const { conversationId, messageId } = req.params
  if (!isUuid(conversationId) || !isUuid(messageId)) return res.status(404).json({ error: 'Mensagem não encontrada.' })

  try {
    const result = await pool.query(
      `SELECT m.id, m.role, m.content, m.status, m.provider, m.model, m.provider_task_id, m.created_at
         FROM prometheus_chat_messages m
         JOIN prometheus_chat_conversations c ON c.id = m.conversation_id AND c.user_id = m.user_id
        WHERE m.id = $1 AND m.conversation_id = $2 AND m.user_id = $3 AND m.role = 'assistant'
        LIMIT 1`,
      [messageId, conversationId, req.userId],
    )
    if (!result.rowCount) return res.status(404).json({ error: 'Mensagem não encontrada.' })
    const current = result.rows[0]
    if (current.status !== 'running' || current.provider !== 'manus' || !current.provider_task_id) {
      return res.json({ message: publicMessage(current) })
    }

    if (Date.now() - new Date(current.created_at).getTime() > 20 * 60 * 1000) {
      const expired = await pool.query(
        `UPDATE prometheus_chat_messages
            SET content = 'A resposta ultrapassou o tempo máximo e não pôde ser retomada. Envie uma nova mensagem para tentar novamente.',
                status = 'failed', provider_task_id = NULL
          WHERE id = $1 AND user_id = $2 AND status = 'running'
          RETURNING id, role, content, status, provider, model, created_at`,
        [messageId, req.userId],
      )
      return res.json({ message: publicMessage(expired.rows[0] || current) })
    }

    const update = await pollManusReply(current.provider_task_id)
    if (update.status === 'running') return res.json({ message: publicMessage(current) })

    const status = update.status === 'complete' ? 'complete' : update.status
    const content = update.status === 'complete'
      ? update.content
      : update.status === 'waiting'
        ? 'A Manus precisa de uma interação na própria conta do provedor. Esta conversa não aprova ações externas.'
        : 'A tarefa da Manus não foi concluída. Você pode enviar uma nova mensagem para tentar novamente.'
    const saved = await pool.query(
      `UPDATE prometheus_chat_messages
          SET content = $3, status = $4, provider_task_id = NULL
        WHERE id = $1 AND user_id = $2
        RETURNING id, role, content, status, provider, model, created_at`,
      [messageId, req.userId, content, status],
    )
    await pool.query(
      `UPDATE prometheus_chat_conversations SET updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [conversationId, req.userId],
    )
    return res.json({ message: publicMessage(saved.rows[0]) })
  } catch (error) {
    console.error('Falha ao atualizar o status da resposta Manus.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(error instanceof ProviderError ? error.status : 502).json({
      error: error instanceof ProviderError ? error.message : 'Não foi possível atualizar a resposta da Manus.',
    })
  }
})

router.patch('/:conversationId', userRateLimit({ key: 'conversation-rename', limit: 20 }), async (req, res) => {
  const { conversationId } = req.params
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!isUuid(conversationId)) return res.status(404).json({ error: 'Conversa não encontrada.' })
  if (!title || title.length > 120) {
    return res.status(400).json({ error: 'O título deve ter entre 1 e 120 caracteres.' })
  }

  try {
    const result = await pool.query(
      `UPDATE prometheus_chat_conversations
          SET title = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, title, created_at, updated_at`,
      [conversationId, req.userId, title],
    )
    if (!result.rowCount) return res.status(404).json({ error: 'Conversa não encontrada.' })
    return res.json({ conversation: result.rows[0] })
  } catch (error) {
    console.error('Falha ao renomear conversa do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(500).json({ error: 'Não foi possível renomear a conversa.' })
  }
})

router.delete('/:conversationId', userRateLimit({ key: 'conversation-delete', limit: 10 }), async (req, res) => {
  const { conversationId } = req.params
  if (!isUuid(conversationId)) return res.status(404).json({ error: 'Conversa não encontrada.' })

  try {
    const result = await pool.query(
      'DELETE FROM prometheus_chat_conversations WHERE id = $1 AND user_id = $2 RETURNING id',
      [conversationId, req.userId],
    )
    if (!result.rowCount) return res.status(404).json({ error: 'Conversa não encontrada.' })
    return res.status(204).end()
  } catch (error) {
    console.error('Falha ao excluir conversa do Prometheus Chat.')
    console.error(error instanceof Error ? error.message : 'Erro desconhecido.')
    return res.status(500).json({ error: 'Não foi possível excluir a conversa.' })
  }
})

export default router
