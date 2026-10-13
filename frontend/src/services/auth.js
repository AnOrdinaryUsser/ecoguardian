// Almacen del token de sesion. "Recordarme" -> localStorage (persiste); sin
// marcar -> sessionStorage (se pierde al cerrar la pestana). localStorage puede
// no estar disponible (modo privado), asi que hay un respaldo en memoria.
const TOKEN_KEY = 'ecoguardian_token'
let memoryToken = null

function read(storage) {
  try {
    return storage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getToken() {
  return read(window.localStorage) || read(window.sessionStorage) || memoryToken
}

export function setToken(token, remember = true) {
  memoryToken = token
  clearStored()
  try {
    ;(remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, token)
  } catch {
    // sin persistencia
  }
}

function clearStored() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.removeItem(TOKEN_KEY)
    } catch {
      // sin persistencia
    }
  }
}

export function clearToken() {
  memoryToken = null
  clearStored()
}

export const UNAUTHORIZED_EVENT = 'ecoguardian:unauthorized'
