import { Router, Request, Response } from 'express';
import {
    obtenerPerfil,
    actualizarPerfil,
    listarDirecciones,
    crearDireccion,
    actualizarDireccion,
    eliminarDireccion,
    activarRolVendedor
} from '../controllers/user.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

// Todas las rutas de perfil y direcciones requieren estar autenticado
router.use(verificarToken);

// Perfil personal
router.get('/profile', obtenerPerfil);
router.put('/profile', actualizarPerfil);

// CRUD de Direcciones
router.get('/addresses', listarDirecciones);
router.post('/addresses', crearDireccion);
router.put('/addresses/:id', actualizarDireccion);
router.delete('/addresses/:id', eliminarDireccion);

// Gestión de Roles
router.post('/become-seller', activarRolVendedor);

router.get('/seller-check', requerirRoles('vendedor', 'administrador'), (req: Request, res: Response) => {
    res.status(200).json({ mensaje: 'Acceso permitido al área de Vendedor.', usuario: req.usuario });
});

router.get('/admin-check', requerirRoles('administrador'), (req: Request, res: Response) => {
    res.status(200).json({ mensaje: 'Acceso permitido al área exclusiva de Administrador.', usuario: req.usuario });
});

export default router;