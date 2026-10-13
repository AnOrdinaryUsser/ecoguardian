import { Router } from 'express'
import { deletePlan, exportPlan, listPlans, preview, profiles, savePlan } from '../controllers/flightPlansController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

/**
 * @openapi
 * /api/flight-plans/plan:
 *   post:
 *     summary: Calcula una ruta de barrido en serpentina sobre un polígono (o alrededor de un punto) a la altura y solape indicados
 *     tags: [Rutas de vuelo]
 * /api/flight-plans/export:
 *   post:
 *     summary: Descarga la ruta como KMZ (DJI WPML), CSV de Litchi, GPX o GeoJSON
 *     tags: [Rutas de vuelo]
 * /api/flight-plans:
 *   get: { summary: Planes de vuelo guardados, tags: [Rutas de vuelo] }
 *   post: { summary: Guarda un plan de vuelo (piloto/admin), tags: [Rutas de vuelo] }
 */
router.get('/profiles', profiles)
router.get('/', listPlans)
router.post('/plan', requireRole('piloto'), preview)
router.post('/export', requireRole('piloto'), exportPlan)
router.post('/', requireRole('piloto'), savePlan)
router.delete('/:id', requireRole('piloto'), deletePlan)

export default router
