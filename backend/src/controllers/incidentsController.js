import { pool } from '../config/db.js'
import { addIncidentEvent } from '../services/incidentService.js'
import { sendIncidentReport } from '../services/notifications.js'
import { priorityFromArea, sizeClass } from '../services/geo.js'

const STATUSES = ['open', 'notified', 'in_progress', 'resolved', 'dismissed']
const PRIORITIES = ['low', 'medium', 'high']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SELECT = `
  SELECT i.*, au.full_name AS assigned_name, cu.full_name AS created_name,
         d.confidence, d.classification_status, d.nearest_legal_name, d.nearest_legal_distance_m,
         d.source_type, d.bbox, d.cell_image_id, d.flight_id, d.frame_id,
         (di.detection_id IS NOT NULL) AS has_image
    FROM incidents i
    LEFT JOIN users au ON au.id = i.assigned_to
    LEFT JOIN users cu ON cu.id = i.created_by
    LEFT JOIN detections d ON d.id = i.detection_id
    LEFT JOIN detection_images di ON di.detection_id = i.detection_id`

function row(r) {
  return {
    id: r.id,
    detectionId: r.detection_id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assignedTo: r.assigned_to,
    assignedName: r.assigned_name,
    authorityName: r.authority_name,
    authorityEmail: r.authority_email,
    plannedCleanupDate: r.planned_cleanup_date ? new Date(r.planned_cleanup_date).toISOString().slice(0, 10) : null,
    resolvedAt: r.resolved_at,
    latitude: r.latitude,
    longitude: r.longitude,
    areaM2: r.area_m2,
    sizeClass: sizeClass(r.area_m2),
    createdByName: r.created_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    confidence: r.confidence ?? null,
    classificationStatus: r.classification_status ?? null,
    nearestLegalName: r.nearest_legal_name ?? null,
    nearestLegalDistanceM: r.nearest_legal_distance_m ?? null,
    sourceType: r.source_type ?? null,
    flightId: r.flight_id ?? null,
    bbox: Array.isArray(r.bbox) ? r.bbox : null,
    hasImage: Boolean(r.has_image),
    cellImagePath: r.cell_image_id
      ? `/api/analysis-images/${r.cell_image_id}`
      : r.flight_id && r.frame_id
        ? `/api/flights/${r.flight_id}/frames/${r.frame_id}/image`
        : null,
  }
}

// GET /api/incidents?status=&priority=&assignedTo=&q=&active=1
export async function listIncidents(req, res, next) {
  try {
    const where = []
    const params = []
    const add = (sql, v) => {
      params.push(v)
      where.push(sql.replace('?', `$${params.length}`))
    }
    if (STATUSES.includes(req.query.status)) add('i.status = ?', req.query.status)
    else if (req.query.active === '1') where.push("i.status IN ('open','notified','in_progress')")
    if (PRIORITIES.includes(req.query.priority)) add('i.priority = ?', req.query.priority)
    if (Number.isInteger(Number(req.query.assignedTo)) && req.query.assignedTo) add('i.assigned_to = ?', Number(req.query.assignedTo))
    if (req.query.assignedTo === 'me') add('i.assigned_to = ?', req.user.id)
    if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 80)}%`); where.push(`(i.title ILIKE $${params.length} OR i.description ILIKE $${params.length})`) }
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `${SELECT} ${sql}
        ORDER BY (i.status IN ('resolved','dismissed')), CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.created_at DESC
        LIMIT 500`,
      params,
    )
    res.json({ incidents: rows.map(row) })
  } catch (error) {
    next(error)
  }
}

// GET /api/incidents/assignees  (usuarios que pueden ser responsables: gestores y admin)
export async function listAssignees(req, res, next) {
  try {
    const { rows } = await pool.query("SELECT id, full_name, role FROM users WHERE active AND role IN ('gestor','admin') ORDER BY full_name")
    res.json({ assignees: rows.map((u) => ({ id: u.id, fullName: u.full_name, role: u.role })) })
  } catch (error) {
    next(error)
  }
}

// GET /api/incidents/summary
export async function incidentsSummary(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(area_m2), 0) AS area FROM incidents GROUP BY status`,
    )
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]))
    let activeArea = 0
    for (const r of rows) {
      byStatus[r.status] = r.n
      if (['open', 'notified', 'in_progress'].includes(r.status)) activeArea += Number(r.area)
    }
    const overdue = await pool.query(
      "SELECT COUNT(*)::int AS n FROM incidents WHERE status IN ('open','notified','in_progress') AND planned_cleanup_date < CURRENT_DATE",
    )
    res.json({ byStatus, activeAreaM2: activeArea, overdue: overdue.rows[0].n })
  } catch (error) {
    next(error)
  }
}

async function loadIncident(id) {
  const { rows } = await pool.query(`${SELECT} WHERE i.id = $1`, [id])
  return rows[0] ?? null
}

// GET /api/incidents/:id  (con historial y avisos enviados)
export async function getIncident(req, res, next) {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id no valido.' })
    const incident = await loadIncident(id)
    if (!incident) return res.status(404).json({ error: 'Incidencia no encontrada.' })
    const events = await pool.query(
      `SELECT e.id, e.kind, e.message, e.created_at, u.full_name AS user_name
         FROM incident_events e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.incident_id = $1 ORDER BY e.created_at DESC, e.id DESC`,
      [id],
    )
    const notifications = await pool.query(
      'SELECT kind, recipient_email, status, created_at FROM notification_log WHERE incident_id = $1 ORDER BY created_at DESC LIMIT 30',
      [id],
    )
    res.json({
      incident: row(incident),
      events: events.rows.map((e) => ({ id: e.id, kind: e.kind, message: e.message, createdAt: e.created_at, userName: e.user_name })),
      notifications: notifications.rows.map((n) => ({ kind: n.kind, email: n.recipient_email, status: n.status, createdAt: n.created_at })),
    })
  } catch (error) {
    next(error)
  }
}

// POST /api/incidents  { detectionId } o { latitude, longitude, title }  (gestor/admin)
export async function createIncident(req, res, next) {
  try {
    const { detectionId, title, description } = req.body ?? {}
    let latitude = Number(req.body?.latitude)
    let longitude = Number(req.body?.longitude)
    let areaM2 = null
    let detId = null
    if (detectionId) {
      const det = await pool.query('SELECT id, latitude, longitude, area_m2 FROM detections WHERE id = $1', [Number(detectionId)])
      if (!det.rows[0]) return res.status(404).json({ error: 'Deteccion no encontrada.' })
      const dup = await pool.query('SELECT id FROM incidents WHERE detection_id = $1', [det.rows[0].id])
      if (dup.rows[0]) return res.status(409).json({ error: 'Esa detección ya tiene una incidencia.', incidentId: dup.rows[0].id })
      detId = det.rows[0].id
      latitude = det.rows[0].latitude
      longitude = det.rows[0].longitude
      areaM2 = det.rows[0].area_m2
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return res.status(400).json({ error: 'Indica una detección o unas coordenadas válidas.' })
    }
    const finalTitle = String(title ?? '').trim() || `Vertedero (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
    const { rows } = await pool.query(
      `INSERT INTO incidents (detection_id, title, description, priority, latitude, longitude, area_m2, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [detId, finalTitle.slice(0, 200), description || null, priorityFromArea(areaM2), latitude, longitude, areaM2, req.user.id],
    )
    await addIncidentEvent(rows[0].id, req.user.id, 'created', 'Incidencia creada manualmente')
    res.status(201).json({ incident: row(await loadIncident(rows[0].id)) })
  } catch (error) {
    next(error)
  }
}

const FIELD_LABELS = {
  title: 'título',
  description: 'descripción',
  priority: 'prioridad',
  assigned_to: 'responsable',
  authority_name: 'entidad responsable',
  authority_email: 'correo de la entidad',
  planned_cleanup_date: 'fecha prevista de limpieza',
}

// PATCH /api/incidents/:id  (gestor/admin)
export async function updateIncident(req, res, next) {
  try {
    const id = Number(req.params.id)
    const current = (await pool.query('SELECT * FROM incidents WHERE id = $1', [id])).rows[0]
    if (!current) return res.status(404).json({ error: 'Incidencia no encontrada.' })
    const b = req.body ?? {}
    const sets = []
    const params = []
    const events = []
    const set = (column, value) => {
      params.push(value)
      sets.push(`${column} = $${params.length}`)
    }

    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Estado no válido.' })
      if (b.status !== current.status) {
        set('status', b.status)
        set('resolved_at', b.status === 'resolved' ? new Date() : null)
        events.push(['status', `Estado: ${current.status} → ${b.status}`])
      }
    }
    if (b.priority !== undefined) {
      if (!PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Prioridad no válida.' })
      if (b.priority !== current.priority) {
        set('priority', b.priority)
        events.push(['edit', `Prioridad: ${current.priority} → ${b.priority}`])
      }
    }
    if (b.title !== undefined) {
      const title = String(b.title).trim()
      if (!title) return res.status(400).json({ error: 'El título no puede estar vacío.' })
      if (title !== current.title) (set('title', title.slice(0, 200)), events.push(['edit', 'Título editado']))
    }
    if (b.description !== undefined && (b.description || null) !== current.description) {
      set('description', b.description || null)
      events.push(['edit', 'Descripción editada'])
    }
    if (b.assignedTo !== undefined) {
      const assigned = b.assignedTo === null || b.assignedTo === '' ? null : Number(b.assignedTo)
      if (assigned !== null) {
        const u = await pool.query('SELECT full_name FROM users WHERE id = $1 AND active', [assigned])
        if (!u.rows[0]) return res.status(400).json({ error: 'Responsable no válido.' })
        if (assigned !== current.assigned_to) events.push(['assigned', `Asignada a ${u.rows[0].full_name}`])
      } else if (current.assigned_to !== null) events.push(['assigned', 'Sin responsable'])
      if (assigned !== current.assigned_to) set('assigned_to', assigned)
    }
    if (b.authorityName !== undefined && (b.authorityName || null) !== current.authority_name) {
      set('authority_name', b.authorityName || null)
      events.push(['edit', `Entidad responsable: ${b.authorityName || '—'}`])
    }
    if (b.authorityEmail !== undefined) {
      const email = String(b.authorityEmail || '').trim() || null
      if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo de la entidad no válido.' })
      if (email !== current.authority_email) (set('authority_email', email), events.push(['edit', `Correo de la entidad: ${email || '—'}`]))
    }
    if (b.plannedCleanupDate !== undefined) {
      const date = b.plannedCleanupDate || null
      if (date && Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Fecha no válida.' })
      const before = current.planned_cleanup_date ? new Date(current.planned_cleanup_date).toISOString().slice(0, 10) : null
      if (date !== before) (set('planned_cleanup_date', date), events.push(['edit', `Limpieza prevista: ${date || 'sin fecha'}`]))
    }

    if (sets.length) {
      params.push(id)
      await pool.query(`UPDATE incidents SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params)
      for (const [kind, message] of events) await addIncidentEvent(id, req.user.id, kind, message)
    }
    res.json({ incident: row(await loadIncident(id)) })
  } catch (error) {
    next(error)
  }
}

// POST /api/incidents/:id/events  { message }  (nota de seguimiento)
export async function addNote(req, res, next) {
  try {
    const id = Number(req.params.id)
    const message = String(req.body?.message ?? '').trim()
    if (!message) return res.status(400).json({ error: 'Escribe la nota.' })
    const exists = await pool.query('SELECT 1 FROM incidents WHERE id = $1', [id])
    if (!exists.rows[0]) return res.status(404).json({ error: 'Incidencia no encontrada.' })
    await addIncidentEvent(id, req.user.id, 'note', message.slice(0, 2000))
    await pool.query('UPDATE incidents SET updated_at = now() WHERE id = $1', [id])
    res.status(201).json({ ok: true })
  } catch (error) {
    next(error)
  }
}

// POST /api/incidents/:id/notify  { email?, name?, message? }  → informe a la entidad responsable
export async function notifyAuthority(req, res, next) {
  try {
    const id = Number(req.params.id)
    const row0 = await loadIncident(id)
    if (!row0) return res.status(404).json({ error: 'Incidencia no encontrada.' })
    const to = String(req.body?.email || row0.authority_email || '').trim()
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Indica el correo de la entidad responsable.' })
    const name = req.body?.name || row0.authority_name || null
    const detection = row0.detection_id ? (await pool.query('SELECT * FROM detections WHERE id = $1', [row0.detection_id])).rows[0] : null
    const result = await sendIncidentReport({ incident: row0, detection, to, name, message: req.body?.message || null })
    await addIncidentEvent(
      id,
      req.user.id,
      'notified',
      result.sent ? `Informe enviado a ${to}` : result.reason === 'smtp_not_configured' ? `Informe preparado para ${to} (SMTP sin configurar, no se envió)` : `No se pudo enviar el informe a ${to}`,
    )
    if (result.sent && row0.status === 'open') {
      await pool.query("UPDATE incidents SET status = 'notified', updated_at = now() WHERE id = $1", [id])
      await addIncidentEvent(id, req.user.id, 'status', 'Estado: open → notified')
    }
    if (!req.body?.email && !row0.authority_email) await pool.query('UPDATE incidents SET authority_email = $2 WHERE id = $1', [id, to])
    res.json({ sent: result.sent, reason: result.reason ?? null, incident: row(await loadIncident(id)) })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/incidents/:id  (solo admin)
export async function deleteIncident(req, res, next) {
  try {
    await pool.query('DELETE FROM incidents WHERE id = $1', [Number(req.params.id)])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}
