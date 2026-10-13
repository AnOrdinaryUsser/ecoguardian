import { pool } from '../config/db.js'
import { analyzeAndStoreCell } from './analysisService.js'
import { notifyAreaRun } from './notifications.js'
import { tilesForPolygon } from './geo.js'

export const MAX_CELLS_PER_AREA = Number(process.env.AREA_MAX_CELLS) || 400
const CONCURRENCY = Number(process.env.AREA_CONCURRENCY) || 2
const CHECK_EVERY_MS = (Number(process.env.AREA_SCHEDULER_INTERVAL_SECONDS) || 300) * 1000

// Cola en memoria: un analisis de area a la vez (el modelo ya es el cuello de botella).
const queue = []
let draining = false

// Crea la ejecucion y la encola. Devuelve la fila de area_runs.
export async function startAreaRun(areaId, { trigger = 'manual', userId = null } = {}) {
  const running = await pool.query("SELECT id FROM area_runs WHERE area_id = $1 AND status = 'running'", [areaId])
  if (running.rows[0]) return { alreadyRunning: true, run: running.rows[0] }
  const { rows } = await pool.query(
    "INSERT INTO area_runs (area_id, trigger, started_by) VALUES ($1, $2, $3) RETURNING *",
    [areaId, trigger, userId],
  )
  queue.push(rows[0].id)
  drain()
  return { alreadyRunning: false, run: rows[0] }
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (queue.length) await executeRun(queue.shift())
  } finally {
    draining = false
  }
}

async function executeRun(runId) {
  const { rows: runRows } = await pool.query('SELECT * FROM area_runs WHERE id = $1', [runId])
  const run = runRows[0]
  if (!run) return
  const { rows: areaRows } = await pool.query('SELECT * FROM monitored_areas WHERE id = $1', [run.area_id])
  const area = areaRows[0]
  if (!area) return

  try {
    const tiles = tilesForPolygon(area.polygon, area.zoom)
    if (tiles.length === 0) throw new Error('El área no contiene ninguna celda.')
    if (tiles.length > MAX_CELLS_PER_AREA) throw new Error(`El área tiene ${tiles.length} celdas (máximo ${MAX_CELLS_PER_AREA}). Redúcela o divídela.`)
    await pool.query('UPDATE area_runs SET cells_total = $2 WHERE id = $1', [runId, tiles.length])

    let done = 0
    let failed = 0
    let found = 0
    const created = []
    let lastError = null
    let cursor = 0

    async function worker() {
      while (cursor < tiles.length) {
        const tile = tiles[cursor]
        cursor += 1
        try {
          const result = await analyzeAndStoreCell({
            bounds: { north: tile.north, south: tile.south, east: tile.east, west: tile.west },
            confidenceThreshold: area.confidence_threshold,
            userId: run.started_by ?? area.created_by,
            areaId: area.id,
            dedupe: true,
          })
          found += result.detections.length + result.skippedExisting
          created.push(...result.detections)
        } catch (error) {
          failed += 1
          lastError = error?.response?.data?.detail || error.message
        }
        done += 1
        await pool.query('UPDATE area_runs SET cells_done = $2, cells_failed = $3, detections_found = $4, new_detections = $5 WHERE id = $1', [
          runId, done, failed, found, created.length,
        ])
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, worker))

    const allFailed = failed === tiles.length
    await pool.query(
      `UPDATE area_runs SET status = $2, error_message = $3, finished_at = now() WHERE id = $1`,
      [runId, allFailed ? 'error' : 'done', failed ? `${failed} celda(s) fallaron${lastError ? `: ${String(lastError).slice(0, 200)}` : ''}` : null],
    )
    // Solo vale la pena avisar de lo que no coincide con un vertedero legal conocido.
    const toAlert = created.filter((d) => d.classification?.status !== 'legal_probable')
    await pool.query(
      `UPDATE monitored_areas SET last_run_at = now(), next_run_at = now() + make_interval(days => interval_days) WHERE id = $1`,
      [area.id],
    )
    if (toAlert.length) {
      const detail = await pool.query('SELECT id, latitude, longitude, confidence, area_m2 FROM detections WHERE id = ANY($1::int[])', [toAlert.map((d) => d.id)])
      await notifyAreaRun({ area, run, newDetections: detail.rows })
    }
  } catch (error) {
    console.error(`[areas] analisis ${runId} del area ${area.id} fallo:`, error.message)
    await pool.query("UPDATE area_runs SET status = 'error', error_message = $2, finished_at = now() WHERE id = $1", [runId, String(error.message).slice(0, 400)])
    // Aunque falle, se reprograma para no reintentar en bucle.
    await pool.query(`UPDATE monitored_areas SET next_run_at = now() + make_interval(days => interval_days) WHERE id = $1`, [area.id])
  }
}

async function checkDue() {
  try {
    const { rows } = await pool.query(
      `SELECT a.id FROM monitored_areas a
        WHERE a.active AND a.next_run_at IS NOT NULL AND a.next_run_at <= now()
          AND NOT EXISTS (SELECT 1 FROM area_runs r WHERE r.area_id = a.id AND r.status = 'running')
        ORDER BY a.next_run_at LIMIT 5`,
    )
    for (const r of rows) await startAreaRun(r.id, { trigger: 'scheduled' })
  } catch (error) {
    console.error('[areas] error comprobando analisis programados:', error.message)
  }
}

// Al arrancar: los analisis que se quedaron a medias se marcan como error, y se programa la comprobacion periodica.
export async function startAreaScheduler() {
  await pool.query(
    "UPDATE area_runs SET status = 'error', error_message = 'Interrumpido por un reinicio del backend.', finished_at = now() WHERE status = 'running'",
  )
  if (String(process.env.AREA_SCHEDULER).toLowerCase() === 'off') {
    console.log('[areas] Planificador de áreas desactivado (AREA_SCHEDULER=off).')
    return
  }
  setTimeout(checkDue, 15_000)
  setInterval(checkDue, CHECK_EVERY_MS).unref?.()
  console.log(`[areas] Planificador activo: se comprueba cada ${CHECK_EVERY_MS / 1000}s si hay áreas pendientes de analizar.`)
}
