import { Router } from 'express'
import { createRecipient, deleteRecipient, listLog, listRecipients, testAlert, updateRecipient } from '../controllers/alertsController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(authenticate, requireRole('gestor')) // gestor y admin

/**
 * @openapi
 * /api/alerts/recipients:
 *   get: { summary: Destinatarios de las alertas por correo, tags: [Alertas] }
 *   post: { summary: Añade un destinatario, tags: [Alertas] }
 * /api/alerts/log:
 *   get: { summary: Últimos envíos de correo (enviado / SMTP sin configurar / fallido), tags: [Alertas] }
 * /api/alerts/test:
 *   post: { summary: Envía un correo de prueba, tags: [Alertas] }
 */
router.get('/recipients', listRecipients)
router.post('/recipients', createRecipient)
router.patch('/recipients/:id', updateRecipient)
router.delete('/recipients/:id', deleteRecipient)
router.get('/log', listLog)
router.post('/test', testAlert)

export default router
