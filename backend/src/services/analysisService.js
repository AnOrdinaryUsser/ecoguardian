import { pool } from '../config/db.js'
import { predictCell } from './modelClient.js'
import { getNearestLegalFacility } from './legalFacilityService.js'
import { classifyDetection } from './classificationService.js'
import { boundsAreaSquareMeters, boxAreaOnBounds, sizeClass } from './geo.js'

// Dos detecciones satelitales a menos de esta distancia (m) se consideran el mismo vertedero
// cuando se reanaliza una zona (areas monitorizadas).
const DEDUPE_DISTANCE_M = Number(process.env.DETECTION_DEDUPE_METERS) || 40

// Analiza una celda con el modelo y guarda lo que encuentra.
//  - dedupe=false (analisis manual): cada deteccion se guarda tal cual.
//  - dedupe=true (areas monitorizadas): si ya hay una deteccion a < DEDUPE_DISTANCE_M no se duplica;
//    se suma un avistamiento y no cuenta como nueva (si la habian descartado, tampoco reaparece).
export async function analyzeAndStoreCell({ bounds, confidenceThreshold = 0.5, userId = null, areaId = null, dedupe = false, imageSource = 'mapbox' }) {
  const prediction = await predictCell({ bounds, confidenceThreshold, imageSource })
  const analyzed = prediction.analyzed_bounds ?? bounds

  // Primero se comprueba cuales son nuevas, para no guardar la imagen de la celda si no hace falta.
  const prepared = []
  for (const detection of prediction.detections ?? []) {
    let existingId = null
    if (dedupe) {
      const near = await pool.query(
        `SELECT id FROM detections
          WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
          ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography LIMIT 1`,
        [detection.longitude, detection.latitude, DEDUPE_DISTANCE_M],
      )
      existingId = near.rows[0]?.id ?? null
    }
    prepared.push({ detection, existingId })
  }

  let cellImageId = null
  if (prediction.cell_image_base64 && prepared.some((p) => !p.existingId)) {
    const stored = await pool.query('INSERT INTO analysis_images (image_data, mime_type, created_by) VALUES ($1, $2, $3) RETURNING id', [
      Buffer.from(prediction.cell_image_base64, 'base64'),
      'image/jpeg',
      userId,
    ])
    cellImageId = stored.rows[0].id
  }

  const results = []
  for (const { detection, existingId } of prepared) {
    if (existingId) {
      await pool.query('UPDATE detections SET sightings = sightings + 1 WHERE id = $1', [existingId])
      continue
    }
    const nearestLegalFacility = await getNearestLegalFacility({ longitude: detection.longitude, latitude: detection.latitude })
    const classification = classifyDetection({ nearestLegalFacility })
    const className = detection.class_name ?? detection.className ?? 'dump_site'
    const areaM2 = boxAreaOnBounds(detection.box_normalized, analyzed)

    const inserted = await pool.query(
      `INSERT INTO detections
         (longitude, latitude, confidence, class_name, classification_status,
          nearest_legal_name, nearest_legal_distance_m, image_source, source_type, model_version, created_by,
          bbox, cell_image_id, area_m2, monitored_area_id, geom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'satellite', $9, $10, $11::jsonb, $12::int, $13, $14::int,
               ST_SetSRID(ST_MakePoint($1, $2), 4326))
       RETURNING id`,
      [
        detection.longitude,
        detection.latitude,
        detection.confidence,
        className,
        classification.status,
        nearestLegalFacility?.name ?? null,
        nearestLegalFacility?.distance_meters ?? null,
        imageSource,
        prediction.model_version ?? null,
        userId,
        JSON.stringify(detection.box_normalized ?? null),
        cellImageId,
        areaM2,
        areaId,
      ],
    )
    if (detection.crop_base64) {
      await pool.query('INSERT INTO detection_images (detection_id, image_data) VALUES ($1, $2)', [inserted.rows[0].id, Buffer.from(detection.crop_base64, 'base64')])
    }
    results.push({
      id: inserted.rows[0].id,
      confidence: detection.confidence,
      longitude: detection.longitude,
      latitude: detection.latitude,
      className,
      areaM2,
      sizeClass: sizeClass(areaM2),
      nearestLegalFacility,
      classification,
      reviewStatus: 'pending',
    })
  }

  return {
    detections: results,
    skippedExisting: prepared.length - results.length,
    areaSquareMeters: boundsAreaSquareMeters(analyzed),
    imageBase64: prediction.image_base64 ?? '',
    bounds,
    modelVersion: prediction.model_version ?? 'unknown',
  }
}
