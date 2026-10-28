import { Router } from 'express';
import {
    obtenerCarrito,
    agregarAlCarrito,
    actualizarCantidad,
    eliminarDelCarrito
} from '../controllers/cart.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

router.use(verificarToken, requerirRoles('comprador'));

router.get('/', obtenerCarrito);
router.post('/', agregarAlCarrito);
router.put('/:id', actualizarCantidad);
router.delete('/:id', eliminarDelCarrito);

export default router;