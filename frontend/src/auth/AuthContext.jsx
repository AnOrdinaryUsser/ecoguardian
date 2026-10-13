import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { login as apiLogin, socialLogin as apiSocialLogin, fetchMe } from '../services/api.js'
import { clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from '../services/auth.js'

const AuthContext = createContext(null)

export const ROLE_LABEL_KEYS = {
  admin: 'roles.admin',
  monitor: 'roles.monitor',
  gestor: 'roles.gestor',
  piloto: 'roles.piloto',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  // Al arrancar, si hay token guardado se comprueba contra el backend.
  useEffect(() => {
    if (!getToken()) return
    fetchMe()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  // Cualquier 401 del backend cierra la sesion local.
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const login = useCallback(async (email, password, remember = false) => {
    const { token, user: loggedUser } = await apiLogin(email, password, remember)
    setToken(token, remember)
    setUser(loggedUser)
    return loggedUser
  }, [])

  const socialLogin = useCallback(async (provider, credential, remember = false) => {
    const { token, user: loggedUser } = await apiSocialLogin(provider, credential, remember)
    setToken(token, remember)
    setUser(loggedUser)
    return loggedUser
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  // El admin tiene acceso a todo.
  const hasRole = useCallback(
    (...roles) => Boolean(user) && (user.role === 'admin' || roles.includes(user.role)),
    [user],
  )

  const value = useMemo(
    () => ({ user, loading, login, socialLogin, logout, hasRole }),
    [user, loading, login, socialLogin, logout, hasRole],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
