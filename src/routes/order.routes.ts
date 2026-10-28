import { Router } from 'express';
import { procesarCheckout } from '../controllers/order.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

// El checkout es exclusivo para compradores registrados
router.post('/checkout', verificarToken, requerirRoles('comprador'), procesarCheckout);

export default router;