import { Router } from 'express'
import { login, me, changePassword, forgotPassword, resetPassword, providers, googleLogin, appleLogin } from '../controllers/authController.js'
import { authenticate } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/accessControl.js'

const router = Router()

// Freno basico contra fuerza bruta: 10 intentos por minuto y por IP.
const loginRateLimit = createRateLimiter({ max: 10, windowMs: 60_000, message: 'Demasiados intentos de acceso. Espera un minuto.' })

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Inicia sesion y devuelve un token JWT
 *     tags: [Autenticacion]
 */
router.post('/login', loginRateLimit, login)
const forgotRateLimit = createRateLimiter({ max: 5, windowMs: 60_000, message: 'Demasiadas solicitudes. Espera un minuto.' })
router.post('/forgot-password', forgotRateLimit, forgotPassword)
router.post('/reset-password', loginRateLimit, resetPassword)
router.get('/providers', providers)
router.post('/google', loginRateLimit, googleLogin)
router.post('/apple', loginRateLimit, appleLogin)
router.get('/me', authenticate, me)
router.post('/change-password', authenticate, changePassword)

export default router
