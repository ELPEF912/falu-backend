import { Request, Response } from 'express';
import { pool } from '../config/database';

// VER CARRITO
export const obtenerCarrito = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;

    try {
        const result = await pool.query(
            `SELECT ic.id_item, ic.cantidad, 
                    v.id_variante, v.precio AS precio_unitario, v.stock_actual,
                    p.id_producto, p.titulo, p.id_vendedor
             FROM carritos c
             INNER JOIN items_carrito ic ON c.id_carrito = ic.id_carrito
             INNER JOIN variantes_producto v ON ic.id_variante = v.id_variante
             INNER JOIN productos p ON v.id_producto = p.id_producto
             WHERE c.id_usuario = $1
             ORDER BY ic.id_item ASC`,
            [idUsuario]
        );

        // Cálculo del total en tiempo real.
        let totalCarrito = 0;
        const items = result.rows.map(item => {
            const subtotal = Number(item.precio_unitario) * Number(item.cantidad);
            totalCarrito += subtotal;
            return { ...item, subtotal };
        });

        res.status(200).json({
            items,
            total_carrito: totalCarrito
        });
    } catch (error) {
        console.error('Error en obtenerCarrito:', error);
        res.status(500).json({ error: 'Error al obtener el carrito de compras.' });
    }
};

// AGREGAR PRODUCTO AL CARRITO
export const agregarAlCarrito = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { id_variante, cantidad } = req.body;

    if (!id_variante || !cantidad || Number(cantidad) <= 0) {
        res.status(400).json({ error: 'Debe especificar una variante válida y una cantidad mayor a cero.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar stock real descontando lo que ya esté reservado en otras transacciones
        const stockResult = await client.query(
            `SELECT (stock_actual - stock_reservado) AS stock_disponible 
             FROM variantes_producto 
             WHERE id_variante = $1 AND activa = TRUE`,
            [id_variante]
        );

        if (!stockResult.rowCount || stockResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'El producto no existe o no está activo.' });
            return;
        }

        const stockDisponible = Number(stockResult.rows[0].stock_disponible);

        // Obtener el ID del carrito del usuario
        const carritoResult = await client.query(
            `SELECT id_carrito FROM carritos WHERE id_usuario = $1`,
            [idUsuario]
        );
        const idCarrito = carritoResult.rows[0].id_carrito;

        // Verificar si el ítem ya está en el carrito para sumar la cantidad
        const itemExistente = await client.query(
            `SELECT id_item, cantidad FROM items_carrito WHERE id_carrito = $1 AND id_variante = $2`,
            [idCarrito, id_variante]
        );

        let cantidadFinal = Number(cantidad);

        if (itemExistente.rowCount && itemExistente.rowCount > 0) {
            cantidadFinal += Number(itemExistente.rows[0].cantidad);
            
            if (cantidadFinal > stockDisponible) {
                await client.query('ROLLBACK');
                res.status(400).json({ error: `Stock insuficiente. Solo quedan ${stockDisponible} unidades disponibles.` });
                return;
            }

            await client.query(
                `UPDATE items_carrito SET cantidad = $1 WHERE id_item = $2`,
                [cantidadFinal, itemExistente.rows[0].id_item]
            );
        } else {
            if (cantidadFinal > stockDisponible) {
                await client.query('ROLLBACK');
                res.status(400).json({ error: `Stock insuficiente. Solo quedan ${stockDisponible} unidades disponibles.` });
                return;
            }

            await client.query(
                `INSERT INTO items_carrito (id_carrito, id_variante, cantidad) VALUES ($1, $2, $3)`,
                [idCarrito, id_variante, cantidadFinal]
            );
        }

        // Actualizar la fecha del carrito
        await client.query(`UPDATE carritos SET fecha_actualizacion = NOW() WHERE id_carrito = $1`, [idCarrito]);

        await client.query('COMMIT');
        res.status(200).json({ mensaje: 'Producto agregado al carrito exitosamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en agregarAlCarrito:', error);
        res.status(500).json({ error: 'Error interno al agregar el producto al carrito.' });
    } finally {
        client.release();
    }
};

// MODIFICAR CANTIDAD DE UN ÍTEM
export const actualizarCantidad = async (req: Request, res: Response): Promise<void> => {
    const idItem = Number(req.params.id);
    const { cantidad } = req.body;
    const idUsuario = req.usuario?.id_usuario;

    if (isNaN(idItem) || !cantidad || Number(cantidad) <= 0) {
        res.status(400).json({ error: 'Cantidad inválida.' });
        return;
    }

    try {
        // Valido que el ítem pertenezca al carrito del usuario
        const verificacion = await pool.query(
            `SELECT ic.id_variante, (v.stock_actual - v.stock_reservado) AS stock_disponible
             FROM items_carrito ic
             INNER JOIN carritos c ON ic.id_carrito = c.id_carrito
             INNER JOIN variantes_producto v ON ic.id_variante = v.id_variante
             WHERE ic.id_item = $1 AND c.id_usuario = $2`,
            [idItem, idUsuario]
        );

        if (!verificacion.rowCount || verificacion.rowCount === 0) {
            res.status(404).json({ error: 'Ítem no encontrado en tu carrito.' });
            return;
        }

        if (Number(cantidad) > Number(verificacion.rows[0].stock_disponible)) {
            res.status(400).json({ error: 'La cantidad solicitada supera el stock disponible.' });
            return;
        }

        await pool.query(`UPDATE items_carrito SET cantidad = $1 WHERE id_item = $2`, [Number(cantidad), idItem]);
        res.status(200).json({ mensaje: 'Cantidad actualizada correctamente.' });
    } catch (error) {
        console.error('Error en actualizarCantidad:', error);
        res.status(500).json({ error: 'Error al actualizar la cantidad.' });
    }
};

// ELIMINAR PRODUCTO DEL CARRITO
export const eliminarDelCarrito = async (req: Request, res: Response): Promise<void> => {
    const idItem = Number(req.params.id);
    const idUsuario = req.usuario?.id_usuario;

    try {
        const result = await pool.query(
            `DELETE FROM items_carrito 
             USING carritos 
             WHERE items_carrito.id_carrito = carritos.id_carrito 
               AND items_carrito.id_item = $1 
               AND carritos.id_usuario = $2`,
            [idItem, idUsuario]
        );

        if (!result.rowCount || result.rowCount === 0) {
            res.status(404).json({ error: 'Ítem no encontrado.' });
            return;
        }

        res.status(200).json({ mensaje: 'Producto eliminado del carrito.' });
    } catch (error) {
        console.error('Error en eliminarDelCarrito:', error);
        res.status(500).json({ error: 'Error al eliminar el producto.' });
    }
};