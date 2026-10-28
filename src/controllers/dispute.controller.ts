import { Request, Response } from 'express';
import { pool } from '../config/database';


// INICIAR RECLAMO Y RETENER FONDOS (Comprador)

export const iniciarReclamo = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { id_pedido, motivo, mensaje_inicial } = req.body;

    if (!id_pedido || !motivo || !mensaje_inicial) {
        res.status(400).json({ error: 'Faltan datos obligatorios (id_pedido, motivo, mensaje_inicial).' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verificar que el pedido pertenece al comprador
        const pedidoResult = await client.query(
            `SELECT pv.id_pedido, pv.id_vendedor, pv.total_vendedor, pv.estado_logistico, og.id_usuario_comprador
             FROM pedidos_vendedor pv
             INNER JOIN ordenes_globales og ON pv.id_orden_global = og.id_orden_global
             WHERE pv.id_pedido = $1 FOR UPDATE`,
            [id_pedido]
        );

        if (pedidoResult.rowCount === 0 || pedidoResult.rows[0].id_usuario_comprador !== idUsuario) {
            await client.query('ROLLBACK');
            res.status(403).json({ error: 'Pedido no encontrado o no autorizado.' });
            return;
        }

        const pedido = pedidoResult.rows[0];

        if (pedido.estado_logistico === 'en_disputa') {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'Este pedido ya se encuentra en disputa.' });
            return;
        }

        // 2. Cambiar estado de la sub-orden.
        await client.query(
            `UPDATE pedidos_vendedor SET estado_logistico = 'en_disputa' WHERE id_pedido = $1`,
            [id_pedido]
        );

        // 3. Retención preventiva en la Billetera del Vendedor.
        const billetera = await client.query(
            `SELECT id_billetera, saldo_disponible FROM billeteras WHERE id_usuario = $1 FOR UPDATE`,
            [pedido.id_vendedor]
        );

        if (billetera.rowCount && billetera.rowCount > 0) {
            const idBilletera = billetera.rows[0].id_billetera;
            // Se resta del disponible y se suma al retenido
            await client.query(
                `UPDATE billeteras 
                 SET saldo_disponible = saldo_disponible - $1,
                     saldo_retenido = saldo_retenido + $1
                 WHERE id_billetera = $2`,
                [pedido.total_vendedor, idBilletera]
            );
        }

        // 4. Crear el Reclamo.
        const reclamoResult = await client.query(
            `INSERT INTO reclamos (id_pedido, id_usuario_iniciador, motivo, estado)
             VALUES ($1, $2, $3, 'abierto') RETURNING id_reclamo`,
            [id_pedido, idUsuario, String(motivo).trim()]
        );
        const idReclamo = reclamoResult.rows[0].id_reclamo;

        // 5. Insertar primer mensaje en el reclamo.
        await client.query(
            `INSERT INTO mensajes_post_venta (id_pedido, id_remitente, mensaje)
             VALUES ($1, $2, $3)`,
            [id_pedido, idUsuario, String(mensaje_inicial).trim()]
        );

        await client.query('COMMIT');
        res.status(201).json({ mensaje: 'Reclamo abierto. Fondos retenidos preventivamente.', id_reclamo: idReclamo });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en iniciarReclamo:', error);
        res.status(500).json({ error: 'Error interno al iniciar el reclamo.' });
    } finally {
        client.release();
    }
};


// CHAT DEL RECLAMO (Comprador y Vendedor)

export const enviarMensajeDisputa = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const idPedido = Number(req.params.id_pedido);
    const { mensaje } = req.body;

    if (!mensaje || isNaN(idPedido)) {
        res.status(400).json({ error: 'Mensaje e ID de pedido inválidos.' });
        return;
    }

    try {
        await pool.query(
            `INSERT INTO mensajes_post_venta (id_pedido, id_remitente, mensaje) VALUES ($1, $2, $3)`,
            [idPedido, idUsuario, String(mensaje).trim()]
        );
        res.status(201).json({ mensaje: 'Mensaje agregado al expediente digital.' });
    } catch (error) {
        console.error('Error en enviarMensajeDisputa:', error);
        res.status(500).json({ error: 'Error al enviar mensaje.' });
    }
};


// RESOLUCIÓN ADMINISTRATIVA (Exclusivo Administrador)

export const resolverDisputaAdmin = async (req: Request, res: Response): Promise<void> => {
    const { id_reclamo, veredicto, mensaje_resolucion } = req.body;

    if (!['a_favor_vendedor', 'a_favor_comprador'].includes(veredicto) || !mensaje_resolucion) {
        res.status(400).json({ error: 'Debe emitir un veredicto válido y un mensaje de resolución.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener datos de la disputa
        const reclamo = await client.query(
            `SELECT r.id_pedido, pv.id_vendedor, pv.total_vendedor, r.estado
             FROM reclamos r
             INNER JOIN pedidos_vendedor pv ON r.id_pedido = pv.id_pedido
             WHERE r.id_reclamo = $1 FOR UPDATE`,
            [id_reclamo]
        );

        if (reclamo.rowCount === 0 || reclamo.rows[0].estado !== 'abierto') {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'Reclamo no encontrado o ya resuelto.' });
            return;
        }

        const data = reclamo.rows[0];
        const idAdmin = req.usuario?.id_usuario;

        // Agregar fallo del Admin al expediente
        await client.query(
            `INSERT INTO mensajes_post_venta (id_pedido, id_remitente, mensaje) VALUES ($1, $2, $3)`,
            [data.id_pedido, idAdmin, `[FALLO ADMINISTRATIVO]: ${mensaje_resolucion}`]
        );

        // Ajustar billetera según veredicto
        const billetera = await client.query(`SELECT id_billetera FROM billeteras WHERE id_usuario = $1`, [data.id_vendedor]);
        const idBilletera = billetera.rows.length > 0 ? billetera.rows[0].id_billetera : null;

        if (veredicto === 'a_favor_vendedor') {
            await client.query(`UPDATE reclamos SET estado = 'resuelto_vendedor' WHERE id_reclamo = $1`, [id_reclamo]);
            await client.query(`UPDATE pedidos_vendedor SET estado_logistico = 'entregado' WHERE id_pedido = $1`, [data.id_pedido]);
            
            if (idBilletera) {
                // Se saca de retenido y vuelve a disponible
                await client.query(
                    `UPDATE billeteras SET saldo_retenido = saldo_retenido - $1, saldo_disponible = saldo_disponible + $1 WHERE id_billetera = $2`,
                    [data.total_vendedor, idBilletera]
                );
                await client.query(
                    `INSERT INTO movimientos_billetera (id_billetera, tipo, monto, referencia_pedido) VALUES ($1, 'liberacion_fondos', $2, $3)`,
                    [idBilletera, data.total_vendedor, data.id_pedido]
                );
            }
        } else {
            // A favor del comprador
            await client.query(`UPDATE reclamos SET estado = 'resuelto_comprador' WHERE id_reclamo = $1`, [id_reclamo]);
            await client.query(`UPDATE pedidos_vendedor SET estado_logistico = 'devuelto' WHERE id_pedido = $1`, [data.id_pedido]);
            
            if (idBilletera) {
                // Se descuenta definitivamente del saldo retenido.
                await client.query(`UPDATE billeteras SET saldo_retenido = saldo_retenido - $1 WHERE id_billetera = $2`, [data.total_vendedor, idBilletera]);
                await client.query(
                    `INSERT INTO movimientos_billetera (id_billetera, tipo, monto, referencia_pedido) VALUES ($1, 'reembolso', $2, $3)`,
                    [idBilletera, -data.total_vendedor, data.id_pedido]
                );
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ mensaje: 'Disputa resuelta y fondos ajustados correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en resolverDisputaAdmin:', error);
        res.status(500).json({ error: 'Error interno al resolver la disputa.' });
    } finally {
        client.release();
    }
};