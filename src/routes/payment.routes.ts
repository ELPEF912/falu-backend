import { Router } from 'express';
import { webhookSimuladoMP } from '../controllers/payment.controller';

const router = Router();

// Esta ruta no lleva middleware de token porque simula ser llamada por Mercado Pago
router.post('/webhook', webhookSimuladoMP);

export default router;