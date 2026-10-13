import { pool } from '../config/db.js'
import { notifyConfirmed } from './notifications.js'
import { priorityFromArea } from './geo.js'

export async function addIncidentEvent(incidentId, userId, kind, message = null, client = pool) {
  await client.query('INSERT INTO incident_events (incident_id, user_id, kind, message) VALUES ($1, $2, $3, $4)', [incidentId, userId ?? null, kind, message])
}

// Al confirmar una deteccion: crea (o reabre) su incidencia y avisa a los destinatarios de alertas.
export async function ensureIncidentForDetection(detectionId, user) {
  const { rows: det } = await pool.query('SELECT * FROM detections WHERE id = $1', [detectionId])
  const detection = det[0]
  if (!detection) return null

  const existing = await pool.query('SELECT * FROM incidents WHERE detection_id = $1', [detectionId])
  if (existing.rows[0]) {
    const incident = existing.rows[0]
    if (incident.status === 'dismissed') {
      const { rows } = await pool.query("UPDATE incidents SET status = 'open', updated_at = now() WHERE id = $1 RETURNING *", [incident.id])
      await addIncidentEvent(incident.id, user?.id, 'status', 'Reabierta al volver a confirmar la detección')
      return rows[0]
    }
    return incident
  }

  const lat = Number(detection.latitude)
  const lon = Number(detection.longitude)
  const title = `Vertedero ilegal probable (${lat.toFixed(4)}, ${lon.toFixed(4)})`
  const legal = detection.nearest_legal_name
    ? `Instalación legal más cercana: ${detection.nearest_legal_name} (${Math.round(detection.nearest_legal_distance_m)} m).`
    : 'No hay ninguna instalación legal registrada en las proximidades.'
  const { rows } = await pool.query(
    `INSERT INTO incidents (detection_id, title, description, priority, latitude, longitude, area_m2, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (detection_id) DO NOTHING
     RETURNING *`,
    [detectionId, title, legal, priorityFromArea(detection.area_m2), lat, lon, detection.area_m2, user?.id ?? null],
  )
  const incident = rows[0]
  if (!incident) return (await pool.query('SELECT * FROM incidents WHERE detection_id = $1', [detectionId])).rows[0]

  await addIncidentEvent(incident.id, user?.id, 'created', `Creada automáticamente al confirmar la detección #${detectionId}`)
  // Sin await: el correo no debe retrasar la respuesta de la revision.
  notifyConfirmed({ incident, detection }).then(async (results) => {
    if (results.length) await addIncidentEvent(incident.id, null, 'alert', `Alerta enviada a ${results.length} destinatario(s)`)
  })
  return incident
}

// Si se descarta una deteccion cuya incidencia sigue abierta (sin gestion), la incidencia se descarta tambien.
export async function dismissOpenIncident(detectionId, user, status) {
  const { rows } = await pool.query(
    `UPDATE incidents SET status = 'dismissed', updated_at = now()
      WHERE detection_id = $1 AND status = 'open' RETURNING id`,
    [detectionId],
  )
  if (rows[0]) await addIncidentEvent(rows[0].id, user?.id, 'status', status === 'rejected' ? 'Detección descartada en la revisión' : 'Detección devuelta a pendiente')
}
