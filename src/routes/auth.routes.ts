import { Router } from 'express';
import {
    registrarUsuario,
    iniciarSesion,
    cerrarSesion,
    solicitarRecuperacion,
    restablecerPassword
} from '../controllers/auth.controller';

const router = Router();

router.post('/register', registrarUsuario);
router.post('/login', iniciarSesion);
router.post('/logout', cerrarSesion);
router.post('/forgot-password', solicitarRecuperacion);
router.post('/reset-password', restablecerPassword);

export default router;