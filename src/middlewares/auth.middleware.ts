import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extiendo la interfaz Request de Express para que TypeScript reconozca req.usuario
declare global {
    namespace Express {
        interface Request {
            usuario?: {
                id_usuario: number;
                email: string;
                roles: string[];
            };
        }
    }
}

// 1. Verificar que el usuario tenga un token JWT válido
export const verificarToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Acceso denegado. Token no proporcionado o formato inválido.' });
        return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'falu_super_secreto_jwt_2026';

    try {
        const decoded = jwt.verify(token, secret) as {
            id_usuario: number;
            email: string;
            roles: string[];
        };

        req.usuario = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido o expirado.' });
    }
};

// 2. Verificar que el usuario posea al menos uno de los roles requeridos
export const requerirRoles = (...rolesPermitidos: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.usuario || !req.usuario.roles) {
            res.status(401).json({ error: 'Usuario no autenticado.' });
            return;
        }

        const tienePermiso = req.usuario.roles.some((rol) =>
            rolesPermitidos.includes(rol.toLowerCase())
        );

        if (!tienePermiso) {
            res.status(403).json({
                error: `Acceso prohibido. Se requiere uno de los siguientes roles: ${rolesPermitidos.join(', ')}.`
            });
            return;
        }

        next();
    };
};