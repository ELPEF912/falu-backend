import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './config/database';

const app = express();
app.use(cors());
app.use(express.json());

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
    await pool.query('SELECT 1'); // Consulta rápida para probar conexión
    console.log('🟢 Conexión a la base de datos PostgreSQL establecida con éxito.');
  } catch (error) {
    console.error('🔴 Error al conectar con la base de datos:', error);
  }
});