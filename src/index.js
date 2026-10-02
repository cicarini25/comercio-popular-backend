import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import facebookRoutes from './routes/facebook.js';
import legalRoutes from './routes/legal.js';
import orderRoutes from './routes/orders.js';
import tiktokRoutes from './routes/tiktok.js';
import catalogRoutes from './routes/catalog.js';
import integrationRoutes from './routes/integrations.js';
import { completeMercadoLivreOAuth } from './integrations/mercadolivre/oauth.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

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

app.use('/api/auth/facebook', facebookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth/legal', legalRoutes);
app.use('/api/auth', tiktokRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/integrations', integrationRoutes);

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Comércio Popular API rodando na porta ${PORT}`);
});
