import { pool } from '../config/db.js'
import { sendTestAlert } from '../services/notifications.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const map = (r) => ({ id: r.id, name: r.name, email: r.email, organization: r.organization, active: r.active, createdAt: r.created_at })

// GET /api/alerts/recipients
export async function listRecipients(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM alert_recipients ORDER BY name')
    res.json({ recipients: rows.map(map) })
  } catch (error) {
    next(error)
  }
}

// POST /api/alerts/recipients  { name, email, organization? }
export async function createRecipient(req, res, next) {
  try {
    const name = String(req.body?.name ?? '').trim()
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio.' })
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo no válido.' })
    const { rows } = await pool.query(
      'INSERT INTO alert_recipients (name, email, organization) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING *',
      [name.slice(0, 120), email, req.body?.organization || null],
    )
    if (!rows[0]) return res.status(409).json({ error: 'Ese correo ya está en la lista.' })
    res.status(201).json({ recipient: map(rows[0]) })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/alerts/recipients/:id  { name?, organization?, active? }
export async function updateRecipient(req, res, next) {
  try {
    const b = req.body ?? {}
    const { rows } = await pool.query(
      `UPDATE alert_recipients SET name = COALESCE($2, name), organization = COALESCE($3, organization), active = COALESCE($4, active)
        WHERE id = $1 RETURNING *`,
      [Number(req.params.id), b.name ? String(b.name).trim() : null, b.organization ?? null, typeof b.active === 'boolean' ? b.active : null],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Destinatario no encontrado.' })
    res.json({ recipient: map(rows[0]) })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/alerts/recipients/:id
export async function deleteRecipient(req, res, next) {
  try {
    await pool.query('DELETE FROM alert_recipients WHERE id = $1', [Number(req.params.id)])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}

// GET /api/alerts/log  (ultimos 100 envios)
export async function listLog(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM notification_log ORDER BY created_at DESC, id DESC LIMIT 100')
    res.json({
      smtpConfigured: Boolean(process.env.SMTP_HOST),
      log: rows.map((r) => ({
        id: r.id, kind: r.kind, email: r.recipient_email, subject: r.subject, status: r.status,
        incidentId: r.incident_id, areaId: r.area_id, detectionId: r.detection_id, createdAt: r.created_at,
      })),
    })
  } catch (error) {
    next(error)
  }
}

// POST /api/alerts/test  { email }
export async function testAlert(req, res, next) {
  try {
    const email = String(req.body?.email ?? '').trim()
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo no válido.' })
    res.json(await sendTestAlert(email))
  } catch (error) {
    next(error)
  }
}
