import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pool } from '../config/db.js'

// Primer arranque: si no hay ningun usuario, crea un admin. Usa ADMIN_EMAIL y
// ADMIN_PASSWORD de backend/.env; si no estan, genera una contraseña y la
// muestra UNA vez por consola.
export async function ensureAdminUser() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users')
  if (rows[0].n > 0) return

  const email = (process.env.ADMIN_EMAIL || 'admin@ecoguardian.local').toLowerCase()
  const generated = !process.env.ADMIN_PASSWORD
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url')
  const hash = await bcrypt.hash(password, 12)

  await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, 'Administrador', $2, 'admin')`,
    [email, hash],
  )
  console.log('[bootstrap] Usuario administrador creado.')
  console.log(`[bootstrap]   email:      ${email}`)
  if (generated) console.log(`[bootstrap]   contraseña: ${password}   (cámbiala tras el primer acceso)`)
}

// Actualizaciones de esquema idempotentes para bases de datos ya creadas.
export async function ensureSchemaUpgrades() {
  await pool.query(
    'ALTER TABLE detections ADD COLUMN IF NOT EXISTS cell_image_id INTEGER REFERENCES analysis_images(id) ON DELETE SET NULL',
  )
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  // Incidencias, alertas, areas monitorizadas, tamano y planes de vuelo: mismo SQL que database/schema/010
  // (copia embebida en backend/src/services/schema010.sql para que tambien funcione dentro de la imagen Docker).
  const sqlPath = fileURLToPath(new URL('./schema010.sql', import.meta.url))
  await pool.query(fs.readFileSync(sqlPath, 'utf8'))
}
