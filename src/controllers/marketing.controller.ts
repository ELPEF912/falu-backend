import { Request, Response } from 'express';
import { pool } from '../config/database';


// GESTIÓN DE CUPONES (Vendedor)

export const crearCupon = async (req: Request, res: Response): Promise<void> => {
    const idVendedor = req.usuario?.id_usuario;
    const { codigo, tipo_descuento, valor, fecha_inicio, fecha_fin, limite_usos } = req.body;

    if (!codigo || !tipo_descuento || !valor || !fecha_inicio || !fecha_fin) {
        res.status(400).json({ error: 'Faltan datos obligatorios para crear el cupón.' });
        return;
    }

    try {
        await pool.query(
            `INSERT INTO cupones (id_vendedor, codigo, tipo_descuento, valor, fecha_inicio, fecha_fin, limite_usos, activo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
            [idVendedor, String(codigo).toUpperCase().trim(), tipo_descuento, valor, fecha_inicio, fecha_fin, limite_usos || null]
        );
        res.status(201).json({ mensaje: 'Cupón creado exitosamente.' });
    } catch (error: any) {
        if (error.code === '23505') {
            res.status(409).json({ error: 'El código del cupón ya existe.' });
            return;
        }
        console.error('Error en crearCupon:', error);
        res.status(500).json({ error: 'Error al crear el cupón.' });
    }
};


// REPORTES ESTADÍSTICOS (Vendedor)

export const obtenerReportesVendedor = async (req: Request, res: Response): Promise<void> => {
    const idVendedor = req.usuario?.id_usuario;

    try {
        // Agrupamos la facturación por mes usando SQL
        const result = await pool.query(
            `SELECT TO_CHAR(fecha_actualizacion, 'YYYY-MM') AS mes,
                    COUNT(id_pedido) AS cantidad_ventas,
                    SUM(total_vendedor) AS total_facturado
             FROM pedidos_vendedor
             WHERE id_vendedor = $1 AND estado_logistico != 'cancelado'
             GROUP BY mes
             ORDER BY mes DESC
             LIMIT 6`, // Últimos 6 meses
            [idVendedor]
        );

        res.status(200).json({
            mensaje: 'Reporte generado con éxito.',
            reporte_mensual: result.rows
        });
    } catch (error) {
        console.error('Error en obtenerReportesVendedor:', error);
        res.status(500).json({ error: 'Error al generar los reportes estadísticos.' });
    }
};