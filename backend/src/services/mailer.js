import 'dotenv/config'

// Envio de correo por SMTP (nodemailer). Si SMTP_HOST no esta definido (o falta
// el paquete) no se envia nada: el contenido se muestra por consola para poder
// probar en local y la API indica que el correo no salio.
let transporterPromise = null

async function getTransporter() {
  if (!process.env.SMTP_HOST) return null
  if (!transporterPromise) {
    transporterPromise = import('nodemailer')
      .then(({ default: nodemailer }) =>
        nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        }),
      )
      .catch((error) => {
        console.error('[mail] No se pudo cargar nodemailer (ejecuta "npm install" en backend):', error.message)
        return null
      })
  }
  return transporterPromise
}

export function appUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function layout(title, bodyHtml) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2933">
  <h2 style="margin:0 0 16px;color:#0b8c68">EcoGuardian</h2>
  <h3 style="margin:0 0 12px">${escapeHtml(title)}</h3>
  ${bodyHtml}
  <p style="margin-top:28px;font-size:12px;color:#7b8794">Mensaje automático de EcoGuardian. Si no esperabas este correo, ignóralo.</p>
</div>`
}

// Devuelve { sent: boolean, reason?: string }. Nunca lanza.
export async function sendMail({ to, subject, text, html, attachments }) {
  try {
    const transporter = await getTransporter()
    if (!transporter) {
      console.log(`[mail] (SMTP sin configurar, no se envia) Para: ${to}\n  Asunto: ${subject}\n${text}\n`)
      return { sent: false, reason: 'smtp_not_configured' }
    }
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER || 'EcoGuardian <no-reply@ecoguardian.local>',
      to,
      subject,
      text,
      html,
      attachments,
    })
    return { sent: true }
  } catch (error) {
    console.error('[mail] Error enviando correo:', error.message)
    return { sent: false, reason: 'send_failed' }
  }
}

export function sendWelcomeEmail({ to, fullName, email, password, role }) {
  const url = appUrl()
  const text = `Hola ${fullName},\n\nSe ha creado tu cuenta en EcoGuardian.\n\nAcceso: ${url}\nUsuario (correo): ${email}\nContraseña: ${password}\nRol: ${role}\n\nTe recomendamos cambiar la contraseña tras el primer acceso (opción "He olvidado mi contraseña" en el login).`
  const html = layout(
    'Tu cuenta está lista',
    `<p>Hola ${escapeHtml(fullName)}, se ha creado tu cuenta en EcoGuardian.</p>
     <table style="border-collapse:collapse;margin:12px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#52606d">Acceso</td><td><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#52606d">Usuario</td><td><strong>${escapeHtml(email)}</strong></td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#52606d">Contraseña</td><td><strong>${escapeHtml(password)}</strong></td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#52606d">Rol</td><td>${escapeHtml(role)}</td></tr>
     </table>
     <p>Te recomendamos cambiar la contraseña tras el primer acceso.</p>`,
  )
  return sendMail({ to, subject: 'Tu cuenta de EcoGuardian', text, html })
}

export function sendPasswordResetEmail({ to, fullName, link, minutes }) {
  const text = `Hola ${fullName},\n\nHas pedido restablecer tu contraseña de EcoGuardian. Abre este enlace (válido ${minutes} minutos):\n${link}\n\nSi no lo has pedido tú, ignora este mensaje.`
  const html = layout(
    'Restablecer contraseña',
    `<p>Hola ${escapeHtml(fullName)}, has pedido restablecer tu contraseña.</p>
     <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0fae82;color:#04140f;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Elegir nueva contraseña</a></p>
     <p style="font-size:13px;color:#52606d">El enlace es personal, de un solo uso y caduca en ${minutes} minutos. No lo compartas con nadie.</p>`,
  )
  return sendMail({ to, subject: 'Restablecer tu contraseña de EcoGuardian', text, html })
}
