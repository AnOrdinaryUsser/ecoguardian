import { pool } from '../config/db.js'
import { estimateTileCount, polygonAreaM2, validPolygon } from '../services/geo.js'
import { MAX_CELLS_PER_AREA, startAreaRun } from '../services/areaScheduler.js'

const map = (a) => ({
  id: a.id,
  name: a.name,
  notes: a.notes,
  polygon: a.polygon,
  intervalDays: a.interval_days,
  zoom: a.zoom,
  confidenceThreshold: a.confidence_threshold,
  active: a.active,
  cellsEstimate: a.cells_estimate,
  areaKm2: a.polygon ? polygonAreaM2(a.polygon) / 1e6 : null,
  lastRunAt: a.last_run_at,
  nextRunAt: a.next_run_at,
  createdAt: a.created_at,
  createdByName: a.created_name ?? null,
  lastRun: a.run_id
    ? {
        id: a.run_id, status: a.run_status, trigger: a.run_trigger, cellsTotal: a.run_cells_total, cellsDone: a.run_cells_done,
        cellsFailed: a.run_cells_failed, newDetections: a.run_new, detectionsFound: a.run_found, error: a.run_error,
        startedAt: a.run_started, finishedAt: a.run_finished,
      }
    : null,
  detectionsTotal: a.detections_total ?? 0,
})

const SELECT = `
  SELECT a.*, u.full_name AS created_name,
         r.id AS run_id, r.status AS run_status, r.trigger AS run_trigger, r.cells_total AS run_cells_total, r.cells_done AS run_cells_done,
         r.cells_failed AS run_cells_failed, r.new_detections AS run_new, r.detections_found AS run_found, r.error_message AS run_error,
         r.started_at AS run_started, r.finished_at AS run_finished,
         (SELECT COUNT(*)::int FROM detections d WHERE d.monitored_area_id = a.id) AS detections_total
    FROM monitored_areas a
    LEFT JOIN users u ON u.id = a.created_by
    LEFT JOIN LATERAL (SELECT * FROM area_runs WHERE area_id = a.id ORDER BY started_at DESC, id DESC LIMIT 1) r ON TRUE`

async function loadArea(id) {
  const { rows } = await pool.query(`${SELECT} WHERE a.id = $1`, [id])
  return rows[0] ?? null
}

function clean(body, { partial = false } = {}) {
  const out = {}
  const errors = []
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim()
    if (!name) errors.push('El nombre es obligatorio.')
    out.name = name.slice(0, 120)
  }
  if (!partial || body.polygon !== undefined) {
    if (!validPolygon(body.polygon)) errors.push('Dibuja un área con al menos 3 puntos.')
    else out.polygon = body.polygon.map((p) => [Number(p[0]), Number(p[1])])
  }
  if (body.intervalDays !== undefined) {
    const n = Math.round(Number(body.intervalDays))
    if (!(n >= 1 && n <= 365)) errors.push('La frecuencia debe estar entre 1 y 365 días.')
    out.interval_days = n
  }
  if (body.zoom !== undefined) {
    const z = Math.round(Number(body.zoom))
    if (!(z >= 13 && z <= 19)) errors.push('Zoom no válido.')
    out.zoom = z
  }
  if (body.confidenceThreshold !== undefined) {
    const c = Number(body.confidenceThreshold)
    if (!(c >= 0.3 && c <= 0.95)) errors.push('La confianza debe estar entre 0,30 y 0,95.')
    out.confidence_threshold = c
  }
  if (body.active !== undefined) out.active = Boolean(body.active)
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes).slice(0, 500) : null
  return { out, errors }
}

// GET /api/areas
export async function listAreas(req, res, next) {
  try {
    const { rows } = await pool.query(`${SELECT} ORDER BY a.created_at DESC`)
    res.json({ areas: rows.map(map), maxCells: MAX_CELLS_PER_AREA })
  } catch (error) {
    next(error)
  }
}

// POST /api/areas  { name, polygon, intervalDays, zoom, confidenceThreshold, runNow }
export async function createArea(req, res, next) {
  try {
    const { out, errors } = clean(req.body ?? {})
    if (errors.length) return res.status(400).json({ error: errors[0] })
    const zoom = out.zoom ?? 18
    const cells = estimateTileCount(out.polygon, zoom)
    if (cells > MAX_CELLS_PER_AREA) {
      return res.status(400).json({ error: `El área ocupa unas ${cells} celdas (máximo ${MAX_CELLS_PER_AREA}). Dibuja una zona más pequeña.` })
    }
    const interval = out.interval_days ?? 30
    const { rows } = await pool.query(
      `INSERT INTO monitored_areas (name, notes, polygon, interval_days, zoom, confidence_threshold, cells_estimate, next_run_at, created_by)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7, now() + make_interval(days => $4::int), $8) RETURNING id`,
      [out.name, out.notes ?? null, JSON.stringify(out.polygon), interval, zoom, out.confidence_threshold ?? 0.5, cells, req.user.id],
    )
    if (req.body?.runNow) await startAreaRun(rows[0].id, { trigger: 'manual', userId: req.user.id })
    res.status(201).json({ area: map(await loadArea(rows[0].id)) })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/areas/:id
export async function updateArea(req, res, next) {
  try {
    const id = Number(req.params.id)
    const current = await loadArea(id)
    if (!current) return res.status(404).json({ error: 'Área no encontrada.' })
    const { out, errors } = clean(req.body ?? {}, { partial: true })
    if (errors.length) return res.status(400).json({ error: errors[0] })

    if (out.polygon || out.zoom) {
      const cells = estimateTileCount(out.polygon ?? current.polygon, out.zoom ?? current.zoom)
      if (cells > MAX_CELLS_PER_AREA) return res.status(400).json({ error: `El área ocupa unas ${cells} celdas (máximo ${MAX_CELLS_PER_AREA}).` })
      out.cells_estimate = cells
    }
    const sets = []
    const params = []
    for (const [column, value] of Object.entries(out)) {
      params.push(column === 'polygon' ? JSON.stringify(value) : value)
      sets.push(`${column} = $${params.length}${column === 'polygon' ? '::jsonb' : ''}`)
    }
    if (out.interval_days || out.active === true) {
      // Reprograma desde la ultima ejecucion (o desde ahora si nunca se analizo / estaba en pausa).
      params.push(out.interval_days ?? current.interval_days)
      sets.push(`next_run_at = COALESCE(last_run_at, now()) + make_interval(days => $${params.length}::int)`)
    }
    if (sets.length) {
      params.push(id)
      await pool.query(`UPDATE monitored_areas SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
    }
    res.json({ area: map(await loadArea(id)) })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/areas/:id  (las detecciones ya guardadas se conservan)
export async function deleteArea(req, res, next) {
  try {
    await pool.query('DELETE FROM monitored_areas WHERE id = $1', [Number(req.params.id)])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}

// POST /api/areas/:id/run
export async function runArea(req, res, next) {
  try {
    const id = Number(req.params.id)
    if (!(await loadArea(id))) return res.status(404).json({ error: 'Área no encontrada.' })
    const { alreadyRunning, run } = await startAreaRun(id, { trigger: 'manual', userId: req.user.id })
    if (alreadyRunning) return res.status(409).json({ error: 'Esta área ya se está analizando.' })
    res.status(202).json({ area: map(await loadArea(id)), run: { id: run.id } })
  } catch (error) {
    next(error)
  }
}

// GET /api/areas/:id/runs
export async function listRuns(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM area_runs WHERE area_id = $1 ORDER BY started_at DESC, id DESC LIMIT 20', [Number(req.params.id)])
    res.json({
      runs: rows.map((r) => ({
        id: r.id, status: r.status, trigger: r.trigger, cellsTotal: r.cells_total, cellsDone: r.cells_done, cellsFailed: r.cells_failed,
        detectionsFound: r.detections_found, newDetections: r.new_detections, error: r.error_message, startedAt: r.started_at, finishedAt: r.finished_at,
      })),
    })
  } catch (error) {
    next(error)
  }
}
