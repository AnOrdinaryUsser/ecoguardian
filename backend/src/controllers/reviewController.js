import { pool } from '../config/db.js'
import { sizeClass } from '../services/geo.js'

const SOURCES = ['satellite', 'drone']

function filters(query, { withStatus }) {
  const where = []
  const params = []
  const add = (sql, value) => {
    params.push(value)
    where.push(sql.replace('?', `$${params.length}`))
  }
  if (withStatus) {
    if (query.status === 'reviewed') where.push("d.review_status <> 'pending'")
    else if (['pending', 'confirmed', 'rejected'].includes(query.status)) add('d.review_status = ?', query.status)
    else where.push("d.review_status = 'pending'")
  }
  if (SOURCES.includes(query.source)) add('d.source_type = ?', query.source)
  // Por defecto solo lo "ilegal probable": lo que coincide con un vertedero legal no necesita revision.
  if (query.includeLegal !== '1') where.push("d.classification_status IS DISTINCT FROM 'legal_probable'")
  const min = Number(query.minConfidence)
  if (Number.isFinite(min)) add('d.confidence >= ?', Math.min(Math.max(min, 0), 1))
  if (Number.isInteger(Number(query.flightId)) && query.flightId) add('d.flight_id = ?', Number(query.flightId))
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

// GET /api/review?status=pending|confirmed|rejected|reviewed&source=&includeLegal=1&minConfidence=&flightId=&limit=&offset=
export async function listReview(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 100)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const { sql, params } = filters(req.query, { withStatus: true })
    const reviewed = req.query.status && req.query.status !== 'pending'

    const items = await pool.query(
      `SELECT d.id, d.confidence, d.longitude, d.latitude, d.classification_status, d.nearest_legal_name,
              d.nearest_legal_distance_m, d.source_type, d.image_source, d.position_accuracy, d.sightings,
              d.bbox, d.cell_image_id, d.area_m2, d.review_status, d.review_note, d.reviewed_at, d.created_at, d.flight_id, d.frame_id,
              f.name AS flight_name, u.full_name AS reviewer_name,
              (di.detection_id IS NOT NULL) AS has_image, inc.id AS incident_id, inc.status AS incident_status
         FROM detections d
         LEFT JOIN incidents inc ON inc.detection_id = d.id
         LEFT JOIN flights f ON f.id = d.flight_id
         LEFT JOIN users u ON u.id = d.reviewed_by
         LEFT JOIN detection_images di ON di.detection_id = d.id
         ${sql}
         ORDER BY ${reviewed ? 'd.reviewed_at DESC NULLS LAST' : 'd.confidence DESC, d.created_at DESC'}
         LIMIT ${limit} OFFSET ${offset}`,
      params,
    )
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM detections d ${sql}`, params)

    res.json({
      total: total.rows[0].n,
      items: items.rows.map((r) => ({
        id: r.id,
        confidence: r.confidence,
        longitude: r.longitude,
        latitude: r.latitude,
        classificationStatus: r.classification_status,
        nearestLegalName: r.nearest_legal_name,
        nearestLegalDistanceM: r.nearest_legal_distance_m,
        sourceType: r.source_type,
        imageSource: r.image_source,
        positionAccuracy: r.position_accuracy,
        sightings: r.sightings,
        reviewStatus: r.review_status,
        reviewNote: r.review_note,
        reviewedAt: r.reviewed_at,
        reviewerName: r.reviewer_name,
        createdAt: r.created_at,
        flightId: r.flight_id,
        flightName: r.flight_name,
        frameId: r.frame_id,
        hasImage: r.has_image,
        areaM2: r.area_m2,
        sizeClass: sizeClass(r.area_m2),
        incidentId: r.incident_id,
        incidentStatus: r.incident_status,
        bbox: Array.isArray(r.bbox) ? r.bbox : null,
        // Celda/fotograma completo sobre el que se dibuja la caja.
        cellImagePath: r.cell_image_id
          ? `/api/analysis-images/${r.cell_image_id}`
          : r.flight_id && r.frame_id
            ? `/api/flights/${r.flight_id}/frames/${r.frame_id}/image`
            : null,
      })),
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/review/counts  (pendientes / confirmadas / rechazadas con los mismos filtros)
export async function reviewCounts(req, res, next) {
  try {
    const { sql, params } = filters(req.query, { withStatus: false })
    const { rows } = await pool.query(`SELECT d.review_status AS status, COUNT(*)::int AS n FROM detections d ${sql} GROUP BY d.review_status`, params)
    const counts = { pending: 0, confirmed: 0, rejected: 0 }
    for (const r of rows) counts[r.status] = r.n
    res.json(counts)
  } catch (error) {
    next(error)
  }
}

// GET /api/detections/:id/image  (recorte de la deteccion)
export async function getDetectionImage(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT image_data, mime_type FROM detection_images WHERE detection_id = $1', [Number(req.params.id)])
    if (!rows[0]) return res.status(404).json({ error: 'Sin imagen.' })
    res.setHeader('Content-Type', rows[0].mime_type)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(rows[0].image_data)
  } catch (error) {
    next(error)
  }
}
