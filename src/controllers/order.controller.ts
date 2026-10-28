import { Request, Response } from 'express';
import { pool } from '../config/database';

export const procesarCheckout = async (req: Request, res: Response): Promise<void> => {
    const idUsuarioComprador = req.usuario?.id_usuario;
    const { id_direccion_envio } = req.body;

    if (!id_direccion_envio) {
        res.status(400).json({ error: 'Debe especificar una dirección de envío.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verificar que la dirección exista y pertenezca al usuario
        const dirResult = await client.query(
            `SELECT id_direccion FROM direcciones WHERE id_direccion = $1 AND id_usuario = $2`,
            [id_direccion_envio, idUsuarioComprador]
        );
        if (dirResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'La dirección de envío no es válida.' });
            return;
        }

        // 2. Obtener los ítems del carrito con bloqueo
        // Esto asegura que nadie más pueda tocar el stock de estos productos mientras se procesa
        const carritoResult = await client.query(
            `SELECT ic.id_item, ic.cantidad, 
                    v.id_variante, v.precio, v.atributos, 
                    (v.stock_actual - v.stock_reservado) AS stock_disponible,
                    p.id_producto, p.titulo, p.id_vendedor
             FROM carritos c
             INNER JOIN items_carrito ic ON c.id_carrito = ic.id_carrito
             INNER JOIN variantes_producto v ON ic.id_variante = v.id_variante
             INNER JOIN productos p ON v.id_producto = p.id_producto
             WHERE c.id_usuario = $1
             FOR UPDATE OF v`,
            [idUsuarioComprador]
        );

        if (!carritoResult.rowCount || carritoResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'El carrito está vacío.' });
            return;
        }

        const items = carritoResult.rows;

        // 3. Validar stock antes de avanzar
        for (const item of items) {
            if (item.cantidad > item.stock_disponible) {
                await client.query('ROLLBACK');
                res.status(400).json({ 
                    error: `Stock insuficiente para el producto "${item.titulo}". Solo quedan ${item.stock_disponible} disponibles.` 
                });
                return;
            }
        }

        // 4. Algoritmo de agrupación por Vendedor
        const pedidosPorVendedor: Record<number, any[]> = {};
        let totalGlobal = 0;

        items.forEach(item => {
            if (!pedidosPorVendedor[item.id_vendedor]) {
                pedidosPorVendedor[item.id_vendedor] = [];
            }
            pedidosPorVendedor[item.id_vendedor].push(item);
            totalGlobal += (Number(item.precio) * Number(item.cantidad));
        });

        // Sumamos un costo de envío fijo de ejemplo
        const costoEnvioPorVendedor = 5000;
        const cantidadVendedores = Object.keys(pedidosPorVendedor).length;
        totalGlobal += (costoEnvioPorVendedor * cantidadVendedores);

        // 5. Crear la Orden Global
        const ordenGlobalResult = await client.query(
            `INSERT INTO ordenes_globales (id_usuario_comprador, id_direccion_envio, total_pagado, estado_pago)
             VALUES ($1, $2, $3, 'pendiente')
             RETURNING id_orden_global`,
            [idUsuarioComprador, id_direccion_envio, totalGlobal]
        );
        const idOrdenGlobal = ordenGlobalResult.rows[0].id_orden_global;

        // 6. Crear las Sub-órdenes por Vendedor y Detalles
        const subOrdenesGeneradas = [];

        for (const idVendedorStr of Object.keys(pedidosPorVendedor)) {
            const idVendedor = Number(idVendedorStr);
            const productosDelVendedor = pedidosPorVendedor[idVendedor];
            
            let subtotalProductos = 0;
            productosDelVendedor.forEach(p => subtotalProductos += (Number(p.precio) * Number(p.cantidad)));

            // Lógica de comisiones
            const comisionPlataforma = subtotalProductos * 0.10;
            const totalVendedor = subtotalProductos - comisionPlataforma + costoEnvioPorVendedor;
            const numeroPedido = `FALU-${Date.now()}-${idVendedor}`;

            // Crear el Pedido Vendedor
            const pedidoVendedorResult = await client.query(
                `INSERT INTO pedidos_vendedor (
                    id_orden_global, id_vendedor, numero_pedido, subtotal_productos, 
                    costo_envio, comision_plataforma, total_vendedor, estado_logistico
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'preparando')
                 RETURNING id_pedido, numero_pedido`,
                [idOrdenGlobal, idVendedor, numeroPedido, subtotalProductos, costoEnvioPorVendedor, comisionPlataforma, totalVendedor]
            );
            const idPedidoVendedor = pedidoVendedorResult.rows[0].id_pedido;

            // Insertar los detalles congelados y actualizar stock reservado
            for (const prod of productosDelVendedor) {
                await client.query(
                    `INSERT INTO detalle_pedido (
                        id_pedido, id_variante, titulo_producto_snapshot, atributos_snapshot, cantidad, precio_unitario_snapshot
                     ) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [idPedidoVendedor, prod.id_variante, prod.titulo, prod.atributos || '{}', prod.cantidad, prod.precio]
                );

                // Aumentar el stock reservado
                await client.query(
                    `UPDATE variantes_producto 
                     SET stock_reservado = stock_reservado + $1 
                     WHERE id_variante = $2`,
                    [prod.cantidad, prod.id_variante]
                );
            }

            subOrdenesGeneradas.push({
                numero_pedido: numeroPedido,
                id_vendedor: idVendedor,
                subtotal: subtotalProductos,
                envio: costoEnvioPorVendedor
            });
        }

        // 7. Vaciar el carrito del usuario
        await client.query(
            `DELETE FROM items_carrito 
             USING carritos 
             WHERE items_carrito.id_carrito = carritos.id_carrito 
               AND carritos.id_usuario = $1`,
            [idUsuarioComprador]
        );

        await client.query('COMMIT');

        res.status(201).json({
            mensaje: 'Checkout completado exitosamente. Orden creada en estado Pendiente de Pago.',
            orden_global: idOrdenGlobal,
            total_a_pagar: totalGlobal,
            sub_ordenes: subOrdenesGeneradas
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en procesarCheckout:', error);
        res.status(500).json({ error: 'Error interno al procesar el checkout.' });
    } finally {
        client.release();
    }
};