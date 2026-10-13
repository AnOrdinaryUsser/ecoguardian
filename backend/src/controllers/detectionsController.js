import { getNearestLegalFacility } from '../services/legalFacilityService.js'
import { classifyDetection } from '../services/classificationService.js'
import { analyzeAndStoreCell } from '../services/analysisService.js'
import { ensureIncidentForDetection, dismissOpenIncident } from '../services/incidentService.js'
import { pool } from '../config/db.js'


// POST /api/detections/analyze
export async function analyzeCell(req, res, next) {
  try {
    const { bounds, confidenceThreshold } = req.body ?? {}
    // Siempre Mapbox: es la fuente con la que se entreno el modelo.
    const imageSource = 'mapbox'

    if (!bounds || typeof bounds.north !== 'number') {
      return res.status(400).json({ error: 'bounds (north, south, east, west) is required' })
    }

    const result = await analyzeAndStoreCell({
      bounds,
      confidenceThreshold: confidenceThreshold ?? 0.9,
      userId: req.user?.id ?? null,
      imageSource,
    })
    res.json({
      detections: result.detections,
      areaSquareMeters: result.areaSquareMeters,
      imageBase64: result.imageBase64,
      bounds,
      imageSource,
      modelVersion: result.modelVersion,
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/detections  (GeoJSON, requiere sesion)
const DETECTIONS_LIST_LIMIT = 3000

export async function listDetections(req, res, next) {
  try {
    const requested = Number(req.query.minConfidence)
    const minConfidence = Number.isFinite(requested) ? Math.min(Math.max(requested, 0.5), 1) : 0.75
    const reviewStatus = ['pending', 'confirmed', 'rejected'].includes(req.query.reviewStatus) ? req.query.reviewStatus : null

    const result = await pool.query(
      `
      SELECT
        ST_AsGeoJSON(geom)::json AS geometry,
        json_build_object(
          'id', id,
          'confidence', confidence,
          'className', class_name,
          'classificationStatus', classification_status,
          'nearestLegalName', nearest_legal_name,
          'nearestLegalDistanceM', nearest_legal_distance_m,
          'imageSource', image_source,
          'sourceType', source_type,
          'reviewStatus', review_status,
          'areaM2', area_m2,
          'createdAt', created_at
        ) AS properties
      FROM detections
      WHERE confidence >= $1 AND ($3::text IS NULL OR review_status = $3)
      ORDER BY created_at DESC
      LIMIT $2
    `,
      [minConfidence, DETECTIONS_LIST_LIMIT, reviewStatus],
    )

    res.json({
      type: 'FeatureCollection',
      minConfidence,
      features: result.rows.map((row) => ({ type: 'Feature', geometry: row.geometry, properties: row.properties })),
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/detections/:id/context
export async function getDetectionContext(req, res, next) {
  try {
    const result = await pool.query('SELECT longitude, latitude FROM detections WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Detection not found' })

    const nearestLegalFacility = await getNearestLegalFacility(result.rows[0])
    res.json({ nearestLegalFacility, classification: classifyDetection({ nearestLegalFacility }) })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/detections/:id/review  { status: 'confirmed' | 'rejected' | 'pending', note? }
// Revision manual (monitor/admin). Las confirmadas/rechazadas sirven tambien
// como etiquetas para futuros reentrenamientos del modelo.
export async function reviewDetection(req, res, next) {
  try {
    const id = Number(req.params.id)
    const { status, note } = req.body ?? {}
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id no valido.' })
    if (!['pending', 'confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status debe ser pending, confirmed o rejected.' })
    }
    const { rows } = await pool.query(
      `UPDATE detections
         SET review_status = $1::text, review_note = $2,
             reviewed_by = CASE WHEN $1::text = 'pending' THEN NULL ELSE $3::int END,
             reviewed_at = CASE WHEN $1::text = 'pending' THEN NULL ELSE now() END
       WHERE id = $4
       RETURNING id, review_status, review_note, reviewed_at`,
      [status, note ?? null, req.user.id, id],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Deteccion no encontrada.' })

    // Confirmar crea la incidencia y avisa a los destinatarios de alertas; descartar cierra la incidencia abierta.
    let incident = null
    if (status === 'confirmed') incident = await ensureIncidentForDetection(id, req.user)
    else await dismissOpenIncident(id, req.user, status)
    res.json({ detection: rows[0], incident: incident ? { id: incident.id, status: incident.status } : null })
  } catch (error) {
    next(error)
  }
}
