import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import facebookRoutes from './routes/facebook.js';
import orderRoutes from './routes/orders.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Comércio Popular API' });
});

app.use('/api/auth/facebook', facebookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Comércio Popular API rodando na porta ${PORT}`);
});
