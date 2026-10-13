import { estimateTileCount } from './tileMath.js'
import L from 'leaflet'

const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180

// Area (m2) de un poligono [[lng, lat], ...] (proyeccion local, suficiente a escala de parcela).
export function polygonAreaM2(polygon) {
  if (!polygon || polygon.length < 3) return 0
  const lat0 = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
  const lng0 = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
  const pts = polygon.map(([lng, lat]) => [rad(lng - lng0) * R * Math.cos(rad(lat0)), rad(lat - lat0) * R])
  let sum = 0
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

export function polygonCellEstimate(polygon, zoom = 18) {
  if (!polygon || polygon.length < 3) return 0
  const bounds = L.latLngBounds(polygon.map(([lng, lat]) => [lat, lng]))
  return estimateTileCount(bounds, zoom)
}

export const polygonCenter = (polygon) => {
  const lat = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
  const lng = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
  return { lat, lng }
}

export const toLatLngs = (polygon) => (polygon ?? []).map(([lng, lat]) => [lat, lng])

// 1.250 m² / 3,4 ha
export function formatArea(m2, locale) {
  if (!Number.isFinite(m2) || m2 <= 0) return '—'
  if (m2 >= 10000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(m2 / 10000)} ha`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(m2)} m²`
}

export function formatDate(value, locale, withTime = true) {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
}

// Cuadrado de lado 2*radiusM centrado en un punto (para inspeccionar una detección).
export function squareAround(lng, lat, radiusM) {
  const dLat = radiusM / 111132
  const dLng = radiusM / (111320 * Math.cos(rad(lat)))
  return [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat]]
}
