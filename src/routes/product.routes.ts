import { Router } from 'express';
import { crearProducto, listarCatalogo, obtenerDetalleProducto } from '../controllers/product.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

// RUTAS PÚBLICAS

router.get('/', listarCatalogo);
router.get('/:id', obtenerDetalleProducto);

// RUTAS PROTEGIDAS

router.post('/', verificarToken, requerirRoles('vendedor', 'administrador'), crearProducto);

export default router;