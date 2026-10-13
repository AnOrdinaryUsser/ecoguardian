import axios from 'axios'
import { clearToken, getToken, UNAUTHORIZED_EVENT } from './auth.js'

// A hardcoded 'http://localhost:4000' fallback only ever works when the
// page itself was opened as "localhost" - open the app from another
// device on the network via the PC's LAN IP (e.g. http://192.168.1.50:5173)
// and "localhost" in that request would resolve to the OTHER device, not
// this PC, so every API call would fail. Falling back to the page's own
// hostname instead means the backend is reached the same way the page
// itself was, whether that's localhost, 127.0.0.1 or a LAN IP - no .env
// needed just to test on a phone.
//
// The `!== undefined` check (rather than `||`) matters for production:
// there, the frontend and backend sit behind the same reverse proxy on
// one domain (see /Caddyfile - "/api/*" proxied to the backend, the
// build's own dist/ served for everything else), so the right base URL
// is "" (same origin, a plain relative "/api/..." request) - and "" is
// falsy, so `||` would wrongly skip straight past it to the ":4000"
// fallback above. Explicitly setting VITE_BACKEND_URL="" (see
// frontend/Dockerfile's build arg) is how production opts into that,
// while leaving the var completely unset (the local dev default) still
// gets the LAN-friendly fallback.
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL !== undefined
    ? import.meta.env.VITE_BACKEND_URL
    : `${window.location.protocol}//${window.location.hostname}:4000`

// 200s (>=3 min): must stay ABOVE the backend's own timeout when it calls
// the model-service (190s, see backend/src/services/modelClient.js). Real
// YOLO inference on CPU plus a PNOA WMS fetch can take a while - if this
// timeout were SHORTER than the backend's, cells the backend would have
// finished successfully would be aborted here first, which is why some
// cells in a run used to silently come back as "error" with nothing
// saved. Since this clock counts from when the browser sends the
// request - which includes however long it waits behind the backend's
// global concurrency limiter (see modelClient.js) if several users are
// analyzing at once, not just the inference itself - 200s gives enough
// slack for a handful of cells queued ahead of it without letting a
// genuinely stuck request hang forever.
const client = axios.create({
  baseURL: BACKEND_URL,
  timeout: 200000,
})

// Sesion: cada peticion lleva el token JWT; un 401 (token caducado o usuario
// desactivado) cierra la sesion local y vuelve a la pantalla de login.
client.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLogin = String(error?.config?.url ?? '').includes('/api/auth/login')
    if (error?.response?.status === 401 && !isLogin) {
      clearToken()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return Promise.reject(error)
  },
)

// Sends a grid cell (bounding box) to the backend for AI analysis.
// confidenceThreshold is always ANALYSIS_CONFIDENCE_FLOOR (0.5, see
// MapPage.jsx) regardless of what the user's slider shows - every run
// fetches the full 0.5-1.0 confidence band in one go, so the slider in
// DetectionPanel.jsx can filter the results client-side afterward with
// no re-analysis ever needed.
export async function analyzeCell({ bounds, confidenceThreshold, imageSource }) {
  const { data } = await client.post('/api/detections/analyze', {
    bounds,
    confidenceThreshold,
    imageSource,
  })
  return data
}

// Fetches the open-data context layers (protected areas, hydrography, land
// cover, legal waste facilities) for a given detection.
export async function getDetectionContext(detectionId) {
  const { data } = await client.get(`/api/detections/${detectionId}/context`)
  return data
}

// Fetches aggregated, anonymous global usage statistics for the dashboard.
export async function getGlobalStats() {
  const { data } = await client.get('/api/stats/global')
  return data
}

// Reports an analyzed cell to the backend so it counts towards the public,
// anonymous global statistics (no personal data is sent).
export async function reportCellAnalyzed({ areaSquareMeters, detectionsCount }) {
  const { data } = await client.post('/api/stats/report', {
    areaSquareMeters,
    detectionsCount,
  })
  return data
}

// Lista de detecciones registradas (GeoJSON), requiere sesion.
export async function getPublicDetections(minConfidence) {
  const { data } = await client.get('/api/detections', { params: { minConfidence } })
  return data
}

// Uploads one analyzed cell's thumbnail (base64, no "data:" prefix) to the
// backend so analyses.js can keep it out of localStorage - see
// 006_analysis_images.sql for why. Returns the new row's id.
export async function uploadAnalysisImage(base64Image) {
  const { data } = await client.post('/api/analysis-images', { image: base64Image, mimeType: 'image/jpeg' })
  return data.id
}

// Absolute URL for a previously uploaded cell image - safe to use directly
// as an <img src>, no fetch/decode needed on the frontend's side.
export function getAnalysisImageUrl(imageId) {
  return `${BACKEND_URL}/api/analysis-images/${imageId}`
}

// ---- Autenticacion y usuarios ----
export async function login(email, password, remember = false) {
  const { data } = await client.post('/api/auth/login', { email, password, remember })
  return data
}

export async function forgotPassword(email) {
  await client.post('/api/auth/forgot-password', { email })
}

export async function resetPassword(token, password) {
  await client.post('/api/auth/reset-password', { token, password })
}

export async function getAuthProviders() {
  const { data } = await client.get('/api/auth/providers')
  return data
}

export async function socialLogin(provider, credential, remember = false) {
  const body = provider === 'google' ? { accessToken: credential } : { idToken: credential }
  const { data } = await client.post(`/api/auth/${provider}`, { ...body, remember })
  return data
}

export async function fetchMe() {
  const { data } = await client.get('/api/auth/me')
  return data.user
}

export async function changePassword(currentPassword, newPassword) {
  await client.post('/api/auth/change-password', { currentPassword, newPassword })
}

export async function listUsers() {
  const { data } = await client.get('/api/users')
  return data.users
}

export async function createUser(user) {
  const { data } = await client.post('/api/users', user)
  return data // { user, emailSent }
}

export async function updateUser(id, changes) {
  const { data } = await client.patch(`/api/users/${id}`, changes)
  return data.user
}

// ---- Revision manual de detecciones ----
export async function reviewDetection(id, status, note) {
  const { data } = await client.patch(`/api/detections/${id}/review`, { status, note })
  return data.detection
}

export async function fetchBlobUrl(path) {
  const { data } = await client.get(path, { responseType: 'blob' })
  return URL.createObjectURL(data)
}

export async function listReview(params) {
  const { data } = await client.get('/api/review', { params })
  return data
}

export async function reviewCounts(params) {
  const { data } = await client.get('/api/review/counts', { params })
  return data
}

// ---- Drones ----
export async function uploadFlight(formData, onProgress) {
  const { data } = await client.post('/api/flights', formData, {
    timeout: 0,
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  })
  return data.flight
}

export async function listFlights() {
  const { data } = await client.get('/api/flights')
  return data.flights
}

export async function getFlight(id) {
  const { data } = await client.get(`/api/flights/${id}`)
  return data
}

export async function getFlightStatus(id) {
  const { data } = await client.get(`/api/flights/${id}/status`)
  return data
}

export async function deleteFlight(id) {
  await client.delete(`/api/flights/${id}`)
}

// ---- Incidencias ----
export async function listIncidents(params) {
  const { data } = await client.get('/api/incidents', { params })
  return data.incidents
}
export async function listAssignees() {
  const { data } = await client.get('/api/incidents/assignees')
  return data.assignees
}
export async function getIncidentsSummary() {
  const { data } = await client.get('/api/incidents/summary')
  return data
}
export async function getIncident(id) {
  const { data } = await client.get(`/api/incidents/${id}`)
  return data
}
export async function updateIncident(id, changes) {
  const { data } = await client.patch(`/api/incidents/${id}`, changes)
  return data.incident
}
export async function addIncidentNote(id, message) {
  await client.post(`/api/incidents/${id}/events`, { message })
}
export async function notifyIncidentAuthority(id, body) {
  const { data } = await client.post(`/api/incidents/${id}/notify`, body)
  return data
}
export async function createIncident(body) {
  const { data } = await client.post('/api/incidents', body)
  return data.incident
}

// ---- Alertas por correo ----
export async function listAlertRecipients() {
  const { data } = await client.get('/api/alerts/recipients')
  return data.recipients
}
export async function createAlertRecipient(body) {
  const { data } = await client.post('/api/alerts/recipients', body)
  return data.recipient
}
export async function updateAlertRecipient(id, changes) {
  const { data } = await client.patch(`/api/alerts/recipients/${id}`, changes)
  return data.recipient
}
export async function deleteAlertRecipient(id) {
  await client.delete(`/api/alerts/recipients/${id}`)
}
export async function getAlertLog() {
  const { data } = await client.get('/api/alerts/log')
  return data
}
export async function sendTestAlert(email) {
  const { data } = await client.post('/api/alerts/test', { email })
  return data
}

// ---- Areas monitorizadas ----
export async function listAreas() {
  const { data } = await client.get('/api/areas')
  return data
}
export async function createArea(body) {
  const { data } = await client.post('/api/areas', body)
  return data.area
}
export async function updateArea(id, changes) {
  const { data } = await client.patch(`/api/areas/${id}`, changes)
  return data.area
}
export async function deleteArea(id) {
  await client.delete(`/api/areas/${id}`)
}
export async function runArea(id) {
  const { data } = await client.post(`/api/areas/${id}/run`)
  return data
}
export async function listAreaRuns(id) {
  const { data } = await client.get(`/api/areas/${id}/runs`)
  return data.runs
}

// ---- Dataset revisado ----
export async function getDatasetSummary(params) {
  const { data } = await client.get('/api/review/export/summary', { params })
  return data
}

// Descarga un fichero devuelto por el backend (necesita el token, asi que va por axios y no por un enlace directo).
export async function downloadFile(method, url, { params, body, fallbackName = 'descarga' } = {}) {
  let response
  try {
    response = await client.request({ method, url, params, data: body, responseType: 'blob', timeout: 0 })
  } catch (error) {
    // Con responseType blob el mensaje de error del backend llega como Blob: se vuelve a leer como JSON.
    const blob = error?.response?.data
    if (blob instanceof Blob) {
      try {
        const parsed = JSON.parse(await blob.text())
        error.response.data = parsed
      } catch {
        // se deja tal cual
      }
    }
    throw error
  }
  const disposition = response.headers['content-disposition'] || ''
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(response.data)
  link.download = match ? match[1] : fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 10000)
}

// ---- Rutas de vuelo ----
export async function getDroneProfiles() {
  const { data } = await client.get('/api/flight-plans/profiles')
  return data.profiles
}
export async function planRoute(body) {
  const { data } = await client.post('/api/flight-plans/plan', body)
  return data
}
export async function listFlightPlans() {
  const { data } = await client.get('/api/flight-plans')
  return data.plans
}
export async function saveFlightPlan(body) {
  const { data } = await client.post('/api/flight-plans', body)
  return data.plan
}
export async function deleteFlightPlan(id) {
  await client.delete(`/api/flight-plans/${id}`)
}

export default client
