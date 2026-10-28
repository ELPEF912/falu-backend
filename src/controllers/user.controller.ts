import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';

// OBTENER PERFIL DEL USUARIO AUTENTICADO
export const obtenerPerfil = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;

    try {
        const userResult = await pool.query(
            `SELECT id_usuario, nombre, apellido, email, telefono, fecha_registro, estado
             FROM usuarios
             WHERE id_usuario = $1`,
            [idUsuario]
        );

        if (!userResult.rowCount || userResult.rowCount === 0) {
            res.status(404).json({ error: 'Usuario no encontrado.' });
            return;
        }

        const rolesResult = await pool.query(
            `SELECT r.nombre 
             FROM roles r
             INNER JOIN usuario_roles ur ON r.id_rol = ur.id_rol
             WHERE ur.id_usuario = $1`,
            [idUsuario]
        );

        const direccionesResult = await pool.query(
            `SELECT * FROM direcciones 
             WHERE id_usuario = $1 
             ORDER BY predeterminada DESC, id_direccion ASC`,
            [idUsuario]
        );

        res.status(200).json({
            usuario: {
                ...userResult.rows[0],
                roles: rolesResult.rows.map((r) => r.nombre),
                direcciones: direccionesResult.rows
            }
        });
    } catch (error) {
        console.error('Error en obtenerPerfil:', error);
        res.status(500).json({ error: 'Error interno al consultar el perfil.' });
    }
};

// ACTUALIZAR DATOS PERSONALES DEL PERFIL
export const actualizarPerfil = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const { nombre, apellido, telefono } = req.body;

    if (!nombre || !apellido) {
        res.status(400).json({ error: 'El nombre y el apellido son obligatorios.' });
        return;
    }

    try {
        const result = await pool.query(
            `UPDATE usuarios 
             SET nombre = $1, apellido = $2, telefono = $3
             WHERE id_usuario = $4
             RETURNING id_usuario, nombre, apellido, email, telefono, estado`,
            [String(nombre).trim(), String(apellido).trim(), telefono || null, idUsuario]
        );

        res.status(200).json({
            mensaje: 'Datos personales actualizados correctamente.',
            usuario: result.rows[0]
        });
    } catch (error) {
        console.error('Error en actualizarPerfil:', error);
        res.status(500).json({ error: 'Error interno al actualizar el perfil.' });
    }
};

// LISTAR DIRECCIONES DEL USUARIO
export const listarDirecciones = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;

    try {
        const result = await pool.query(
            `SELECT * FROM direcciones 
             WHERE id_usuario = $1 
             ORDER BY predeterminada DESC, id_direccion ASC`,
            [idUsuario]
        );

        res.status(200).json({ direcciones: result.rows });
    } catch (error) {
        console.error('Error en listarDirecciones:', error);
        res.status(500).json({ error: 'Error al obtener las direcciones.' });
    }
};

// CREAR NUEVA DIRECCIÓN
export const crearDireccion = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const {
        nombre_destinatario,
        calle,
        numero,
        piso,
        departamento,
        localidad,
        provincia,
        codigo_postal,
        predeterminada
    } = req.body;

    if (!nombre_destinatario || !calle || !localidad || !provincia) {
        res.status(400).json({
            error: 'Nombre del destinatario, calle, localidad y provincia son obligatorios.'
        });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar si es la primera dirección del usuario; si lo es, será predeterminada automáticamente
        const countResult = await client.query(
            `SELECT COUNT(*) AS total FROM direcciones WHERE id_usuario = $1`,
            [idUsuario]
        );
        const esPrimera = Number(countResult.rows[0].total) === 0;
        const seraPredeterminada = esPrimera ? true : Boolean(predeterminada);

        // Si se marca como predeterminada, desmarco las anteriores de este usuario
        if (seraPredeterminada) {
            await client.query(
                `UPDATE direcciones SET predeterminada = FALSE WHERE id_usuario = $1`,
                [idUsuario]
            );
        }

        const insertResult = await client.query(
            `INSERT INTO direcciones (
                id_usuario, nombre_destinatario, calle, numero, piso, 
                departamento, localidad, provincia, codigo_postal, predeterminada
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                idUsuario,
                String(nombre_destinatario).trim(),
                String(calle).trim(),
                numero || null,
                piso || null,
                departamento || null,
                String(localidad).trim(),
                String(provincia).trim(),
                codigo_postal || null,
                seraPredeterminada
            ]
        );

        await client.query('COMMIT');

        res.status(201).json({
            mensaje: 'Dirección registrada exitosamente.',
            direccion: insertResult.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en crearDireccion:', error);
        res.status(500).json({ error: 'Error interno al registrar la dirección.' });
    } finally {
        client.release();
    }
};

// MODIFICAR DIRECCIÓN EXISTENTE
export const actualizarDireccion = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const idDireccion = Number(req.params.id);
    const {
        nombre_destinatario,
        calle,
        numero,
        piso,
        departamento,
        localidad,
        provincia,
        codigo_postal,
        predeterminada
    } = req.body;

    if (isNaN(idDireccion)) {
        res.status(400).json({ error: 'ID de dirección inválido.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar que la dirección exista y pertenezca al usuario autenticado
        const existeResult = await client.query(
            `SELECT * FROM direcciones WHERE id_direccion = $1 AND id_usuario = $2`,
            [idDireccion, idUsuario]
        );

        if (!existeResult.rowCount || existeResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'Dirección no encontrada o no pertenece al usuario.' });
            return;
        }

        const dirActual = existeResult.rows[0];
        const nuevaPredeterminada =
            predeterminada !== undefined ? Boolean(predeterminada) : dirActual.predeterminada;

        // Si el usuario quiere marcar esta como principal, pongo las demás en FALSE
        if (nuevaPredeterminada) {
            await client.query(
                `UPDATE direcciones SET predeterminada = FALSE WHERE id_usuario = $1`,
                [idUsuario]
            );
        }

        const updateResult = await client.query(
            `UPDATE direcciones
             SET nombre_destinatario = $1,
                 calle = $2,
                 numero = $3,
                 piso = $4,
                 departamento = $5,
                 localidad = $6,
                 provincia = $7,
                 codigo_postal = $8,
                 predeterminada = $9
             WHERE id_direccion = $10 AND id_usuario = $11
             RETURNING *`,
            [
                nombre_destinatario ? String(nombre_destinatario).trim() : dirActual.nombre_destinatario,
                calle ? String(calle).trim() : dirActual.calle,
                numero !== undefined ? numero : dirActual.numero,
                piso !== undefined ? piso : dirActual.piso,
                departamento !== undefined ? departamento : dirActual.departamento,
                localidad ? String(localidad).trim() : dirActual.localidad,
                provincia ? String(provincia).trim() : dirActual.provincia,
                codigo_postal !== undefined ? codigo_postal : dirActual.codigo_postal,
                nuevaPredeterminada,
                idDireccion,
                idUsuario
            ]
        );

        await client.query('COMMIT');

        res.status(200).json({
            mensaje: 'Dirección actualizada correctamente.',
            direccion: updateResult.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en actualizarDireccion:', error);
        res.status(500).json({ error: 'Error interno al actualizar la dirección.' });
    } finally {
        client.release();
    }
};

// ELIMINAR DIRECCIÓN
export const eliminarDireccion = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const idDireccion = Number(req.params.id);

    if (isNaN(idDireccion)) {
        res.status(400).json({ error: 'ID de dirección inválido.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const deleteResult = await client.query(
            `DELETE FROM direcciones 
             WHERE id_direccion = $1 AND id_usuario = $2 
             RETURNING predeterminada`,
            [idDireccion, idUsuario]
        );

        if (!deleteResult.rowCount || deleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'Dirección no encontrada o no pertenece al usuario.' });
            return;
        }

        // Si borró la que era predeterminada y le quedan otras, promuevo la más reciente como predeterminada
        if (deleteResult.rows[0].predeterminada) {
            await client.query(
                `UPDATE direcciones 
                 SET predeterminada = TRUE 
                 WHERE id_direccion = (
                     SELECT id_direccion FROM direcciones 
                     WHERE id_usuario = $1 
                     ORDER BY id_direccion DESC LIMIT 1
                 )`,
                [idUsuario]
            );
        }

        await client.query('COMMIT');

        res.status(200).json({ mensaje: 'Dirección eliminada correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en eliminarDireccion:', error);
        res.status(500).json({ error: 'Error al eliminar la dirección (puede estar vinculada a una orden existente).' });
    } finally {
        client.release();
    }
};

// ACTIVAR ROL DE VENDEDOR
export const activarRolVendedor = async (req: Request, res: Response): Promise<void> => {
    const idUsuario = req.usuario?.id_usuario;
    const emailUsuario = req.usuario?.email;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Buscar o crear el rol "vendedor"
        let rolResult = await client.query(`SELECT id_rol FROM roles WHERE LOWER(nombre) = 'vendedor'`);
        let idRolVendedor: number;

        if (!rolResult.rowCount || rolResult.rowCount === 0) {
            const nuevoRol = await client.query(
                `INSERT INTO roles (nombre) VALUES ('vendedor') RETURNING id_rol`
            );
            idRolVendedor = nuevoRol.rows[0].id_rol;
        } else {
            idRolVendedor = rolResult.rows[0].id_rol;
        }

        // Asignar rol al usuario
        await client.query(
            `INSERT INTO usuario_roles (id_usuario, id_rol) 
             VALUES ($1, $2) 
             ON CONFLICT (id_usuario, id_rol) DO NOTHING`,
            [idUsuario, idRolVendedor]
        );

        // Inicializar billetera virtual en 0 si aún no tiene
        await client.query(
            `INSERT INTO billeteras (id_usuario, saldo_disponible, saldo_retenido)
             VALUES ($1, 0, 0)
             ON CONFLICT (id_usuario) DO NOTHING`,
            [idUsuario]
        );

        // Consultar todos los roles actualizados del usuario
        const rolesActualizados = await client.query(
            `SELECT r.nombre 
             FROM roles r
             INNER JOIN usuario_roles ur ON r.id_rol = ur.id_rol
             WHERE ur.id_usuario = $1`,
            [idUsuario]
        );

        const listaRoles = rolesActualizados.rows.map((r) => r.nombre);

        await client.query('COMMIT');

        // Emitir nuevo token JWT con el rol de vendedor incluido
        const secret = process.env.JWT_SECRET || 'falu_super_secreto_jwt_2026';
        const expiresIn = (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'];

        const nuevoToken = jwt.sign(
            { id_usuario: idUsuario, email: emailUsuario, roles: listaRoles },
            secret,
            { expiresIn }
        );

        res.status(200).json({
            mensaje: 'Rol de vendedor activado y billetera inicializada.',
            roles: listaRoles,
            token: nuevoToken
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en activarRolVendedor:', error);
        res.status(500).json({ error: 'Error interno al activar el rol de vendedor.' });
    } finally {
        client.release();
    }
};