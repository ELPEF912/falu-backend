import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { pool } from './config/database';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import productRoutes from './routes/product.routes';
import cartRoutes from './routes/cart.routes';
import orderRoutes from './routes/order.routes';
import paymentRoutes from './routes/payment.routes';
import disputeRoutes from './routes/dispute.routes';
import interactionRoutes from './routes/interaction.routes';
import activityRoutes from './routes/activity.routes';
import marketingRoutes from './routes/marketing.routes';
import qaRoutes from './routes/qa.routes';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/interactions', interactionRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/qa', qaRoutes);

const PORT = process.env.PORT || 3000;

// Ruta de prueba general
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '¡API de Falú Marketplace funcionando!' });
});

// Ruta para probar la conexión a la base de datos
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as hora_actual');
    res.json({
      status: 'Éxito',
      message: '¡Conectado a PostgreSQL!',
      hora_bd: result.rows[0].hora_actual
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Fallo la conexión a la base de datos' });
  }
});

// Iniciar servidor y comprobar base de datos
app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  try {
    await pool.query('SELECT 1');
    console.log('🟢 Conexión a la base de datos PostgreSQL establecida con éxito.');
  } catch (error) {
    console.error('🔴 Error al conectar con la base de datos:', error);
  }
});