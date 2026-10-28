import { Router } from 'express';
import { agregarFavorito, eliminarFavorito, verFavoritos, registrarBusqueda, verHistorialBusqueda } from '../controllers/activity.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

router.use(verificarToken, requerirRoles('comprador'));

router.post('/favorites', agregarFavorito);
router.delete('/favorites/:id', eliminarFavorito);
router.get('/favorites', verFavoritos);

router.post('/search-history', registrarBusqueda);
router.get('/search-history', verHistorialBusqueda);

export default router;