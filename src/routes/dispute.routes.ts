import { Router } from 'express';
import { iniciarReclamo, enviarMensajeDisputa, resolverDisputaAdmin } from '../controllers/dispute.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

router.post('/claim', verificarToken, iniciarReclamo);
router.post('/:id_pedido/message', verificarToken, enviarMensajeDisputa);

router.put('/admin/resolve', verificarToken, requerirRoles('administrador'), resolverDisputaAdmin);

export default router;