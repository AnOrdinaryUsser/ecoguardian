// Cambia la contraseña de un usuario (por si se pierde la del admin).
//   node scripts/reset-password.js admin@ecoguardian.local NuevaContraseña123
// Usa la misma base de datos que el backend (lee backend/.env y el .env de la raiz).
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { pool } from '../src/config/db.js'

const [email, password] = process.argv.slice(2)
if (!email || !password || password.length < 8) {
  console.error('Uso: node scripts/reset-password.js <email> <contraseña de al menos 8 caracteres>')
  process.exit(1)
}

const hash = await bcrypt.hash(password, 12)
const { rowCount } = await pool.query(
  'UPDATE users SET password_hash = $1, active = true WHERE lower(email) = lower($2)',
  [hash, email],
)
console.log(rowCount ? `Contraseña actualizada para ${email}.` : `No existe ningun usuario con el correo ${email}.`)
await pool.end()
