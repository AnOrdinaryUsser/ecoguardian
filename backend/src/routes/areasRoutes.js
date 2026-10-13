import { Router } from 'express'
import { createArea, deleteArea, listAreas, listRuns, runArea, updateArea } from '../controllers/areasController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

/**
 * @openapi
 * /api/areas:
 *   get:
 *     summary: Áreas monitorizadas (lectura para cualquier usuario con sesión)
 *     tags: [Áreas monitorizadas]
 *   post:
 *     summary: Define un área (polígono) que se reanalizará periódicamente (monitor/admin)
 *     tags: [Áreas monitorizadas]
 * /api/areas/{id}/run:
 *   post:
 *     summary: Lanza ahora el análisis del área (en segundo plano)
 *     tags: [Áreas monitorizadas]
 */
router.get('/', listAreas)
router.get('/:id/runs', listRuns)
router.post('/', requireRole('monitor'), createArea)
router.patch('/:id', requireRole('monitor'), updateArea)
router.delete('/:id', requireRole('monitor'), deleteArea)
router.post('/:id/run', requireRole('monitor'), runArea)

export default router
