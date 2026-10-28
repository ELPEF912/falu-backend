import { Request, Response } from 'express';
import { pool } from '../config/database';
import { enviarCorreo } from '../config/mailer';
import crypto from 'crypto';

export const webhookSimuladoMP = async (req: Request, res: Response): Promise<void> => {
    const { id_orden_global, estado_pago } = req.body; 

    if (!id_orden_global || !['aprobado', 'rechazado'].includes(estado_pago)) {
        res.status(400).json({ error: 'Faltan parámetros o el estado no es válido.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Bloquear y leer la Orden Global
        const ordenResult = await client.query(
            `SELECT o.id_orden_global, o.estado_pago, o.total_pagado, u.email, u.nombre
             FROM ordenes_globales o
             INNER JOIN usuarios u ON o.id_usuario_comprador = u.id_usuario
             WHERE o.id_orden_global = $1 FOR UPDATE`,
            [id_orden_global]
        );

        if (ordenResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'Orden no encontrada.' });
            return;
        }

        const orden = ordenResult.rows[0];

        if (orden.estado_pago !== 'pendiente') {
            await client.query('ROLLBACK');
            res.status(400).json({ error: `La orden ya fue procesada (Estado actual: ${orden.estado_pago}).` });
            return;
        }


        // PAGO RECHAZADO (RF-007, RF-017)

        if (estado_pago === 'rechazado') {
            await client.query(
                `UPDATE ordenes_globales SET estado_pago = 'rechazado' WHERE id_orden_global = $1`,
                [id_orden_global]
            );

            await client.query(
                `UPDATE pedidos_vendedor SET estado_logistico = 'cancelado' WHERE id_orden_global = $1`,
                [id_orden_global]
            );

            // Liberar el stock reservado
            const detalles = await client.query(
                `SELECT id_variante, cantidad FROM detalle_pedido dp
                 INNER JOIN pedidos_vendedor pv ON dp.id_pedido = pv.id_pedido
                 WHERE pv.id_orden_global = $1`,
                [id_orden_global]
            );

            for (const item of detalles.rows) {
                await client.query(
                    `UPDATE variantes_producto 
                     SET stock_reservado = stock_reservado - $1 
                     WHERE id_variante = $2`,
                    [item.cantidad, item.id_variante]
                );
            }

            await client.query('COMMIT');
            await enviarCorreo(orden.email, 'Pago rechazado - Falú', `<p>Tu pago por la orden #${id_orden_global} fue rechazado.</p>`);
            res.status(200).json({ mensaje: 'Orden rechazada y stock liberado correctamente.' });
            return;
        }


        // PAGO APROBADO
        // 1. Marcar orden como pagada
        await client.query(
            `UPDATE ordenes_globales SET estado_pago = 'aprobado', id_pago_externo = $1 WHERE id_orden_global = $2`,
            [`MP-SIM-${Date.now()}`, id_orden_global]
        );

        // 2. Obtener todas las sub-órdenes de esta compra
        const pedidos = await client.query(
            `SELECT pv.id_pedido, pv.numero_pedido, pv.id_vendedor, pv.total_vendedor, u.email, u.nombre
             FROM pedidos_vendedor pv
             INNER JOIN usuarios u ON pv.id_vendedor = u.id_usuario
             WHERE pv.id_orden_global = $1 FOR UPDATE`,
            [id_orden_global]
        );

        let correoCompradorHtml = `<p>¡Hola ${orden.nombre}! Tu compra fue aprobada. Detalles:</p><ul>`;

        for (const pedido of pedidos.rows) {
            // A. Restar el stock definitivo y la reserva
            const items = await client.query(
                `SELECT id_variante, cantidad, titulo_producto_snapshot FROM detalle_pedido WHERE id_pedido = $1`,
                [pedido.id_pedido]
            );

            for (const item of items.rows) {
                await client.query(
                    `UPDATE variantes_producto 
                     SET stock_actual = stock_actual - $1, 
                         stock_reservado = stock_reservado - $1 
                     WHERE id_variante = $2`,
                    [item.cantidad, item.id_variante]
                );
            }

            const billetera = await client.query(`SELECT id_billetera FROM billeteras WHERE id_usuario = $1`, [pedido.id_vendedor]);
            
            if (billetera.rowCount && billetera.rowCount > 0) {
                const idBilletera = billetera.rows[0].id_billetera;
                // Sumar saldo
                await client.query(
                    `UPDATE billeteras SET saldo_disponible = saldo_disponible + $1 WHERE id_billetera = $2`,
                    [pedido.total_vendedor, idBilletera]
                );
                // Registrar movimiento en el Ledger
                await client.query(
                    `INSERT INTO movimientos_billetera (id_billetera, tipo, monto, referencia_pedido)
                     VALUES ($1, 'ingreso_venta', $2, $3)`,
                    [idBilletera, pedido.total_vendedor, pedido.id_pedido]
                );
            }

            // C. Generar Etiqueta y Tracking
            const trackingNumber = `ANDREANI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            await client.query(
                `INSERT INTO envios (id_pedido, empresa_logistica, tracking_number, etiqueta_url)
                 VALUES ($1, 'Andreani Simulado', $2, 'https://falu.com/etiquetas/${pedido.numero_pedido}.pdf')`,
                [pedido.id_pedido, trackingNumber]
            );

            // D. Armar correo del comprador
            correoCompradorHtml += `<li>Pedido <b>${pedido.numero_pedido}</b> - Tracking: ${trackingNumber}</li>`;

            // E. Mandar correo al vendedor
            await enviarCorreo(
                pedido.email, 
                `¡Nueva venta confirmada! - Falú`, 
                `<p>Hola ${pedido.nombre}, se aprobó el pedido ${pedido.numero_pedido}. Ya podés despacharlo con la etiqueta ${trackingNumber}. <br><b>+$${pedido.total_vendedor}</b> fueron acreditados en tu billetera.</p>`
            );
        }

        correoCompradorHtml += `</ul><p>Total pagado: $${orden.total_pagado}</p>`;

        // Mandar correo final al comprador
        await enviarCorreo(orden.email, `Comprobante de Pago Aprobado #${id_orden_global} - Falú`, correoCompradorHtml);

        await client.query('COMMIT');

        res.status(200).json({ 
            mensaje: 'Webhook procesado. Pago aprobado, stock descontado, saldo acreditado y logística generada.' 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en webhookSimuladoMP:', error);
        res.status(500).json({ error: 'Error interno al procesar el pago.' });
    } finally {
        client.release();
    }
};