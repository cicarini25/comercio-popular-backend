import express from 'express';
import jwt from 'jsonwebtoken';
import { answerPrometheusMessage } from '../services/prometheus.service.js';

const router = express.Router();

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || !process.env.JWT_SECRET) return next();

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), process.env.JWT_SECRET);
    if (typeof payload?.userId === 'string') req.userId = payload.userId;
  } catch {
    // Perguntas públicas continuam disponíveis; dados privados continuam protegidos.
  }
  return next();
}

router.post('/chat', optionalAuth, async (req, res) => {
  const { message, conversationId = null, context = {} } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Envie uma mensagem válida.' });
  }

  const safeContext = {
    currentPage: typeof context.currentPage === 'string' ? context.currentPage.slice(0, 300) : null,
    currentProductId: typeof context.currentProductId === 'string' ? context.currentProductId : null,
    cartItems: Array.isArray(context.cartItems) ? context.cartItems.slice(0, 30) : [],
  };

  try {
    const result = await answerPrometheusMessage({
      userId: req.userId || null,
      message: message.trim().slice(0, 2000),
      conversationId: typeof conversationId === 'string' ? conversationId.slice(0, 100) : null,
      context: safeContext,
    });
    return res.json(result);
  } catch (error) {
    console.error('Erro no chat PROMETHEUS:', error);
    return res.status(500).json({
      message: 'Não consegui consultar o sistema agora. Pode tentar novamente ou falar diretamente com o atendimento.',
      intent: 'server_error',
      quickReplies: ['Tentar novamente', 'Falar com atendimento'],
      requiresHuman: true,
    });
  }
});

export default router;
