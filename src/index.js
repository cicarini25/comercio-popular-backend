import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import facebookRoutes from './routes/facebook.js';
import legalRoutes from './routes/legal.js';
import orderRoutes from './routes/orders.js';
import merchantApplicationRoutes from './routes/merchantApplications.js';
import sellerRoutes from './routes/seller.js';
import tiktokRoutes from './routes/tiktok.js';
import smsRoutes from './routes/sms.js';
import catalogRoutes from './routes/catalog.js';
import integrationRoutes from './routes/integrations.js';
import shopeeImageRoutes from './routes/shopee-images.js';
import { completeMercadoLivreOAuth } from './integrations/mercadolivre/oauth.js';
import { authRateLimit } from './middleware/auth-rate-limit.js';

const app = express();

app.set('trust proxy', 1);
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_URL || 'https://comerciopopular.shop,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) return callback(null, true);
    return callback(new Error('Origem não autorizada.'));
  },
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

app.use('/api/auth', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/', async (req, res) => {
  if (req.query.code || req.query.error) {
    try {
      await completeMercadoLivreOAuth({
        code: typeof req.query.code === 'string' ? req.query.code : undefined,
        state: typeof req.query.state === 'string' ? req.query.state : undefined,
        error: typeof req.query.error === 'string' ? req.query.error : undefined,
        errorDescription: typeof req.query.error_description === 'string'
          ? req.query.error_description
          : undefined
      });

      return res.status(200).type('html').send(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>Mercado Livre conectado</title></head><body><h1>Mercado Livre conectado com sucesso.</h1><p>Você pode fechar esta janela.</p></body></html>"
      );
    } catch (error) {
      console.error('Erro no callback OAuth Mercado Livre pelo domínio raiz:', error);
      return res.status(400).type('html').send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Falha na conexão</title></head><body><h1>Não foi possível conectar o Mercado Livre.</h1><p>${error instanceof Error ? error.message : 'Erro desconhecido.'}</p></body></html>`
      );
    }
  }

  return res.json({ status: 'ok', service: 'Comércio Popular API' });
});

app.use('/api/auth/login', authRateLimit);
app.use('/api/auth/signup', authRateLimit);
app.use('/api/auth/google', authRateLimit);
app.use('/api/auth/facebook', authRateLimit);
app.use('/api/auth/tiktok/exchange', authRateLimit);
app.use('/api/auth/sms/request', authRateLimit);
app.use('/api/auth/sms/verify', authRateLimit);
app.use('/api/auth/legal/accept', authRateLimit);
app.use('/api/auth/facebook', facebookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth/legal', legalRoutes);
app.use('/api/auth/sms', smsRoutes);
app.use('/api/auth', tiktokRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/merchant-applications', merchantApplicationRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/shopee-images', express.static('/data/shopee-images', { maxAge: '7d', fallthrough: false }));
app.use('/product-media/videos', express.static(process.env.PRODUCT_VIDEO_STORAGE_DIR || '/data/product-videos', { maxAge: '7d', immutable: true, fallthrough: false }));
app.use('/api/integrations', integrationRoutes);
app.use('/api/integrations/shopee-images', shopeeImageRoutes);

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Comércio Popular API rodando na porta ${PORT}`);
});

