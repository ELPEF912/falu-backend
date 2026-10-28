import { Router } from 'express';
import { crearResena, obtenerReputacionVendedor } from '../controllers/interaction.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

// Ruta pública
router.get('/seller/:id/reputation', obtenerReputacionVendedor);

// Ruta protegida exclusiva para compradores
router.post('/reviews', verificarToken, requerirRoles('comprador'), crearResena);

export default router;