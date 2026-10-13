import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

// Redirige al mapa si el rol del usuario no esta permitido (el admin siempre pasa).
export default function RequireRole({ roles = [], children }) {
  const { hasRole } = useAuth()
  return hasRole(...roles) ? children : <Navigate to="/" replace />
}
