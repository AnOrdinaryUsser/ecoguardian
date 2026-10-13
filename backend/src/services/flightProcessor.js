import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pool } from '../config/db.js'
import { FLIGHTS_DIR } from '../config/paths.js'
import { predictFrame } from './modelClient.js'
import { getNearestLegalFacility } from './legalFacilityService.js'
import { classifyDetection } from './classificationService.js'
import { downsample, interpolateAt } from './telemetryParsers.js'
import { boxAreaOnDroneFrame } from './geo.js'

// ffmpeg: FFMPEG_PATH, o el binario que trae el paquete ffmpeg-static, o el del PATH.
let bundled = null
try {
  bundled = createRequire(import.meta.url)('ffmpeg-static')
} catch {
  // opcional
}
const FFMPEG = process.env.FFMPEG_PATH || bundled || 'ffmpeg'
const KEEP_VIDEO = ['1', 'true', 'yes'].includes(String(process.env.KEEP_FLIGHT_VIDEO).toLowerCase())
// Dos avistamientos del mismo vuelo a menos de esta distancia (m) son el mismo vertedero.
const MERGE_DISTANCE_M = Number(process.env.FLIGHT_MERGE_DISTANCE_METERS) || 30

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => reject(new Error(`No se pudo ejecutar ffmpeg (${FFMPEG}): ${error.message}`)))
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg fallo (${code}): ${stderr.slice(-400)}`))))
  })
}

// ffmpeg -i sin salida termina con error pero imprime la duracion en stderr.
function probeDuration(video) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-i', video], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null)
    })
  })
}

async function recordDroneDetection({ flightId, frame, position, detection, userId, modelVersion, droneModel }) {
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography'
  const nearby = await pool.query(
    `SELECT id, confidence FROM detections
      WHERE flight_id = $3 AND ST_DWithin(geom::geography, ${point}, $4)
      ORDER BY geom::geography <-> ${point} LIMIT 1`,
    [position.lon, position.lat, flightId, MERGE_DISTANCE_M],
  )

  const bbox = JSON.stringify(detection.box_normalized ?? null)
  // Tamano estimado asumiendo camara cenital y la altura de ese instante (orientativo).
  const areaM2 = boxAreaOnDroneFrame(detection.box_normalized, position.alt, droneModel)
  const crop = detection.crop_base64 ? Buffer.from(detection.crop_base64, 'base64') : null

  if (nearby.rows[0]) {
    const existing = nearby.rows[0]
    if (detection.confidence > existing.confidence) {
      await pool.query(
        `UPDATE detections SET sightings = sightings + 1, confidence = $2, frame_id = $3, bbox = $4::jsonb, area_m2 = COALESCE($5, area_m2) WHERE id = $1`,
        [existing.id, detection.confidence, frame.id, bbox, areaM2],
      )
      if (crop) {
        await pool.query(
          `INSERT INTO detection_images (detection_id, image_data) VALUES ($1, $2)
           ON CONFLICT (detection_id) DO UPDATE SET image_data = EXCLUDED.image_data`,
          [existing.id, crop],
        )
      }
    } else {
      await pool.query('UPDATE detections SET sightings = sightings + 1 WHERE id = $1', [existing.id])
    }
    return false
  }

  const nearestLegalFacility = await getNearestLegalFacility({ longitude: position.lon, latitude: position.lat })
  const classification = classifyDetection({ nearestLegalFacility })
  const inserted = await pool.query(
    `INSERT INTO detections
       (longitude, latitude, confidence, class_name, classification_status, nearest_legal_name, nearest_legal_distance_m,
        image_source, source_type, position_accuracy, flight_id, frame_id, bbox, model_version, created_by, area_m2, geom)
     VALUES ($1, $2, $3, 'dump_site', $4, $5, $6, 'drone', 'drone', 'drone_position', $7, $8, $9::jsonb, $10, $11, $12,
             ST_SetSRID(ST_MakePoint($1, $2), 4326))
     RETURNING id`,
    [
      position.lon,
      position.lat,
      detection.confidence,
      classification.status,
      nearestLegalFacility?.name ?? null,
      nearestLegalFacility?.distance_meters ?? null,
      flightId,
      frame.id,
      bbox,
      modelVersion ?? null,
      userId,
      areaM2,
    ],
  )
  if (crop) {
    await pool.query('INSERT INTO detection_images (detection_id, image_data) VALUES ($1, $2)', [inserted.rows[0].id, crop])
  }
  return true
}

async function processFlight(flightId) {
  const { rows } = await pool.query('SELECT * FROM flights WHERE id = $1', [flightId])
  const flight = rows[0]
  if (!flight) return

  const dir = path.join(FLIGHTS_DIR, String(flightId))
  const framesDir = path.join(dir, 'frames')
  try {
    await pool.query("UPDATE flights SET status = 'processing', error_message = NULL WHERE id = $1", [flightId])

    const files = await fs.readdir(dir)
    const videoFile = files.find((f) => f.startsWith('video.'))
    if (!videoFile) throw new Error('No se encuentra el video del vuelo.')
    const video = path.join(dir, videoFile)
    const samples = JSON.parse(await fs.readFile(path.join(dir, 'telemetry.json'), 'utf8'))

    const duration = await probeDuration(video)
    await pool.query('UPDATE flights SET video_duration_s = $2 WHERE id = $1', [flightId, duration])

    // 1) Fotogramas: uno cada N segundos, ancho maximo 1920.
    await fs.rm(framesDir, { recursive: true, force: true })
    await fs.mkdir(framesDir, { recursive: true })
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', video,
      '-vf', `fps=1/${flight.frame_interval_s},scale='min(1920,iw)':-2`,
      '-q:v', '3',
      path.join(framesDir, 'frame_%05d.jpg'),
    ])
    const frameFiles = (await fs.readdir(framesDir)).filter((f) => f.endsWith('.jpg')).sort()
    if (frameFiles.length === 0) throw new Error('ffmpeg no extrajo ningun fotograma (¿video corrupto?).')
    await pool.query('UPDATE flights SET frames_total = $2, frames_done = 0, detections_count = 0 WHERE id = $1', [flightId, frameFiles.length])
    await pool.query('DELETE FROM flight_frames WHERE flight_id = $1', [flightId])

    // 2) Cada fotograma: posicion (interpolando el registro) + modelo.
    let detectionsCount = 0
    let modelVersion = null
    for (let i = 0; i < frameFiles.length; i += 1) {
      const t = i * flight.frame_interval_s
      const position = interpolateAt(samples, t + flight.telemetry_offset_s, Math.max(2, flight.frame_interval_s))
      const imagePath = path.join(framesDir, frameFiles[i])

      const frameInsert = await pool.query(
        `INSERT INTO flight_frames (flight_id, idx, t_seconds, longitude, latitude, altitude_m, image_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [flightId, i, t, position?.lon ?? null, position?.lat ?? null, position?.alt ?? null, path.relative(dir, imagePath)],
      )
      const frame = { id: frameInsert.rows[0].id }

      // Sin posicion GPS no se puede ubicar nada: el fotograma se guarda pero no se analiza.
      if (position) {
        const imageBase64 = (await fs.readFile(imagePath)).toString('base64')
        const prediction = await predictFrame({ imageBase64, confidenceThreshold: flight.confidence_threshold })
        modelVersion = prediction.model_version ?? modelVersion
        let frameDetections = 0
        for (const detection of prediction.detections ?? []) {
          frameDetections += 1
          const isNew = await recordDroneDetection({
            flightId, frame, position, detection, userId: flight.created_by, modelVersion, droneModel: flight.drone_model,
          })
          if (isNew) detectionsCount += 1
        }
        if (frameDetections > 0) {
          await pool.query('UPDATE flight_frames SET detections_count = $2 WHERE id = $1', [frame.id, frameDetections])
        }
      }

      await pool.query('UPDATE flights SET frames_done = $2, detections_count = $3 WHERE id = $1', [flightId, i + 1, detectionsCount])
    }

    // 3) Trazado del vuelo.
    const track = downsample(samples)
    const wkt = `LINESTRING(${track.map((p) => `${p.lon} ${p.lat}`).join(', ')})`
    await pool.query(
      `UPDATE flights SET status = 'done', finished_at = now(), telemetry = $2::jsonb, track = ST_SetSRID(ST_GeomFromText($3), 4326)
        WHERE id = $1`,
      [flightId, JSON.stringify(track.map((p) => ({ t: Number(p.t.toFixed(2)), lat: p.lat, lon: p.lon, alt: p.alt }))), wkt],
    )
    if (!KEEP_VIDEO) await fs.rm(video, { force: true })
  } catch (error) {
    console.error(`[flights] vuelo ${flightId} fallo:`, error)
    await pool.query("UPDATE flights SET status = 'error', error_message = $2, finished_at = now() WHERE id = $1", [flightId, String(error.message).slice(0, 500)])
  }
}

// Cola en memoria: un vuelo a la vez.
const queue = []
let running = false

export function enqueueFlight(flightId) {
  queue.push(flightId)
  drain()
}

async function drain() {
  if (running) return
  running = true
  while (queue.length) {
    await processFlight(queue.shift())
  }
  running = false
}

// Al arrancar: los vuelos que se quedaron a medias (el backend se reinicio) se marcan como error.
export async function recoverInterruptedFlights() {
  await pool.query(
    "UPDATE flights SET status = 'error', error_message = 'Interrumpido por un reinicio del backend. Borra el vuelo y vuelve a subirlo.' WHERE status IN ('uploaded', 'processing')",
  )
}
