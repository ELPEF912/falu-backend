import { Request, Response } from 'express';
import { pool } from '../config/database';
import { enviarCorreo } from '../config/mailer';

// OBTENER PREGUNTAS DE UN PRODUCTO
export const listarPreguntas = async (req: Request, res: Response): Promise<void> => {
    const idProducto = Number(req.params.id_producto);

    if (isNaN(idProducto)) {
        res.status(400).json({ error: 'ID de producto inválido.' });
        return;
    }

    try {
        const result = await pool.query(
            `SELECT c.id_consulta, c.pregunta, c.respuesta, c.fecha_pregunta, c.fecha_respuesta,
                    u.nombre AS comprador_nombre
             FROM consultas_producto c
             INNER JOIN usuarios u ON c.id_usuario_comprador = u.id_usuario
             WHERE c.id_producto = $1
             ORDER BY c.fecha_pregunta DESC`,
            [idProducto]
        );

        res.status(200).json({ consultas: result.rows });
    } catch (error) {
        console.error('Error en listarPreguntas:', error);
        res.status(500).json({ error: 'Error al obtener las consultas del producto.' });
    }
};

// HACER UNA PREGUNTA (Cualquier usuario registrado)
export const hacerPregunta = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { id_producto, pregunta } = req.body;

    if (!id_producto || !pregunta) {
        res.status(400).json({ error: 'Faltan datos obligatorios (id_producto, pregunta).' });
        return;
    }

    try {
        // Verificar que el producto exista y traer el email del vendedor para notificarle
        const productoResult = await pool.query(
            `SELECT p.titulo, u.email, u.nombre AS vendedor_nombre 
             FROM productos p
             INNER JOIN usuarios u ON p.id_vendedor = u.id_usuario
             WHERE p.id_producto = $1 AND p.estado = 'activo'`,
            [id_producto]
        );

        if (productoResult.rowCount === 0) {
            res.status(404).json({ error: 'Producto no encontrado o inactivo.' });
            return;
        }

        const producto = productoResult.rows[0];

        await pool.query(
            `INSERT INTO consultas_producto (id_producto, id_usuario_comprador, pregunta)
             VALUES ($1, $2, $3)`,
            [id_producto, idUsuario, String(pregunta).trim()]
        );

        // Notificación al vendedor
        await enviarCorreo(
            producto.email,
            'Nueva pregunta en tu publicación - Falú',
            `<p>Hola ${producto.vendedor_nombre},</p>
             <p>Tenés una nueva pregunta en tu publicación <b>${producto.titulo}</b>:</p>
             <blockquote>"${pregunta}"</blockquote>
             <p>Ingresá a tu panel para responderla.</p>`
        );

        res.status(201).json({ mensaje: 'Pregunta publicada exitosamente.' });
    } catch (error) {
        console.error('Error en hacerPregunta:', error);
        res.status(500).json({ error: 'Error al publicar la pregunta.' });
    }
};

// 3. RESPONDER UNA PREGUNTA (Exclusivo Vendedor dueño del producto)
export const responderPregunta = async (req: Request, res: Response): Promise<void> => {
    const idVendedor = req.usuario?.id_usuario;
    const idConsulta = Number(req.params.id_consulta);
    const { respuesta } = req.body;

    if (isNaN(idConsulta) || !respuesta) {
        res.status(400).json({ error: 'ID de consulta y respuesta son obligatorios.' });
        return;
    }

    try {
        // Verificar que la consulta existe y que el producto pertenece al vendedor que quiere responder
        const consultaResult = await pool.query(
            `SELECT c.id_consulta, p.titulo, u.email AS comprador_email, u.nombre AS comprador_nombre
             FROM consultas_producto c
             INNER JOIN productos p ON c.id_producto = p.id_producto
             INNER JOIN usuarios u ON c.id_usuario_comprador = u.id_usuario
             WHERE c.id_consulta = $1 AND p.id_vendedor = $2`,
            [idConsulta, idVendedor]
        );

        if (consultaResult.rowCount === 0) {
            res.status(403).json({ error: 'Consulta no encontrada o no tenés permiso para responderla.' });
            return;
        }

        const datos = consultaResult.rows[0];

        // Guardar la respuesta y la fecha actual
        await pool.query(
            `UPDATE consultas_producto 
             SET respuesta = $1, fecha_respuesta = NOW() 
             WHERE id_consulta = $2`,
            [String(respuesta).trim(), idConsulta]
        );

        // Notificación al comprador
        await enviarCorreo(
            datos.comprador_email,
            'Respondieron tu pregunta - Falú',
            `<p>Hola ${datos.comprador_nombre},</p>
             <p>El vendedor respondió tu consulta sobre <b>${datos.titulo}</b>:</p>
             <blockquote>"${respuesta}"</blockquote>`
        );

        res.status(200).json({ mensaje: 'Respuesta publicada exitosamente.' });
    } catch (error) {
        console.error('Error en responderPregunta:', error);
        res.status(500).json({ error: 'Error al responder la pregunta.' });
    }
};