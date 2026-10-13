import fs from 'node:fs/promises'
import path from 'node:path'
import { pool } from '../config/db.js'
import { FLIGHTS_DIR } from '../config/paths.js'
import { ZipWriter, crc32 } from '../services/zip.js'

const MAX_IMAGES = Number(process.env.DATASET_MAX_IMAGES) || 5000

// Agrupa las detecciones revisadas por imagen (una celda o un fotograma pueden tener varias cajas).
//  - Imagen con alguna caja confirmada  -> ejemplo positivo (etiquetas YOLO de las confirmadas).
//  - Imagen solo con cajas descartadas  -> ejemplo negativo (etiqueta vacia: "aqui no hay vertedero").
//  - Imagen con alguna deteccion aun pendiente -> se omite (las etiquetas estarian incompletas).
async function buildPlan({ source, includeNegatives }) {
  const params = []
  let sourceSql = ''
  if (['satellite', 'drone'].includes(source)) {
    params.push(source)
    sourceSql = `AND d.source_type = $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT d.id, d.confidence, d.latitude, d.longitude, d.review_status, d.review_note, d.reviewed_at, d.source_type, d.bbox,
            d.cell_image_id, d.flight_id, d.frame_id, ff.image_path, u.full_name AS reviewer
       FROM detections d
       LEFT JOIN flight_frames ff ON ff.id = d.frame_id
       LEFT JOIN users u ON u.id = d.reviewed_by
      WHERE d.bbox IS NOT NULL AND (d.cell_image_id IS NOT NULL OR d.frame_id IS NOT NULL) ${sourceSql}
      ORDER BY d.id`,
    params,
  )
  const groups = new Map()
  for (const r of rows) {
    if (!Array.isArray(r.bbox) || r.bbox.length !== 4) continue
    const key = r.cell_image_id ? `cell-${r.cell_image_id}` : `frame-${r.frame_id}`
    if (!groups.has(key)) groups.set(key, { key, cellImageId: r.cell_image_id, flightId: r.flight_id, imagePath: r.image_path, source: r.source_type, detections: [] })
    groups.get(key).detections.push(r)
  }
  const images = []
  let skippedPending = 0
  for (const g of groups.values()) {
    if (g.detections.some((d) => d.review_status === 'pending')) {
      skippedPending += 1
      continue
    }
    const positives = g.detections.filter((d) => d.review_status === 'confirmed')
    if (positives.length === 0 && !includeNegatives) continue
    images.push({ ...g, positives })
  }
  return { images, skippedPending }
}

function summarize(plan) {
  const positives = plan.images.filter((i) => i.positives.length > 0)
  return {
    images: plan.images.length,
    positiveImages: positives.length,
    negativeImages: plan.images.length - positives.length,
    boxes: positives.reduce((n, i) => n + i.positives.length, 0),
    skippedPending: plan.skippedPending,
    truncated: plan.images.length > MAX_IMAGES,
  }
}

const options = (q) => ({ source: q.source, includeNegatives: q.negatives !== '0' })

// GET /api/review/export/summary?source=&negatives=0|1
export async function datasetSummary(req, res, next) {
  try {
    res.json(summarize(await buildPlan(options(req.query))))
  } catch (error) {
    next(error)
  }
}

async function imageBytes(image) {
  if (image.cellImageId) {
    const { rows } = await pool.query('SELECT image_data FROM analysis_images WHERE id = $1', [image.cellImageId])
    return rows[0]?.image_data ?? null
  }
  if (image.imagePath && image.flightId) {
    try {
      return await fs.readFile(path.join(FLIGHTS_DIR, String(image.flightId), image.imagePath))
    } catch {
      return null
    }
  }
  return null
}

const yoloLine = ([x1, y1, x2, y2]) => {
  const c = (v) => Math.min(Math.max(v, 0), 1)
  const [a, b, d, e] = [c(x1), c(y1), c(x2), c(y2)]
  return `0 ${((a + d) / 2).toFixed(6)} ${((b + e) / 2).toFixed(6)} ${(d - a).toFixed(6)} ${(e - b).toFixed(6)}`
}

// GET /api/review/export?source=&negatives=0|1&valPercent=20  → ZIP en formato YOLO
export async function exportDataset(req, res, next) {
  try {
    const plan = await buildPlan(options(req.query))
    if (plan.images.length === 0) return res.status(404).json({ error: 'Aún no hay detecciones revisadas que exportar.' })
    const valPercent = Math.min(Math.max(Number(req.query.valPercent) || 20, 0), 50)
    const images = plan.images.slice(0, MAX_IMAGES)

    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="ecoguardian-dataset-${stamp}.zip"`)

    const zip = new ZipWriter(
      (chunk) => (res.write(chunk) ? undefined : new Promise((resolve) => res.once('drain', resolve))),
    )
    const meta = ['image,detection_id,review_status,confidence,latitude,longitude,source,reviewer,reviewed_at,note']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    let written = 0

    for (const image of images) {
      const bytes = await imageBytes(image)
      if (!bytes) continue
      const split = crc32(Buffer.from(image.key)) % 100 < valPercent ? 'val' : 'train'
      const name = `${image.source}_${image.key}`
      await zip.addFile(`images/${split}/${name}.jpg`, bytes)
      await zip.addFile(`labels/${split}/${name}.txt`, image.positives.map((d) => yoloLine(d.bbox)).join('\n') + (image.positives.length ? '\n' : ''))
      for (const d of image.detections) {
        meta.push([`${name}.jpg`, d.id, d.review_status, d.confidence.toFixed(3), d.latitude, d.longitude, d.source_type, esc(d.reviewer), d.reviewed_at?.toISOString?.() ?? '', esc(d.review_note)].join(','))
      }
      written += 1
    }

    await zip.addFile('data.yaml', `# Dataset exportado de EcoGuardian (${stamp}) - formato Ultralytics YOLO\npath: .\ntrain: images/train\nval: images/val\nnames:\n  0: dump_site\n`)
    await zip.addFile('metadata.csv', meta.join('\n') + '\n')
    await zip.addFile(
      'LEEME.txt',
      `Dataset de EcoGuardian generado el ${stamp}.\n\n` +
        `- Imágenes con vertedero confirmado: etiquetas YOLO (clase 0 = dump_site).\n` +
        `- Imágenes donde solo se descartaron detecciones: fichero de etiquetas vacío (ejemplos negativos).\n` +
        `- Se omiten las imágenes con detecciones todavía pendientes de revisar.\n` +
        `- Las imágenes satelitales son las celdas de Mapbox analizadas; las de dron, los fotogramas extraídos del vídeo.\n` +
        `- Comprueba las condiciones de uso de Mapbox antes de redistribuir las imágenes.\n\n` +
        `Imágenes exportadas: ${written}\n`,
    )
    await zip.finish()
    res.end()
  } catch (error) {
    if (res.headersSent) return res.destroy(error)
    next(error)
  }
}
