import crypto from 'node:crypto'
import axios from 'axios'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../config/db.js'
import { signToken, publicUser } from '../middleware/auth.js'
import { appUrl, sendPasswordResetEmail } from '../services/mailer.js'

// POST /api/auth/login
export async function login(req, res, next) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios.' })

    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [email])
    const user = rows[0]
    // Mismo mensaje para usuario inexistente y contraseña erronea.
    const ok = user && user.active && (await bcrypt.compare(password, user.password_hash))
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas.' })

    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
    res.json({ token: signToken(user, { remember: Boolean(req.body?.remember) }), user: publicUser(user) })
  } catch (error) {
    next(error)
  }
}

// GET /api/auth/me
export function me(req, res) {
  res.json({ user: req.user })
}

// POST /api/auth/change-password
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body ?? {}
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' })
    }
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
    if (!(await bcrypt.compare(String(currentPassword ?? ''), rows[0].password_hash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' })
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(newPassword, 12), req.user.id])
    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Recuperacion de contraseña
// ---------------------------------------------------------------------------
const RESET_MINUTES = 60
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// POST /api/auth/forgot-password  { email }
// Responde siempre igual exista o no la cuenta (no se revela quien esta registrado).
export async function forgotPassword(req, res, next) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    if (email) {
      const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1 AND active', [email])
      const user = rows[0]
      if (user) {
        const token = crypto.randomBytes(32).toString('base64url')
        await pool.query('DELETE FROM password_resets WHERE user_id = $1', [user.id])
        await pool.query(
          `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
          [user.id, sha256(token), String(RESET_MINUTES)],
        )
        const link = `${appUrl()}/restablecer?token=${encodeURIComponent(token)}`
        await sendPasswordResetEmail({ to: user.email, fullName: user.full_name, link, minutes: RESET_MINUTES })
      }
    }
    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
}

// POST /api/auth/reset-password  { token, password }
export async function resetPassword(req, res, next) {
  try {
    const token = String(req.body?.token ?? '')
    const password = req.body?.password
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
    }
    const { rows } = await pool.query(
      'SELECT user_id FROM password_resets WHERE token_hash = $1 AND expires_at > now()',
      [sha256(token)],
    )
    if (!rows[0]) return res.status(400).json({ error: 'El enlace no es válido o ha caducado. Pide uno nuevo.' })
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 12), rows[0].user_id])
    await pool.query('DELETE FROM password_resets WHERE user_id = $1', [rows[0].user_id])
    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Inicio de sesion con Google / Apple (solo cuentas ya creadas por un admin)
// ---------------------------------------------------------------------------
// GET /api/auth/providers
export function providers(req, res) {
  res.json({
    google: process.env.GOOGLE_CLIENT_ID || null,
    apple: process.env.APPLE_CLIENT_ID
      ? { clientId: process.env.APPLE_CLIENT_ID, redirectUri: process.env.APPLE_REDIRECT_URI || appUrl() }
      : null,
  })
}

async function finishSocialLogin(req, res, email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [String(email).toLowerCase()])
  const user = rows[0]
  if (!user || !user.active) {
    return res.status(403).json({ error: 'Ese correo no tiene cuenta en EcoGuardian. Pide a un administrador que la cree.' })
  }
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
  res.json({ token: signToken(user, { remember: Boolean(req.body?.remember) }), user: publicUser(user) })
}

// POST /api/auth/google  { accessToken }
export async function googleLogin(req, res, next) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) return res.status(501).json({ error: 'El acceso con Google no está configurado.' })
    const accessToken = String(req.body?.accessToken ?? '')
    if (!accessToken) return res.status(400).json({ error: 'Falta el token de Google.' })

    let info
    try {
      ;({ data: info } = await axios.get('https://oauth2.googleapis.com/tokeninfo', { params: { access_token: accessToken }, timeout: 10000 }))
    } catch {
      return res.status(401).json({ error: 'Token de Google no válido.' })
    }
    if (info.aud !== clientId && info.azp !== clientId) return res.status(401).json({ error: 'Token de Google no válido.' })
    const { data: profile } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    })
    if (!profile.email || profile.email_verified !== true) {
      return res.status(401).json({ error: 'La cuenta de Google no tiene el correo verificado.' })
    }
    await finishSocialLogin(req, res, profile.email)
  } catch (error) {
    next(error)
  }
}

// POST /api/auth/apple  { idToken }
export async function appleLogin(req, res, next) {
  try {
    const clientId = process.env.APPLE_CLIENT_ID
    if (!clientId) return res.status(501).json({ error: 'El acceso con Apple no está configurado.' })
    const idToken = String(req.body?.idToken ?? '')
    const header = JSON.parse(Buffer.from(idToken.split('.')[0] ?? '', 'base64url').toString() || '{}')
    const { data } = await axios.get('https://appleid.apple.com/auth/keys', { timeout: 10000 })
    const jwk = data.keys.find((k) => k.kid === header.kid)
    if (!jwk) return res.status(401).json({ error: 'Token de Apple no válido.' })
    let claims
    try {
      claims = jwt.verify(idToken, crypto.createPublicKey({ key: jwk, format: 'jwk' }), {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: clientId,
      })
    } catch {
      return res.status(401).json({ error: 'Token de Apple no válido.' })
    }
    if (!claims.email) return res.status(401).json({ error: 'Apple no ha devuelto un correo.' })
    await finishSocialLogin(req, res, claims.email)
  } catch (error) {
    next(error)
  }
}
