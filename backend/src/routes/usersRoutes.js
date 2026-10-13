import { Router } from 'express'
import { listUsers, createUser, updateUser } from '../controllers/usersController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(authenticate, requireRole()) // solo admin (requireRole() sin roles = solo admin)

/**
 * @openapi
 * /api/users:
 *   get:
 *     summary: Lista de usuarios (solo admin)
 *     tags: [Usuarios]
 */
router.get('/', listUsers)
router.post('/', createUser)
router.patch('/:id', updateUser)

export default router
