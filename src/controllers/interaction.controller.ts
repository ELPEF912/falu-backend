import { Request, Response } from 'express';
import { pool } from '../config/database';


// PUBLICAR RESEÑA Y CALIFICAR PRODUCTO

export const crearResena = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { id_producto, calificacion, comentario } = req.body;

    if (!id_producto || !calificacion || calificacion < 1 || calificacion > 5) {
        res.status(400).json({ error: 'Debe especificar un producto y una calificación entre 1 y 5.' });
        return;
    }

    try {
        // 1. Verificar que el usuario REALMENTE compró este producto y ya se lo entregaron
        const compraResult = await pool.query(
            `SELECT 1 
             FROM ordenes_globales og 
             INNER JOIN pedidos_vendedor pv ON og.id_orden_global = pv.id_orden_global
             INNER JOIN detalle_pedido dp ON pv.id_pedido = dp.id_pedido
             INNER JOIN variantes_producto v ON dp.id_variante = v.id_variante
             WHERE og.id_usuario_comprador = $1 
               AND v.id_producto = $2 
               AND pv.estado_logistico = 'entregado'
             LIMIT 1`,
            [idUsuario, id_producto]
        );

        if (compraResult.rowCount === 0) {
            res.status(403).json({ error: 'Solo podés calificar productos que hayas comprado y recibido.' });
            return;
        }

        // 2. Insertar reseña.
        await pool.query(
            `INSERT INTO resenas (id_producto, id_usuario, calificacion, comentario)
             VALUES ($1, $2, $3, $4)`,
            [id_producto, idUsuario, comentario ? String(comentario).trim() : null]
        );

        res.status(201).json({ mensaje: 'Reseña publicada exitosamente.' });
    } catch (error: any) {
        // Capturo el error de restricción UNIQUE de PostgreSQL.
        if (error.code === '23505') {
            res.status(409).json({ error: 'Ya publicaste una reseña para este producto.' });
            return;
        }
        console.error('Error en crearResena:', error);
        res.status(500).json({ error: 'Error interno al publicar la reseña.' });
    }
};


// PERFIL Y REPUTACIÓN DEL VENDEDOR

export const obtenerReputacionVendedor = async (req: Request, res: Response): Promise<void> => {
    const idVendedor = Number(req.params.id);

    if (isNaN(idVendedor)) {
        res.status(400).json({ error: 'ID de vendedor inválido.' });
        return;
    }

    try {
        // 1. Obtener cantidad de ventas completadas
        const ventasResult = await pool.query(
            `SELECT COUNT(id_pedido) AS total_ventas 
             FROM pedidos_vendedor 
             WHERE id_vendedor = $1 AND estado_logistico = 'entregado'`,
            [idVendedor]
        );
        const totalVentas = Number(ventasResult.rows[0].total_ventas);

        // 2. Obtener cantidad de reclamos que tuvo el vendedor
        const reclamosResult = await pool.query(
            `SELECT COUNT(r.id_reclamo) AS total_reclamos 
             FROM reclamos r 
             INNER JOIN pedidos_vendedor pv ON r.id_pedido = pv.id_pedido
             WHERE pv.id_vendedor = $1`,
            [idVendedor]
        );
        const totalReclamos = Number(reclamosResult.rows[0].total_reclamos);

        // 3. Obtener promedio de reseñas de todos sus productos
        const promedioResult = await pool.query(
            `SELECT ROUND(AVG(r.calificacion), 1) AS promedio_estrellas
             FROM resenas r
             INNER JOIN productos p ON r.id_producto = p.id_producto
             WHERE p.id_vendedor = $1`,
            [idVendedor]
        );
        const promedioEstrellas = promedioResult.rows[0].promedio_estrellas || 0;

        if (totalVentas < 10) {
            res.status(200).json({
                mensaje_contextual: 'Historial aún limitado',
                datos_reales: {
                    ventas_completadas: totalVentas,
                    promedio_estrellas: Number(promedioEstrellas),
                    reclamos: totalReclamos
                }
            });
            return;
        }

        res.status(200).json({
            reputacion: {
                ventas_completadas: totalVentas,
                promedio_estrellas: Number(promedioEstrellas),
                reclamos: totalReclamos
            }
        });
    } catch (error) {
        console.error('Error en obtenerReputacionVendedor:', error);
        res.status(500).json({ error: 'Error al consultar la reputación del vendedor.' });
    }
};