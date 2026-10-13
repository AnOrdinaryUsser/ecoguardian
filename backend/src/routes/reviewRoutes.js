import { Router } from 'express'
import { listReview, reviewCounts } from '../controllers/reviewController.js'
import { datasetSummary, exportDataset } from '../controllers/datasetController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()

/**
 * @openapi
 * /api/review:
 *   get:
 *     summary: Cola de revision de detecciones (pendientes / revisadas)
 *     tags: [Revision]
 */
router.get('/', authenticate, listReview)
router.get('/counts', authenticate, reviewCounts)

/**
 * @openapi
 * /api/review/export:
 *   get:
 *     summary: Exporta el dataset revisado (confirmadas = positivos, descartadas = negativos) en formato YOLO (ZIP). Monitor/admin.
 *     tags: [Revision]
 *     parameters:
 *       - { in: query, name: source, schema: { type: string, enum: [satellite, drone] } }
 *       - { in: query, name: negatives, schema: { type: string, enum: ['0', '1'] }, description: "0 = sin negativos" }
 *       - { in: query, name: valPercent, schema: { type: number, default: 20 } }
 * /api/review/export/summary:
 *   get:
 *     summary: Cuántas imágenes y cajas tendría el dataset exportado
 *     tags: [Revision]
 */
router.get('/export/summary', authenticate, requireRole('monitor'), datasetSummary)
router.get('/export', authenticate, requireRole('monitor'), exportDataset)

export default router
