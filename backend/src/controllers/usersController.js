import bcrypt from 'bcryptjs'
import { pool } from '../config/db.js'
import { ROLES, publicUser } from '../middleware/auth.js'
import { sendWelcomeEmail } from '../services/mailer.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// GET /api/users (admin)
export async function listUsers(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY id')
    res.json({ users: rows.map(publicUser) })
  } catch (error) {
    next(error)
  }
}

// POST /api/users (admin)
export async function createUser(req, res, next) {
  try {
    const { email, fullName, password, role } = req.body ?? {}
    if (!EMAIL_RE.test(String(email ?? ''))) return res.status(400).json({ error: 'Email no valido.' })
    if (!String(fullName ?? '').trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' })
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
    }
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Rol no valido. Opciones: ${ROLES.join(', ')}.` })

    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
        [String(email).trim().toLowerCase(), String(fullName).trim(), await bcrypt.hash(password, 12), role],
      )
      // Correo de bienvenida con las credenciales (se puede desactivar con sendEmail: false).
      let emailSent = null
      if (req.body?.sendEmail !== false) {
        const result = await sendWelcomeEmail({
          to: rows[0].email,
          fullName: rows[0].full_name,
          email: rows[0].email,
          password,
          role,
        })
        emailSent = result.sent
      }
      res.status(201).json({ user: publicUser(rows[0]), emailSent })
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese email.' })
      throw error
    }
  } catch (error) {
    next(error)
  }
}

// PATCH /api/users/:id (admin) - nombre, rol, activo y/o nueva contraseña
export async function updateUser(req, res, next) {
  try {
    const id = Number(req.params.id)
    const { fullName, role, active, password } = req.body ?? {}
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id no valido.' })
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol no valido.' })
    if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
    }
    // Evita que el admin se quite a si mismo el acceso por accidente.
    if (id === req.user.id && (active === false || (role !== undefined && role !== 'admin'))) {
      return res.status(400).json({ error: 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.' })
    }

    const sets = []
    const values = []
    const add = (column, value) => {
      values.push(value)
      sets.push(`${column} = $${values.length}`)
    }
    if (fullName !== undefined) add('full_name', String(fullName).trim())
    if (role !== undefined) add('role', role)
    if (active !== undefined) add('active', Boolean(active))
    if (password !== undefined) add('password_hash', await bcrypt.hash(password, 12))
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' })

    values.push(id)
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values)
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' })
    res.json({ user: publicUser(rows[0]) })
  } catch (error) {
    next(error)
  }
}
