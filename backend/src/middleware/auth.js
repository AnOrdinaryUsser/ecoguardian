import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import 'dotenv/config'
import { pool } from '../config/db.js'

export const ROLES = ['admin', 'monitor', 'gestor', 'piloto']

// Si no se define JWT_SECRET se genera uno al arrancar: funciona, pero todas
// las sesiones se cierran cada vez que se reinicia el backend. Defínelo en
// backend/.env para que sean estables.
let JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex')
  console.warn('[auth] JWT_SECRET no definido: se usa uno temporal (las sesiones se pierden al reiniciar).')
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h'

export function signToken(user, { remember = false } = {}) {
  const expiresIn = remember ? process.env.JWT_REMEMBER_EXPIRES_IN || '30d' : JWT_EXPIRES_IN
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn })
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

// Exige "Authorization: Bearer <token>" valido y usuario activo.
export async function authenticate(req, res, next) {
  try {
    const header = req.get('authorization') || ''
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Falta el token de sesion.' })
    }

    let payload
    try {
      payload = jwt.verify(token, JWT_SECRET)
    } catch {
      return res.status(401).json({ error: 'Sesion no valida o caducada.' })
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub])
    const user = result.rows[0]
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuario inexistente o desactivado.' })
    }

    req.user = publicUser(user)
    next()
  } catch (error) {
    next(error)
  }
}

// El admin pasa siempre; el resto solo si su rol esta en la lista.
export function requireRole(...allowed) {
  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'No autenticado.' })
    if (req.user.role === 'admin' || allowed.includes(req.user.role)) return next()
    return res.status(403).json({ error: 'Tu rol no tiene permiso para esta accion.' })
  }
}
