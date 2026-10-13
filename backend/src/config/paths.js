import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Carpeta donde se guardan los videos subidos y los fotogramas extraidos.
export const UPLOADS_DIR = path.resolve(backendRoot, process.env.UPLOADS_DIR || 'uploads')
export const FLIGHTS_DIR = path.join(UPLOADS_DIR, 'flights')
export const TMP_DIR = path.join(UPLOADS_DIR, 'tmp')
