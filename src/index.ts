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

// Límite de 50MB para admitir fotos y videos en publicaciones y reseñas
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Inicializa automáticamente las tablas cloud en Neon PostgreSQL al prender el servidor
const inicializarTablasCloud = async () => {
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS falu_cloud_store (
        clave VARCHAR(120) PRIMARY KEY,
        datos JSONB NOT NULL DEFAULT '[]'::jsonb,
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
    `);

    // Limpia cualquier copia duplicada de productos que haya quedado en falu_cloud_store
    await pool.query(
      "DELETE FROM falu_cloud_store WHERE clave = 'falu_productos_locales'"
    );

    console.log('🟢 Tablas falu_productos_cloud y falu_cloud_store listas en Neon.');
  } catch (err) {
    console.error('🔴 Error al inicializar tablas cloud:', err);
  }
};

// ============================================================================
// MOTOR DE SINCRONIZACIÓN OPTIMIZADO (BAJO CONSUMO DE RED)
// ============================================================================

app.get('/api/sync', async (req, res) => {
  try {
    const clavePuntual = req.query.clave as string | undefined;

    // Si se pide una sola clave puntual (ej. chat), devuelve únicamente esa fila liviana
    if (clavePuntual) {
      const result = await pool.query(
        'SELECT datos FROM falu_cloud_store WHERE clave = $1',
        [clavePuntual]
      );
      return res.json({
        ok: true,
        datos: result.rows[0]?.datos ?? []
      });
    }

    const storeResult = await pool.query(
      "SELECT clave, datos FROM falu_cloud_store WHERE clave != 'falu_productos_locales'"
    );
    const store: Record<string, any> = {};

    for (const row of storeResult.rows) {
      store[row.clave] = row.datos;
    }

    const prodResult = await pool.query(
      'SELECT * FROM falu_productos_cloud ORDER BY creado_en DESC'
    );
    const productosCloud = prodResult.rows.map((r) => ({
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

    if (productosCloud.length > 0) {
      store['falu_productos_locales'] = productosCloud;
    }

    res.json({ ok: true, store });
  } catch (error) {
    console.error('Error en GET /api/sync:', error);
    res.status(500).json({ error: 'Error al sincronizar datos' });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const { clave, datos } = req.body;
    if (!clave || datos === undefined) {
      return res.status(400).json({ error: 'Falta clave o datos' });
    }

    // Los productos se guardan solo en falu_productos_cloud para no duplicar peso en la base de datos
    if (clave !== 'falu_productos_locales') {
      await pool.query(
        `INSERT INTO falu_cloud_store (clave, datos, actualizado_en)
         VALUES ($1, $2, NOW())
         ON CONFLICT (clave) DO UPDATE SET
           datos = EXCLUDED.datos,
           actualizado_en = NOW()`,
        [clave, JSON.stringify(datos)]
      );
    } else if (Array.isArray(datos)) {
      const idsPresentes: number[] = [];

      for (const p of datos) {
        const idProd = Number(p.id_producto);
        if (!idProd) continue;
        idsPresentes.push(idProd);

        const imagenesArray = Array.isArray(p.imagenes)
          ? p.imagenes
          : p.imagen_url
          ? [p.imagen_url]
          : [];

        await pool.query(
          `INSERT INTO falu_productos_cloud (
            id_producto, id_vendedor, vendedor_nombre, estado, motivo_baja,
            tipo_publicacion, titulo, descripcion, precio, precio_oferta,
            stock, categoria, imagen_url, imagenes, caracteristicas,
            calificacion_promedio, total_opiniones, reportes_producto,
            estado_revision_reporte, admin_encargado_reporte, resolucion_reporte
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
          )
          ON CONFLICT (id_producto) DO UPDATE SET
            estado = EXCLUDED.estado,
            motivo_baja = EXCLUDED.motivo_baja,
            titulo = EXCLUDED.titulo,
            descripcion = EXCLUDED.descripcion,
            precio = EXCLUDED.precio,
            precio_oferta = EXCLUDED.precio_oferta,
            stock = EXCLUDED.stock,
            categoria = EXCLUDED.categoria,
            imagen_url = EXCLUDED.imagen_url,
            imagenes = EXCLUDED.imagenes,
            caracteristicas = EXCLUDED.caracteristicas,
            calificacion_promedio = EXCLUDED.calificacion_promedio,
            total_opiniones = EXCLUDED.total_opiniones,
            reportes_producto = EXCLUDED.reportes_producto,
            estado_revision_reporte = EXCLUDED.estado_revision_reporte,
            admin_encargado_reporte = EXCLUDED.admin_encargado_reporte,
            resolucion_reporte = EXCLUDED.resolucion_reporte`,
          [
            idProd,
            Number(p.id_vendedor || 1),
            p.vendedor_nombre || 'Vendedor Falú',
            p.estado || 'activo',
            p.motivo_baja ?? null,
            p.tipo_publicacion || 'producto',
            p.titulo || 'Producto',
            p.descripcion || '',
            Number(p.precio || 0),
            p.precio_oferta ? Number(p.precio_oferta) : null,
            Number(p.stock ?? 0),
            p.categoria || 'Tecnología',
            imagenesArray[0] || p.imagen_url || null,
            JSON.stringify(imagenesArray),
            JSON.stringify(p.caracteristicas || {}),
            p.calificacion_promedio ?? null,
            Number(p.total_opiniones || 0),
            JSON.stringify(p.reportes_producto || []),
            p.estado_revision_reporte || 'no_revisado',
            p.admin_encargado_reporte ?? null,
            p.resolucion_reporte ?? null
          ]
        );
      }

      if (idsPresentes.length > 0) {
        await pool.query(
          'DELETE FROM falu_productos_cloud WHERE NOT (id_producto = ANY($1::bigint[]))',
          [idsPresentes]
        );
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error en POST /api/sync:', error);
    res.status(500).json({ error: 'Error al guardar sincronización' });
  }
});

// ============================================================================
// ENDPOINTS REST DE PRODUCTOS
// ============================================================================

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
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

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
    res.status(500).json({ error: 'Error al obtener el producto' });
  }
});

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
    res.status(500).json({ error: 'No se pudo guardar el producto' });
  }
});

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
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM falu_productos_cloud WHERE id_producto = $1', [
      req.params.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});

// Rutas del sistema
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
    await inicializarTablasCloud();
  } catch (error) {
    console.error('🔴 Error al conectar con la base de datos:', error);
  }
});