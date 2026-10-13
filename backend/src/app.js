import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from './docs/swagger.js'
import detectionsRoutes from './routes/detectionsRoutes.js'
import statsRoutes from './routes/statsRoutes.js'
import analysisImagesRoutes from './routes/analysisImagesRoutes.js'
import authRoutes from './routes/authRoutes.js'
import usersRoutes from './routes/usersRoutes.js'
import reviewRoutes from './routes/reviewRoutes.js'
import flightsRoutes from './routes/flightsRoutes.js'
import incidentsRoutes from './routes/incidentsRoutes.js'
import alertsRoutes from './routes/alertsRoutes.js'
import areasRoutes from './routes/areasRoutes.js'
import flightPlansRoutes from './routes/flightPlansRoutes.js'

// Express application setup: middlewares, routes, and Swagger UI.
export function createApp() {
  const app = express()

  // Detras de Caddy (Docker) la IP real del cliente llega en X-Forwarded-For.
  // Sin esto, los limitadores por IP (login, analisis...) veian a TODOS los
  // usuarios como la IP del proxy y se bloqueaban entre si.
  // TRUST_PROXY=1 -> confiar en un salto de proxy (el valor en docker-compose.prod.yml).
  if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v)
  }

  app.use(cors())
  // Default express.json() limit is 100kb, which a base64-encoded PNOA
  // tile thumbnail (a ~40-120KB JPEG becomes ~55-165KB as base64) can
  // exceed - see POST /api/analysis-images below, the endpoint that lets
  // the frontend keep those images out of localStorage entirely.
  app.use(express.json({ limit: '2mb' }))

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
  app.get('/api-docs.json', (req, res) => res.json(swaggerSpec))

  app.get('/health', (req, res) => res.json({ status: 'ok' }))

  app.use('/api/auth', authRoutes)
  app.use('/api/users', usersRoutes)
  app.use('/api/detections', detectionsRoutes)
  app.use('/api/review', reviewRoutes)
  app.use('/api/flights', flightsRoutes)
  app.use('/api/incidents', incidentsRoutes)
  app.use('/api/alerts', alertsRoutes)
  app.use('/api/areas', areasRoutes)
  app.use('/api/flight-plans', flightPlansRoutes)
  app.use('/api/stats', statsRoutes)
  app.use('/api/analysis-images', analysisImagesRoutes)

  // Centralized error handler.
  app.use((err, req, res, next) => {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })

  return app
}

export default createApp
