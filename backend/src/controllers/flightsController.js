import fs from 'node:fs/promises'
import path from 'node:path'
import { pool } from '../config/db.js'
import { FLIGHTS_DIR } from '../config/paths.js'
import { parseTelemetry } from '../services/telemetryParsers.js'
import { enqueueFlight } from '../services/flightProcessor.js'

const DRONE_MODELS = ['avata2', 'mini5pro', 'otro']

function flightRow(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    droneModel: row.drone_model,
    status: row.status,
    errorMessage: row.error_message,
    videoFilename: row.video_filename,
    videoDurationS: row.video_duration_s,
    telemetryFilename: row.telemetry_filename,
    frameIntervalS: row.frame_interval_s,
    confidenceThreshold: row.confidence_threshold,
    framesTotal: row.frames_total,
    framesDone: row.frames_done,
    detectionsCount: row.detections_count,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }
}

async function removeUploaded(files) {
  for (const file of Object.values(files ?? {}).flat()) await fs.rm(file.path, { force: true }).catch(() => {})
}

// POST /api/flights  (multipart: video, telemetry, name, droneModel, notes, intervalSeconds, confidence, offsetSeconds)
export async function createFlight(req, res, next) {
  const video = req.files?.video?.[0]
  const telemetryFile = req.files?.telemetry?.[0]
  let flightId = null
  try {
    const name = String(req.body?.name ?? '').trim()
    if (!name) return (await removeUploaded(req.files), res.status(400).json({ error: 'El nombre del vuelo es obligatorio.' }))
    if (!video) return (await removeUploaded(req.files), res.status(400).json({ error: 'Falta el video del vuelo.' }))
    if (!telemetryFile) {
      await removeUploaded(req.files)
      return res.status(400).json({ error: 'Falta el registro de vuelo (.srt, .gpx, .csv o .json) con las coordenadas GPS.' })
    }

    const interval = Math.min(Math.max(Number(req.body?.intervalSeconds) || 2, 0.5), 30)
    const confidence = Math.min(Math.max(Number(req.body?.confidence) || 0.5, 0.05), 0.95)
    const offset = Number(req.body?.offsetSeconds) || 0
    const droneModel = DRONE_MODELS.includes(req.body?.droneModel) ? req.body.droneModel : 'otro'

    // Se valida el registro ANTES de aceptar el vuelo: si no hay GPS, error inmediato.
    let samples
    try {
      samples = parseTelemetry(telemetryFile.originalname, await fs.readFile(telemetryFile.path, 'utf8'))
    } catch (error) {
      await removeUploaded(req.files)
      return res.status(400).json({ error: error.message })
    }

    const { rows } = await pool.query(
      `INSERT INTO flights (name, notes, drone_model, created_by, video_filename, telemetry_filename, telemetry_offset_s, frame_interval_s, confidence_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, req.body?.notes || null, droneModel, req.user.id, video.originalname, telemetryFile.originalname, offset, interval, confidence],
    )
    flightId = rows[0].id

    const dir = path.join(FLIGHTS_DIR, String(flightId))
    await fs.mkdir(dir, { recursive: true })
    await fs.rename(video.path, path.join(dir, `video${path.extname(video.originalname).toLowerCase() || '.mp4'}`))
    await fs.writeFile(path.join(dir, 'telemetry.json'), JSON.stringify(samples))
    await fs.rm(telemetryFile.path, { force: true })

    enqueueFlight(flightId)
    res.status(201).json({ flight: flightRow(rows[0]) })
  } catch (error) {
    await removeUploaded(req.files)
    if (flightId) await pool.query('DELETE FROM flights WHERE id = $1', [flightId]).catch(() => {})
    next(error)
  }
}

// GET /api/flights
export async function listFlights(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.full_name AS created_by_name FROM flights f LEFT JOIN users u ON u.id = f.created_by ORDER BY f.created_at DESC LIMIT 200`,
    )
    res.json({ flights: rows.map(flightRow) })
  } catch (error) {
    next(error)
  }
}

// GET /api/flights/:id  (vuelo + trazado + fotogramas + detecciones)
export async function getFlight(req, res, next) {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id no valido.' })

    const flight = (await pool.query(
      `SELECT f.*, u.full_name AS created_by_name FROM flights f LEFT JOIN users u ON u.id = f.created_by WHERE f.id = $1`,
      [id],
    )).rows[0]
    if (!flight) return res.status(404).json({ error: 'Vuelo no encontrado.' })

    const frames = (await pool.query(
      `SELECT id, idx, t_seconds, longitude, latitude, altitude_m, detections_count FROM flight_frames WHERE flight_id = $1 ORDER BY idx`,
      [id],
    )).rows
    const detections = (await pool.query(
      `SELECT id, longitude, latitude, confidence, sightings, review_status, classification_status, frame_id, bbox
         FROM detections WHERE flight_id = $1 ORDER BY confidence DESC`,
      [id],
    )).rows

    res.json({
      flight: flightRow(flight),
      telemetry: flight.telemetry ?? [],
      frames: frames.map((f) => ({
        id: f.id, idx: f.idx, t: f.t_seconds, lon: f.longitude, lat: f.latitude, alt: f.altitude_m, detections: f.detections_count,
      })),
      detections: detections.map((d) => ({
        id: d.id, lon: d.longitude, lat: d.latitude, confidence: d.confidence, sightings: d.sightings,
        reviewStatus: d.review_status, classificationStatus: d.classification_status, frameId: d.frame_id, bbox: d.bbox,
      })),
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/flights/:id/status  (ligero, para el sondeo de progreso)
export async function getFlightStatus(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT id, status, error_message, frames_total, frames_done, detections_count FROM flights WHERE id = $1',
      [Number(req.params.id)],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Vuelo no encontrado.' })
    const r = rows[0]
    res.json({ id: r.id, status: r.status, errorMessage: r.error_message, framesTotal: r.frames_total, framesDone: r.frames_done, detectionsCount: r.detections_count })
  } catch (error) {
    next(error)
  }
}

// GET /api/flights/:id/frames/:frameId/image
export async function getFrameImage(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT image_path FROM flight_frames WHERE id = $1 AND flight_id = $2', [
      Number(req.params.frameId),
      Number(req.params.id),
    ])
    if (!rows[0]) return res.status(404).json({ error: 'Fotograma no encontrado.' })
    const file = path.join(FLIGHTS_DIR, String(Number(req.params.id)), rows[0].image_path)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'La imagen ya no esta en disco.' })
    })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/flights/:id  (el piloto que lo subio, o admin). Las detecciones se conservan.
export async function deleteFlight(req, res, next) {
  try {
    const id = Number(req.params.id)
    const { rows } = await pool.query('SELECT created_by FROM flights WHERE id = $1', [id])
    if (!rows[0]) return res.status(404).json({ error: 'Vuelo no encontrado.' })
    if (req.user.role !== 'admin' && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Solo quien subio el vuelo (o un admin) puede borrarlo.' })
    }
    await pool.query('DELETE FROM flights WHERE id = $1', [id])
    await fs.rm(path.join(FLIGHTS_DIR, String(id)), { recursive: true, force: true })
    res.json({ status: 'deleted' })
  } catch (error) {
    next(error)
  }
}
