import { Router } from 'express'
import {
  addNote, createIncident, deleteIncident, getIncident, incidentsSummary, listAssignees, listIncidents, notifyAuthority, updateIncident,
} from '../controllers/incidentsController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

/**
 * @openapi
 * /api/incidents:
 *   get:
 *     summary: Lista de incidencias (vertederos confirmados en gestión). Lectura para cualquier usuario con sesión.
 *     tags: [Incidencias]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [open, notified, in_progress, resolved, dismissed] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [low, medium, high] } }
 *       - { in: query, name: assignedTo, schema: { type: string }, description: "id de usuario o 'me'" }
 *       - { in: query, name: active, schema: { type: string }, description: "1 = solo abiertas, notificadas y en curso" }
 *   post:
 *     summary: Crea una incidencia a partir de una detección o de unas coordenadas (gestor/admin)
 *     tags: [Incidencias]
 * /api/incidents/summary:
 *   get:
 *     summary: Contadores por estado, superficie activa y retrasadas
 *     tags: [Incidencias]
 * /api/incidents/{id}:
 *   get:
 *     summary: Detalle con historial de seguimiento y avisos enviados
 *     tags: [Incidencias]
 *   patch:
 *     summary: Cambia estado, prioridad, responsable, entidad, fecha de limpieza… (gestor/admin)
 *     tags: [Incidencias]
 * /api/incidents/{id}/events:
 *   post:
 *     summary: Añade una nota de seguimiento (gestor/admin)
 *     tags: [Incidencias]
 * /api/incidents/{id}/notify:
 *   post:
 *     summary: Envía el informe de la incidencia (coordenadas y detalles) a la entidad responsable (gestor/admin)
 *     tags: [Incidencias]
 */
router.get('/', listIncidents)
router.get('/summary', incidentsSummary)
router.get('/assignees', listAssignees)
router.get('/:id', getIncident)
router.post('/', requireRole('gestor'), createIncident)
router.patch('/:id', requireRole('gestor'), updateIncident)
router.post('/:id/events', requireRole('gestor'), addNote)
router.post('/:id/notify', requireRole('gestor'), notifyAuthority)
router.delete('/:id', requireRole(), deleteIncident)

export default router
