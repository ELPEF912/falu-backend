import { Request, Response } from 'express';
import { pool } from '../config/database';


// GESTIÓN DE PUBLICACIONES (Exclusivo para Vendedores)

export const crearProducto = async (req: Request, res: Response): Promise<void> => {
    // El middleware ya garantizó que req.usuario existe y es vendedor
    const idVendedor = req.usuario?.id_usuario; 
    const { titulo, descripcion, precio, stock, url_imagen } = req.body;

    if (!titulo || precio === undefined || stock === undefined) {
        res.status(400).json({ error: 'Título, precio y stock son obligatorios.' });
        return;
    }

    if (Number(precio) < 0 || Number(stock) < 0) {
        res.status(400).json({ error: 'El precio y el stock no pueden ser negativos.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Insertar el producto
        const productoResult = await client.query(
            `INSERT INTO productos (id_vendedor, titulo, descripcion, estado)
             VALUES ($1, $2, $3, 'activo')
             RETURNING id_producto`,
            [idVendedor, String(titulo).trim(), descripcion ? String(descripcion).trim() : null]
        );
        const idProducto = productoResult.rows[0].id_producto;

        // 2. Insertar la variante principal (Precio y Stock)
        await client.query(
            `INSERT INTO variantes_producto (id_producto, precio, stock_actual, activa)
             VALUES ($1, $2, $3, TRUE)`,
            [idProducto, Number(precio), Number(stock)]
        );

        // 3. Insertar imagen principal
        if (url_imagen) {
            await client.query(
                `INSERT INTO imagenes_producto (id_producto, url, es_principal)
                 VALUES ($1, $2, TRUE)`,
                [idProducto, String(url_imagen).trim()]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            mensaje: 'Producto publicado exitosamente.',
            producto_id: idProducto
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en crearProducto:', error);
        res.status(500).json({ error: 'Error interno al publicar el producto.' });
    } finally {
        client.release();
    }
};



// CATÁLOGO Y BÚSQUEDA


export const listarCatalogo = async (req: Request, res: Response): Promise<void> => {
    // Obtenemos los parámetros de la URL (?q=celular&orden=asc&page=1)
    const { q, orden, limit = 10, page = 1 } = req.query;

    try {
        let queryStr = `
            SELECT p.id_producto, p.titulo, p.estado, 
                   v.precio, v.stock_actual, 
                   i.url AS imagen_principal
            FROM productos p
            INNER JOIN variantes_producto v ON p.id_producto = v.id_producto
            LEFT JOIN imagenes_producto i ON p.id_producto = i.id_producto AND i.es_principal = TRUE
            WHERE p.estado = 'activo' AND v.activa = TRUE
        `;
        
        const queryParams: any[] = [];
        let paramCount = 1;

        if (q) {
            queryStr += ` AND p.titulo ILIKE $${paramCount}`;
            queryParams.push(`%${q}%`);
            paramCount++;
        }

        if (orden === 'asc') {
            queryStr += ` ORDER BY v.precio ASC`;
        } else if (orden === 'desc') {
            queryStr += ` ORDER BY v.precio DESC`;
        } else {
            queryStr += ` ORDER BY p.fecha_publicacion DESC`; // Por defecto, los más nuevos
        }

        // Paginación
        const offset = (Number(page) - 1) * Number(limit);
        queryStr += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        queryParams.push(Number(limit), offset);

        const result = await pool.query(queryStr, queryParams);

        res.status(200).json({
            pagina_actual: Number(page),
            resultados: result.rowCount,
            productos: result.rows
        });
    } catch (error) {
        console.error('Error en listarCatalogo:', error);
        res.status(500).json({ error: 'Error al obtener el catálogo de productos.' });
    }
};


export const obtenerDetalleProducto = async (req: Request, res: Response): Promise<void> => {
    const idProducto = Number(req.params.id);

    if (isNaN(idProducto)) {
        res.status(400).json({ error: 'ID de producto inválido.' });
        return;
    }

    try {
        // Consulta principal del producto + datos del vendedor
        const productoResult = await pool.query(
            `SELECT p.id_producto, p.titulo, p.descripcion, p.fecha_publicacion,
                    u.id_usuario AS id_vendedor, u.nombre AS vendedor_nombre
             FROM productos p
             INNER JOIN usuarios u ON p.id_vendedor = u.id_usuario
             WHERE p.id_producto = $1 AND p.estado = 'activo'`,
            [idProducto]
        );

        if (!productoResult.rowCount || productoResult.rowCount === 0) {
            res.status(404).json({ error: 'Producto no encontrado o inactivo.' });
            return;
        }

        // Obtenego la variante (precio, stock)
        const varianteResult = await pool.query(
            `SELECT id_variante, precio, stock_actual 
             FROM variantes_producto 
             WHERE id_producto = $1 AND activa = TRUE`,
            [idProducto]
        );

        // Obtengo las imágenes
        const imagenesResult = await pool.query(
            `SELECT url, es_principal FROM imagenes_producto WHERE id_producto = $1`,
            [idProducto]
        );

        const productoFinal = {
            ...productoResult.rows[0],
            variantes: varianteResult.rows,
            imagenes: imagenesResult.rows
        };

        res.status(200).json({ producto: productoFinal });
    } catch (error) {
        console.error('Error en obtenerDetalleProducto:', error);
        res.status(500).json({ error: 'Error interno al consultar el producto.' });
    }
};