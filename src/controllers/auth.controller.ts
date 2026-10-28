import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../config/database';
import { enviarCorreo } from '../config/mailer';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 10;

// REGISTRO DE USUARIO
export const registrarUsuario = async (req: Request, res: Response): Promise<void> => {
    const { nombre, apellido, email, password, telefono } = req.body;

    if (!nombre || !apellido || !email || !password) {
        res.status(400).json({ error: 'Nombre, apellido, email y contraseña obligatorios.' });
        return;
    }

    const emailLimpio = String(email).trim().toLowerCase();

    if (!EMAIL_REGEX.test(emailLimpio)) {
        res.status(400).json({ error: 'El formato del correo electrónico no es válido.' });
        return;
    }

    if (String(password).length < 8) {
        res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar si el email ya existe
        const existeEmail = await client.query(
            'SELECT id_usuario FROM usuarios WHERE email = $1',
            [emailLimpio]
        );

        if (existeEmail.rowCount && existeEmail.rowCount > 0) {
            await client.query('ROLLBACK');
            res.status(409).json({ error: 'El correo electrónico ya se encuentra registrado.' });
            return;
        }

        // Aplicar hash irreversible.
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Insertar usuario en tabla usuarios
        const nuevoUsuarioResult = await client.query(
            `INSERT INTO usuarios (nombre, apellido, email, password_hash, telefono, estado)
             VALUES ($1, $2, $3, $4, $5, 'activo')
             RETURNING id_usuario, nombre, apellido, email, fecha_registro, estado`,
            [nombre.trim(), apellido.trim(), emailLimpio, passwordHash, telefono || null]
        );

        const nuevoUsuario = nuevoUsuarioResult.rows[0];

        // Obtener el rol 'comprador' por defecto.
        let rolResult = await client.query(`SELECT id_rol FROM roles WHERE LOWER(nombre) = 'comprador'`);
        let idRolComprador: number;

        if (!rolResult.rowCount || rolResult.rowCount === 0) {
            const crearRol = await client.query(
                `INSERT INTO roles (nombre) VALUES ('comprador') RETURNING id_rol`
            );
            idRolComprador = crearRol.rows[0].id_rol;
        } else {
            idRolComprador = rolResult.rows[0].id_rol;
        }

        // Asignar rol al usuario en usuario_roles
        await client.query(
            `INSERT INTO usuario_roles (id_usuario, id_rol) VALUES ($1, $2)`,
            [nuevoUsuario.id_usuario, idRolComprador]
        );

        // Inicializar un carrito vacío en la tabla carritos
        await client.query(
            `INSERT INTO carritos (id_usuario) VALUES ($1)`,
            [nuevoUsuario.id_usuario]
        );

        await client.query('COMMIT');

        // Notificación de registro exitoso
        await enviarCorreo(
            nuevoUsuario.email,
            'Bienvenido a Falú Marketplace',
            `<h2>¡Hola ${nuevoUsuario.nombre}!</h2><p>Tu cuenta en Falú fue creada exitosamente.</p>`
        );

        res.status(201).json({
            mensaje: 'Usuario registrado exitosamente.',
            usuario: {
                id_usuario: nuevoUsuario.id_usuario,
                nombre: nuevoUsuario.nombre,
                apellido: nuevoUsuario.apellido,
                email: nuevoUsuario.email,
                roles: ['comprador']
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en registrarUsuario:', error);
        res.status(500).json({ error: 'Error interno del servidor al registrar el usuario.' });
    } finally {
        client.release();
    }
};

//INICIAR SESIÓN
export const iniciarSesion = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ error: 'Debe proporcionar correo electrónico y contraseña.' });
        return;
    }

    const emailLimpio = String(email).trim().toLowerCase();

    try {
        const userResult = await pool.query(
            `SELECT id_usuario, nombre, apellido, email, password_hash, estado 
             FROM usuarios 
             WHERE email = $1`,
            [emailLimpio]
        );

        if (!userResult.rowCount || userResult.rowCount === 0) {
            res.status(401).json({ error: 'Credenciales inválidas.' });
            return;
        }

        const usuario = userResult.rows[0];

        if (usuario.estado !== 'activo') {
            res.status(403).json({ error: `La cuenta se encuentra en estado: ${usuario.estado}.` });
            return;
        }

        const passwordValida = await bcrypt.compare(password, usuario.password_hash);
        if (!passwordValida) {
            res.status(401).json({ error: 'Credenciales inválidas.' });
            return;
        }

        // Obtener roles asociados al usuario
        const rolesResult = await pool.query(
            `SELECT r.nombre 
             FROM roles r
             INNER JOIN usuario_roles ur ON r.id_rol = ur.id_rol
             WHERE ur.id_usuario = $1`,
            [usuario.id_usuario]
        );

        const roles = rolesResult.rows.map((row) => row.nombre);

        // Generar JWT con fecha de expiración definida y verificable.
        const secret = process.env.JWT_SECRET || 'falu_super_secreto_jwt_2026';
        const expiresIn = (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'];

        const token = jwt.sign(
            {
                id_usuario: usuario.id_usuario,
                email: usuario.email,
                roles
            },
            secret,
            { expiresIn }
        );

        // Decodificar para exponer el timestamp exacto de expiración en la respuesta
        const decoded = jwt.decode(token) as { exp?: number };

        res.status(200).json({
            mensaje: 'Autenticación exitosa.',
            token,
            expiracion: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
            usuario: {
                id_usuario: usuario.id_usuario,
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                email: usuario.email,
                roles
            }
        });
    } catch (error) {
        console.error('Error en iniciarSesion:', error);
        res.status(500).json({ error: 'Error interno del servidor al iniciar sesión.' });
    }
};

// CERRAR SESIÓN
export const cerrarSesion = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
        mensaje: 'Sesión cerrada correctamente. El cliente debe eliminar el token almacenado.'
    });
};

// SOLICITAR RECUPERACIÓN DE CONTRASEÑA
export const solicitarRecuperacion = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;

    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
        res.status(400).json({ error: 'Debe proporcionar un correo electrónico válido.' });
        return;
    }

    const emailLimpio = String(email).trim().toLowerCase();

    try {
        const userResult = await pool.query(
            `SELECT id_usuario, nombre, email, estado FROM usuarios WHERE email = $1`,
            [emailLimpio]
        );

        if (!userResult.rowCount || userResult.rowCount === 0 || userResult.rows[0].estado !== 'activo') {
            res.status(200).json({
                mensaje: 'Si el correo se encuentra registrado, recibirá un enlace de recuperación.'
            });
            return;
        }

        const usuario = userResult.rows[0];

        // Invalidar tokens anteriores sin usar de este usuario
        await pool.query(
            `UPDATE tokens_recuperacion SET usado = TRUE WHERE id_usuario = $1 AND usado = FALSE`,
            [usuario.id_usuario]
        );

        // Generar token aleatorio de un solo uso y su hash SHA-256 para la base de datos
        const tokenPlano = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');

        // Expira en 30 minutos
        const fechaExpiracion = new Date(Date.now() + 30 * 60 * 1000);

        await pool.query(
            `INSERT INTO tokens_recuperacion (id_usuario, token_hash, fecha_expiracion, usado)
             VALUES ($1, $2, $3, FALSE)`,
            [usuario.id_usuario, tokenHash, fechaExpiracion]
        );

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const enlaceRecuperacion = `${frontendUrl}/reset-password?token=${tokenPlano}`;

        await enviarCorreo(
            usuario.email,
            'Recuperación de contraseña - Falú Marketplace',
            `<p>Hola ${usuario.nombre},</p>
             <p>Solicitaste restablecer tu contraseña. Haz clic en el siguiente enlace temporal (válido por 30 minutos):</p>
             <p><a href="${enlaceRecuperacion}">${enlaceRecuperacion}</a></p>
             <p>Token para pruebas en Postman: <strong>${tokenPlano}</strong></p>`
        );

        res.status(200).json({
            mensaje: 'Si el correo se encuentra registrado, recibirá un enlace de recuperación.'
        });
    } catch (error) {
        console.error('Error en solicitarRecuperacion:', error);
        res.status(500).json({ error: 'Error interno al procesar la solicitud de recuperación.' });
    }
};

// RESTABLECER CONTRASEÑA CON TOKEN TEMPORAL
export const restablecerPassword = async (req: Request, res: Response): Promise<void> => {
    const { token, nuevaPassword } = req.body;

    if (!token || !nuevaPassword) {
        res.status(400).json({ error: 'El token y la nueva contraseña son obligatorios.' });
        return;
    }

    if (String(nuevaPassword).length < 8) {
        res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
        return;
    }

    const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const tokenResult = await client.query(
            `SELECT t.id_token, t.id_usuario, u.email, u.nombre
             FROM tokens_recuperacion t
             INNER JOIN usuarios u ON t.id_usuario = u.id_usuario
             WHERE t.token_hash = $1 
               AND t.usado = FALSE 
               AND t.fecha_expiracion > NOW()
             FOR UPDATE`,
            [tokenHash]
        );

        if (!tokenResult.rowCount || tokenResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'El enlace de recuperación es inválido o ha expirado.' });
            return;
        }

        const registroToken = tokenResult.rows[0];
        const nuevoPasswordHash = await bcrypt.hash(nuevaPassword, SALT_ROUNDS);

        // Actualizar la contraseña del usuario
        await client.query(
            `UPDATE usuarios SET password_hash = $1 WHERE id_usuario = $2`,
            [nuevoPasswordHash, registroToken.id_usuario]
        );

        // Marcar el token como usado (un solo uso estricto)
        await client.query(
            `UPDATE tokens_recuperacion SET usado = TRUE WHERE id_token = $1`,
            [registroToken.id_token]
        );

        await client.query('COMMIT');

        // Alerta de seguridad inmediata por cambio de contraseña
        await enviarCorreo(
            registroToken.email,
            'Alerta de Seguridad: Contraseña modificada - Falú',
            `<p>Hola ${registroToken.nombre},</p>
             <p>Te informamos que la contraseña de tu cuenta ha sido modificada exitosamente.</p>`
        );

        res.status(200).json({ mensaje: 'Contraseña restablecida exitosamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en restablecerPassword:', error);
        res.status(500).json({ error: 'Error interno al restablecer la contraseña.' });
    } finally {
        client.release();
    }
};