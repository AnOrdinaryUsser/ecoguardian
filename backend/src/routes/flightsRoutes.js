import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { authenticate, requireRole } from '../middleware/auth.js'
import { TMP_DIR } from '../config/paths.js'
import {
  createFlight, listFlights, getFlight, getFlightStatus, getFrameImage, deleteFlight,
} from '../controllers/flightsController.js'

fs.mkdirSync(TMP_DIR, { recursive: true })

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 4096
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 2 },
})

const router = Router()
router.use(authenticate)

/**
 * @openapi
 * /api/flights:
 *   post:
 *     summary: Sube un vuelo de dron (video + registro GPS) para analizarlo (piloto)
 *     tags: [Drones]
 *   get:
 *     summary: Lista de vuelos
 *     tags: [Drones]
 */
router.post(
  '/',
  requireRole('piloto'),
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'telemetry', maxCount: 1 }]),
  createFlight,
)
router.get('/', listFlights)
router.get('/:id', getFlight)
router.get('/:id/status', getFlightStatus)
router.get('/:id/frames/:frameId/image', getFrameImage)
router.delete('/:id', requireRole('piloto'), deleteFlight)

export default router
