import { Router } from 'express';
import { crearCupon, obtenerReportesVendedor } from '../controllers/marketing.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

router.use(verificarToken, requerirRoles('vendedor'));

router.post('/coupons', crearCupon);
router.get('/reports', obtenerReportesVendedor);

export default router;