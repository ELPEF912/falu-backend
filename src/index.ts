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

// Aumentamos el límite a 50MB para que las publicaciones con fotos no sean rechazadas
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Crear tabla persistente de catálogo en Neon PostgreSQL si no existe
const inicializarTablaProductosCloud = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS falu_productos_cloud (
        id_producto BIGINT PRIMARY KEY,
        id_vendedor BIGINT,
        vendedor_nombre VARCHAR(255),
        estado VARCHAR(50) DEFAULT 'activo',
        motivo_baja TEXT,
        tipo_publicacion VARCHAR(50) DEFAULT 'producto',
        titulo VARCHAR(255) NOT NULL,
        descripcion TEXT,
        precio NUMERIC(15, 2) NOT NULL,
        precio_oferta NUMERIC(15, 2),
        stock INTEGER NOT NULL DEFAULT 0,
        categoria VARCHAR(120),
        imagen_url TEXT,
        imagenes JSONB DEFAULT '[]'::jsonb,
        caracteristicas JSONB DEFAULT '{}'::jsonb,
        calificacion_promedio NUMERIC(3, 2),
        total_opiniones INTEGER DEFAULT 0,
        reportes_producto JSONB DEFAULT '[]'::jsonb,
        estado_revision_reporte VARCHAR(50) DEFAULT 'no_revisado',
        admin_encargado_reporte VARCHAR(255),
        resolucion_reporte TEXT,
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('🟢 Tabla falu_productos_cloud verificada en Neon PostgreSQL.');
  } catch (err) {
    console.error('🔴 Error al inicializar tabla falu_productos_cloud:', err);
  }
};

// ============================================================================
// ENDPOINTS DE PRODUCTOS CONECTADOS A NEON POSTGRESQL (COMPARTIDOS ENTRE TODOS)
// ============================================================================

// 1. Obtener todos los productos publicados
app.get('/api/products', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM falu_productos_cloud ORDER BY creado_en DESC'
    );
    const productos = result.rows.map((r) => ({
      ...r,
      id_producto: Number(r.id_producto),
      id_vendedor: r.id_vendedor ? Number(r.id_vendedor) : 1,
      precio: Number(r.precio),
      precio_oferta: r.precio_oferta ? Number(r.precio_oferta) : null,
      stock: Number(r.stock),
      calificacion_promedio: r.calificacion_promedio
        ? Number(r.calificacion_promedio)
        : null,
      total_opiniones: Number(r.total_opiniones || 0)
    }));
    res.json(productos);
  } catch (error) {
    console.error('Error en GET /api/products:', error);
    res.status(500).json({ error: 'Error al obtener productos de la base de datos' });
  }
});

// 2. Obtener un producto puntual por ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM falu_productos_cloud WHERE id_producto = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const r = result.rows[0];
    res.json({
      ...r,
      id_producto: Number(r.id_producto),
      id_vendedor: r.id_vendedor ? Number(r.id_vendedor) : 1,
      precio: Number(r.precio),
      precio_oferta: r.precio_oferta ? Number(r.precio_oferta) : null,
      stock: Number(r.stock),
      calificacion_promedio: r.calificacion_promedio
        ? Number(r.calificacion_promedio)
        : null,
      total_opiniones: Number(r.total_opiniones || 0)
    });
  } catch (error) {
    console.error('Error en GET /api/products/:id:', error);
    res.status(500).json({ error: 'Error al obtener el producto' });
  }
});

// 3. Crear un nuevo producto en Neon PostgreSQL
app.post('/api/products', async (req, res) => {
  try {
    const p = req.body;
    const idProd = Number(p.id_producto || Date.now());
    const imagenesArray = Array.isArray(p.imagenes)
      ? p.imagenes
      : p.imagen_url
      ? [p.imagen_url]
      : [];

    const result = await pool.query(
      `INSERT INTO falu_productos_cloud (
        id_producto, id_vendedor, vendedor_nombre, estado, tipo_publicacion,
        titulo, descripcion, precio, precio_oferta, stock, categoria,
        imagen_url, imagenes, caracteristicas
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id_producto) DO UPDATE SET
        titulo = EXCLUDED.titulo,
        descripcion = EXCLUDED.descripcion,
        precio = EXCLUDED.precio,
        stock = EXCLUDED.stock,
        categoria = EXCLUDED.categoria,
        imagen_url = EXCLUDED.imagen_url,
        imagenes = EXCLUDED.imagenes,
        caracteristicas = EXCLUDED.caracteristicas
      RETURNING *`,
      [
        idProd,
        Number(p.id_vendedor || 1),
        p.vendedor_nombre || 'Vendedor Falú',
        p.estado || 'activo',
        p.tipo_publicacion || 'producto',
        p.titulo,
        p.descripcion || '',
        Number(p.precio),
        p.precio_oferta ? Number(p.precio_oferta) : null,
        Number(p.stock ?? 1),
        p.categoria || 'Tecnología',
        imagenesArray[0] || p.imagen_url || null,
        JSON.stringify(imagenesArray),
        JSON.stringify(p.caracteristicas || {})
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error en POST /api/products:', error);
    res.status(500).json({ error: 'No se pudo guardar el producto en la base de datos' });
  }
});

// 4. Actualizar un producto existente (Stock, Edición, Pausa, Baja Admin o Reportes)
app.put('/api/products/:id', async (req, res) => {
  try {
    const p = req.body;
    const idProd = Number(req.params.id);
    const imagenesArray = Array.isArray(p.imagenes)
      ? p.imagenes
      : p.imagen_url
      ? [p.imagen_url]
      : [];

    const result = await pool.query(
      `UPDATE falu_productos_cloud SET
        estado = COALESCE($1, estado),
        motivo_baja = $2,
        titulo = COALESCE($3, titulo),
        descripcion = COALESCE($4, descripcion),
        precio = COALESCE($5, precio),
        stock = COALESCE($6, stock),
        categoria = COALESCE($7, categoria),
        imagen_url = COALESCE($8, imagen_url),
        imagenes = COALESCE($9, imagenes),
        caracteristicas = COALESCE($10, caracteristicas),
        calificacion_promedio = $11,
        total_opiniones = COALESCE($12, total_opiniones),
        reportes_producto = COALESCE($13, reportes_producto),
        estado_revision_reporte = COALESCE($14, estado_revision_reporte),
        admin_encargado_reporte = $15,
        resolucion_reporte = $16
      WHERE id_producto = $17
      RETURNING *`,
      [
        p.estado || 'activo',
        p.motivo_baja ?? null,
        p.titulo,
        p.descripcion,
        p.precio !== undefined ? Number(p.precio) : null,
        p.stock !== undefined ? Number(p.stock) : null,
        p.categoria,
        imagenesArray[0] || p.imagen_url || null,
        JSON.stringify(imagenesArray),
        JSON.stringify(p.caracteristicas || {}),
        p.calificacion_promedio ?? null,
        p.total_opiniones ?? 0,
        JSON.stringify(p.reportes_producto || []),
        p.estado_revision_reporte || 'no_revisado',
        p.admin_encargado_reporte ?? null,
        p.resolucion_reporte ?? null,
        idProd
      ]
    );

    res.json(result.rows[0] || p);
  } catch (error) {
    console.error('Error en PUT /api/products/:id:', error);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

// 5. Eliminar un producto de la base de datos
app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM falu_productos_cloud WHERE id_producto = $1', [
      req.params.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en DELETE /api/products/:id:', error);
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});

// Rutas restantes de la API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products-legacy', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/interactions', interactionRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/qa', qaRoutes);

const PORT = process.env.PORT || 3000;

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: '¡API de Falú Marketplace funcionando!' });
});

app.get('/api/test-db', async (_req, res) => {
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

app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  try {
    await pool.query('SELECT 1');
    console.log('🟢 Conexión a la base de datos PostgreSQL establecida con éxito.');
    await inicializarTablaProductosCloud();
  } catch (error) {
    console.error('🔴 Error al conectar con la base de datos:', error);
  }
});
