import { pool } from '../config/db.js'
import { planRoute } from '../services/routePlanner.js'
import { exportRoute } from '../services/routeExports.js'
import { DRONE_PROFILES, squareAround, validPolygon } from '../services/geo.js'

const map = (r) => ({
  id: r.id, name: r.name, polygon: r.polygon, params: r.params, waypoints: r.waypoints, stats: r.stats,
  createdAt: r.created_at, createdByName: r.created_name ?? null,
})

// Resuelve el poligono: el dibujado, o un cuadrado alrededor de un punto (inspeccion de una detección).
function resolvePolygon(body) {
  if (body.center && Number.isFinite(Number(body.center.lng)) && Number.isFinite(Number(body.center.lat))) {
    const radius = Math.min(Math.max(Number(body.radiusM) || 60, 20), 500)
    return squareAround([Number(body.center.lng), Number(body.center.lat)], radius)
  }
  return body.polygon
}

// GET /api/flight-plans/profiles
export function profiles(req, res) {
  res.json({ profiles: Object.entries(DRONE_PROFILES).map(([id, p]) => ({ id, ...p })) })
}

// POST /api/flight-plans/plan  { polygon | center+radiusM, altitude, hfov, sidelap, forwardOverlap, speed, heading, droneModel }
export function preview(req, res, next) {
  try {
    const polygon = resolvePolygon(req.body ?? {})
    const plan = planRoute({ ...req.body, polygon })
    res.json({ polygon, ...plan })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    next(error)
  }
}

// GET /api/flight-plans
export async function listPlans(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT p.*, u.full_name AS created_name FROM flight_plans p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.created_at DESC LIMIT 100',
    )
    res.json({ plans: rows.map(map) })
  } catch (error) {
    next(error)
  }
}

// POST /api/flight-plans  (guarda un plan; se recalcula en el servidor para no fiarse de lo que envie el cliente)
export async function savePlan(req, res, next) {
  try {
    const name = String(req.body?.name ?? '').trim()
    if (!name) return res.status(400).json({ error: 'Ponle un nombre al plan.' })
    const polygon = resolvePolygon(req.body ?? {})
    const plan = planRoute({ ...req.body, polygon })
    const { rows } = await pool.query(
      'INSERT INTO flight_plans (name, polygon, params, waypoints, stats, created_by) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6) RETURNING *',
      [name.slice(0, 120), JSON.stringify(polygon), JSON.stringify(plan.params), JSON.stringify(plan.waypoints), JSON.stringify(plan.stats), req.user.id],
    )
    res.status(201).json({ plan: map(rows[0]) })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    next(error)
  }
}

// DELETE /api/flight-plans/:id
export async function deletePlan(req, res, next) {
  try {
    await pool.query('DELETE FROM flight_plans WHERE id = $1', [Number(req.params.id)])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}

// POST /api/flight-plans/export  { format: kmz|gpx|litchi|geojson, name, + los mismos parametros que /plan }  → fichero
// También acepta { planId, format } para un plan guardado.
export async function exportPlan(req, res, next) {
  try {
    const format = String(req.body?.format ?? '')
    let plan
    if (req.body?.planId) {
      const { rows } = await pool.query('SELECT * FROM flight_plans WHERE id = $1', [Number(req.body.planId)])
      if (!rows[0]) return res.status(404).json({ error: 'Plan no encontrado.' })
      plan = { name: rows[0].name, polygon: rows[0].polygon, params: rows[0].params, waypoints: rows[0].waypoints, stats: rows[0].stats }
    } else {
      const polygon = resolvePolygon(req.body ?? {})
      if (!validPolygon(polygon)) return res.status(400).json({ error: 'Área no válida.' })
      plan = { name: String(req.body?.name || 'ruta-ecoguardian'), polygon, ...planRoute({ ...req.body, polygon }) }
    }
    const file = await exportRoute(format, plan)
    if (!file) return res.status(400).json({ error: 'Formato no válido (kmz, gpx, litchi o geojson).' })
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
    res.send(file.body)
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    next(error)
  }
}
