import { Router } from 'express';
import { listarPreguntas, hacerPregunta, responderPregunta } from '../controllers/qa.controller';
import { verificarToken, requerirRoles } from '../middlewares/auth.middleware';

const router = Router();

// Ruta pública (cualquiera puede ver las preguntas de un producto)
router.get('/product/:id_producto', listarPreguntas);

// Ruta protegida (cualquier usuario logueado puede preguntar)
router.post('/', verificarToken, hacerPregunta);

// Ruta protegida (solo el vendedor puede responder)
router.put('/:id_consulta/answer', verificarToken, requerirRoles('vendedor'), responderPregunta);

export default router;