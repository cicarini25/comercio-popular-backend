import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  connectSellerAccount,
  consumeOAuthState,
  createOAuthState,
  getSellerAccountStatus,
  marketplaceAuthorizationUrl,
  splitConfiguration,
} from '../integrations/mercadopago/marketplace.js';

const router = express.Router();

function frontendUrl() {
  return String(process.env.FRONTEND_URL || 'https://comerciopopular.shop').replace(/\/$/, '');
}

async function createConnectionRedirect(req, res) {
  try {
    if (!process.env.MERCADOPAGO_CLIENT_ID || !process.env.MERCADOPAGO_CLIENT_SECRET || !process.env.MERCADOPAGO_REDIRECT_URI || !process.env.MERCADOPAGO_OAUTH_ENCRYPTION_KEY) {
      return res.status(503).json({ error: 'A conexão Mercado Pago ainda não foi configurada no servidor.' });
    }
    const state = await createOAuthState(req.userId);
    const url = marketplaceAuthorizationUrl(state);
    return req.method === 'GET' ? res.redirect(url) : res.json({ url });
  } catch (error) {
    console.error('Erro ao iniciar conexão Mercado Pago:', error);
    return res.status(500).json({ error: 'Não foi possível iniciar a conexão Mercado Pago.' });
  }
}

router.get('/connect', requireAuth, createConnectionRedirect);
router.post('/connect', requireAuth, createConnectionRedirect);

router.get('/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const userId = state ? await consumeOAuthState(state) : null;
  if (!userId || !code) return res.redirect(`${frontendUrl()}/vendedor?mercadopago=error`);

  try {
    await connectSellerAccount(userId, code);
    return res.redirect(`${frontendUrl()}/vendedor?mercadopago=connected`);
  } catch (error) {
    console.error('Erro no callback OAuth Mercado Pago:', error);
    return res.redirect(`${frontendUrl()}/vendedor?mercadopago=error`);
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const account = await getSellerAccountStatus(req.userId);
    return res.json({ configuration: splitConfiguration(), account });
  } catch (error) {
    console.error('Erro ao consultar conexão Mercado Pago:', error);
    return res.status(500).json({ error: 'Não foi possível consultar a conexão Mercado Pago.' });
  }
});

export default router;
