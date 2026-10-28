import { Request, Response } from 'express';
import { pool } from '../config/database';


// FAVORITOS

export const agregarFavorito = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { id_producto } = req.body;

    if (!id_producto) {
        res.status(400).json({ error: 'Debe especificar el ID del producto.' });
        return;
    }

    try {
        await pool.query(
            `INSERT INTO favoritos (id_usuario, id_producto) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [idUsuario, id_producto]
        );
        res.status(201).json({ mensaje: 'Producto agregado a favoritos.' });
    } catch (error) {
        console.error('Error en agregarFavorito:', error);
        res.status(500).json({ error: 'Error al agregar a favoritos.' });
    }
};

export const eliminarFavorito = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const idProducto = Number(req.params.id);

    try {
        await pool.query(
            `DELETE FROM favoritos WHERE id_usuario = $1 AND id_producto = $2`,
            [idUsuario, idProducto]
        );
        res.status(200).json({ mensaje: 'Producto eliminado de favoritos.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar de favoritos.' });
    }
};

export const verFavoritos = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;

    try {
        const result = await pool.query(
            `SELECT p.id_producto, p.titulo, v.precio, i.url AS imagen_principal
             FROM favoritos f
             INNER JOIN productos p ON f.id_producto = p.id_producto
             INNER JOIN variantes_producto v ON p.id_producto = v.id_producto
             LEFT JOIN imagenes_producto i ON p.id_producto = i.id_producto AND i.es_principal = TRUE
             WHERE f.id_usuario = $1 AND v.activa = TRUE`,
            [idUsuario]
        );
        res.status(200).json({ favoritos: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error al consultar favoritos.' });
    }
};


// HISTORIAL DE BÚSQUEDA

export const registrarBusqueda = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { termino } = req.body;

    if (!termino) {
        res.status(400).json({ error: 'Falta el término de búsqueda.' });
        return;
    }

    try {
        await pool.query(
            `INSERT INTO historial_busquedas (id_usuario, termino) VALUES ($1, $2)`,
            [idUsuario, String(termino).trim()]
        );
        res.status(201).json({ mensaje: 'Búsqueda registrada.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al registrar búsqueda.' });
    }
};

export const verHistorialBusqueda = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;

    try {
        const result = await pool.query(
            `SELECT termino, fecha_busqueda FROM historial_busquedas 
             WHERE id_usuario = $1 
             ORDER BY fecha_busqueda DESC LIMIT 10`,
            [idUsuario]
        );
        res.status(200).json({ historial: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error al consultar el historial.' });
    }
};