import { pool } from '../config/db.js'
import { appUrl, escapeHtml, layout, sendMail } from './mailer.js'
import { sizeClass } from './geo.js'

// Alertas por correo (confirmacion de vertederos, nuevas detecciones de las areas
// monitorizadas e informes de incidencia). Cada envio queda en notification_log.
// Ninguna funcion lanza: un fallo de correo nunca debe romper la accion que lo origina.

const mapsLink = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`
const fmtArea = (m2) => (Number.isFinite(m2) ? (m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`) : 'sin estimar')
const SIZE_LABEL = { small: 'pequeño', medium: 'medio', large: 'grande' }

export async function activeRecipients() {
  const { rows } = await pool.query('SELECT id, name, email FROM alert_recipients WHERE active ORDER BY id')
  return rows
}

async function logMail({ kind, to, subject, result, detectionId = null, incidentId = null, areaId = null }) {
  const status = result.sent ? 'sent' : result.reason === 'smtp_not_configured' ? 'not_configured' : 'failed'
  await pool
    .query(
      'INSERT INTO notification_log (kind, recipient_email, subject, detection_id, incident_id, area_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [kind, to, subject, detectionId, incidentId, areaId, status],
    )
    .catch((error) => console.error('[notify] no se pudo registrar el envio:', error.message))
  return status
}

async function sendTo(recipients, { kind, subject, text, html, attachments, ctx }) {
  const results = []
  for (const r of recipients) {
    const result = await sendMail({ to: r.email, subject, text, html, attachments })
    results.push({ email: r.email, status: await logMail({ kind, to: r.email, subject, result, ...ctx }) })
  }
  return results
}

async function cropAttachment(detectionId) {
  if (!detectionId) return { attachments: undefined, imgHtml: '' }
  const { rows } = await pool.query('SELECT image_data FROM detection_images WHERE detection_id = $1', [detectionId])
  if (!rows[0]) return { attachments: undefined, imgHtml: '' }
  return {
    attachments: [{ filename: `deteccion-${detectionId}.jpg`, content: rows[0].image_data, cid: 'crop@ecoguardian' }],
    imgHtml: '<p><img src="cid:crop@ecoguardian" alt="Detección" style="max-width:100%;border-radius:8px"></p>',
  }
}

function incidentBody(incident, detection, extraText = '') {
  const url = `${appUrl()}/incidencias?id=${incident.id}`
  const lat = Number(incident.latitude).toFixed(6)
  const lon = Number(incident.longitude).toFixed(6)
  const size = Number.isFinite(incident.area_m2) ? `${fmtArea(incident.area_m2)} (${SIZE_LABEL[sizeClass(incident.area_m2)] ?? '—'})` : 'sin estimar'
  const legal = detection?.nearest_legal_name
    ? `${detection.nearest_legal_name} a ${Math.round(detection.nearest_legal_distance_m)} m`
    : 'ningún vertedero autorizado cercano'
  const conf = detection ? `${Math.round(detection.confidence * 100)} %` : '—'
  const text = `${incident.title}\n\nUbicación: ${lat}, ${lon}\nMapa: ${mapsLink(lat, lon)}\nConfianza del modelo: ${conf}\nTamaño estimado: ${size}\nInstalación legal más cercana: ${legal}\n${extraText ? `\n${extraText}\n` : ''}\nIncidencia en EcoGuardian: ${url}`
  const rows = [
    ['Ubicación', `<a href="${mapsLink(lat, lon)}">${lat}, ${lon}</a>`],
    ['Confianza del modelo', conf],
    ['Tamaño estimado', escapeHtml(size)],
    ['Instalación legal más cercana', escapeHtml(legal)],
  ]
  const table = `<table style="border-collapse:collapse;margin:12px 0">${rows
    .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#52606d">${k}</td><td>${v}</td></tr>`)
    .join('')}</table>`
  const extra = extraText ? `<p>${escapeHtml(extraText).replace(/\n/g, '<br>')}</p>` : ''
  const button = `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0b8c68;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Abrir la incidencia</a></p>`
  return { text, html: table + extra + button }
}

// Aviso a todos los destinatarios cuando se confirma un vertedero (se crea la incidencia).
export async function notifyConfirmed({ incident, detection }) {
  try {
    const recipients = await activeRecipients()
    if (recipients.length === 0) return []
    const { attachments, imgHtml } = await cropAttachment(detection?.id)
    const body = incidentBody(incident, detection)
    const subject = `[EcoGuardian] Vertedero confirmado: ${incident.title}`
    return await sendTo(recipients, {
      kind: 'detection_confirmed',
      subject,
      text: body.text,
      html: layout('Vertedero confirmado', imgHtml + body.html),
      attachments,
      ctx: { detectionId: detection?.id ?? null, incidentId: incident.id },
    })
  } catch (error) {
    console.error('[notify] notifyConfirmed:', error.message)
    return []
  }
}

// Informe de una incidencia a una autoridad / entidad concreta (accion manual del gestor).
export async function sendIncidentReport({ incident, detection, to, name, message }) {
  const { attachments, imgHtml } = await cropAttachment(detection?.id)
  const intro = `${name ? `Estimado/a ${name}:\n` : ''}Se ha detectado y confirmado un posible vertedero ilegal. Adjuntamos las coordenadas y los detalles para que se puedan emprender las acciones de limpieza y control oportunas.${message ? `\n\n${message}` : ''}`
  const body = incidentBody(incident, detection, intro)
  const subject = `[EcoGuardian] Informe de posible vertedero ilegal: ${incident.title}`
  const result = await sendMail({ to, subject, text: body.text, html: layout('Informe de posible vertedero ilegal', imgHtml + body.html), attachments })
  const status = await logMail({ kind: 'incident_report', to, subject, result, detectionId: detection?.id ?? null, incidentId: incident.id })
  return { status, sent: result.sent, reason: result.reason }
}

// Resumen tras el analisis de un area monitorizada con detecciones nuevas.
export async function notifyAreaRun({ area, run, newDetections }) {
  try {
    const recipients = await activeRecipients()
    if (recipients.length === 0 || newDetections.length === 0) return []
    const url = `${appUrl()}/revision`
    const lines = newDetections
      .slice(0, 15)
      .map((d) => `- ${Number(d.latitude).toFixed(5)}, ${Number(d.longitude).toFixed(5)} · ${Math.round(d.confidence * 100)} % · ${fmtArea(d.area_m2)} · ${mapsLink(d.latitude, d.longitude)}`)
    const more = newDetections.length > 15 ? `\n… y ${newDetections.length - 15} más.` : ''
    const subject = `[EcoGuardian] ${newDetections.length} nueva(s) detección(es) en «${area.name}»`
    const text = `El análisis ${run.trigger === 'scheduled' ? 'programado' : 'manual'} del área «${area.name}» ha encontrado ${newDetections.length} posible(s) vertedero(s) ilegal(es) nuevo(s):\n\n${lines.join('\n')}${more}\n\nRevísalos en EcoGuardian: ${url}`
    const html = layout(
      `Nuevas detecciones en «${area.name}»`,
      `<p>El análisis ${run.trigger === 'scheduled' ? 'programado' : 'manual'} ha encontrado <strong>${newDetections.length}</strong> posible(s) vertedero(s) ilegal(es) nuevo(s).</p>
       <ul style="padding-left:18px">${newDetections
         .slice(0, 15)
         .map(
           (d) =>
             `<li><a href="${mapsLink(d.latitude, d.longitude)}">${Number(d.latitude).toFixed(5)}, ${Number(d.longitude).toFixed(5)}</a> · ${Math.round(d.confidence * 100)} % · ${escapeHtml(fmtArea(d.area_m2))}</li>`,
         )
         .join('')}</ul>${more ? `<p>${escapeHtml(more.trim())}</p>` : ''}
       <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0b8c68;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Revisar detecciones</a></p>`,
    )
    return await sendTo(recipients, { kind: 'area_run', subject, text, html, ctx: { areaId: area.id } })
  } catch (error) {
    console.error('[notify] notifyAreaRun:', error.message)
    return []
  }
}

export async function sendTestAlert(to) {
  const subject = '[EcoGuardian] Correo de prueba de alertas'
  const text = 'Este es un correo de prueba. Si lo recibes, las alertas de EcoGuardian llegarán correctamente a esta dirección.'
  const result = await sendMail({ to, subject, text, html: layout('Correo de prueba', `<p>${text}</p>`) })
  const status = await logMail({ kind: 'test', to, subject, result })
  return { status, sent: result.sent, reason: result.reason }
}
