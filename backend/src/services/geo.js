// Utilidades geograficas sin dependencias: tamanos en metros, teselas XYZ,
// punto en poligono y proyeccion local para planificar rutas.

const EARTH_RADIUS_M = 6371008.8
const toRad = (deg) => (deg * Math.PI) / 180
const toDeg = (rad) => (rad * 180) / Math.PI

// Metros por grado en una latitud dada (aproximacion esferica, suficiente a escala de parcela).
export function metersPerDegree(latitude) {
  const lat = toRad(latitude)
  return { lat: 111132.92 - 559.82 * Math.cos(2 * lat) + 1.175 * Math.cos(4 * lat), lon: 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3 * lat) }
}

// Dimensiones (m) de un rectangulo lat/lon.
export function boundsSizeMeters(bounds) {
  const mid = (bounds.north + bounds.south) / 2
  const m = metersPerDegree(mid)
  return { width: Math.abs(bounds.east - bounds.west) * m.lon, height: Math.abs(bounds.north - bounds.south) * m.lat }
}

export function boundsAreaSquareMeters(bounds) {
  const { width, height } = boundsSizeMeters(bounds)
  return width * height
}

// Area (m2) de la caja [x1,y1,x2,y2] normalizada sobre una imagen que cubre `bounds`.
export function boxAreaOnBounds(box, bounds) {
  if (!Array.isArray(box) || box.length !== 4 || !bounds) return null
  const w = Math.max(0, Math.min(1, box[2]) - Math.max(0, box[0]))
  const h = Math.max(0, Math.min(1, box[3]) - Math.max(0, box[1]))
  const size = boundsSizeMeters(bounds)
  const area = w * size.width * h * size.height
  return Number.isFinite(area) && area > 0 ? area : null
}

// Perfiles de camara para estimar el tamano desde un fotograma de dron (asumiendo camara cenital).
export const DRONE_PROFILES = {
  mini5pro: { label: 'DJI Mini 5 Pro', hfov: 84, aspect: 4 / 3, speed: 8, minutes: 25 },
  avata2: { label: 'DJI Avata 2', hfov: 100, aspect: 16 / 9, speed: 8, minutes: 12 },
  otro: { label: 'Otro', hfov: 80, aspect: 16 / 9, speed: 7, minutes: 15 },
}

export function droneProfile(model) {
  return DRONE_PROFILES[model] ?? DRONE_PROFILES.otro
}

// Superficie del terreno que cubre un fotograma de dron a `altitudeM` metros.
export function droneFootprint(altitudeM, model, aspectOverride) {
  const profile = droneProfile(model)
  const width = 2 * altitudeM * Math.tan(toRad(profile.hfov) / 2)
  return { width, height: width / (aspectOverride || profile.aspect) }
}

export function boxAreaOnDroneFrame(box, altitudeM, model, aspect = 16 / 9) {
  if (!Array.isArray(box) || box.length !== 4 || !Number.isFinite(altitudeM) || altitudeM < 5) return null
  const footprint = droneFootprint(altitudeM, model, aspect)
  const w = Math.max(0, box[2] - box[0])
  const h = Math.max(0, box[3] - box[1])
  const area = w * footprint.width * h * footprint.height
  return Number.isFinite(area) && area > 0 ? area : null
}

export function sizeClass(areaM2) {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null
  if (areaM2 < 100) return 'small'
  if (areaM2 < 1000) return 'medium'
  return 'large'
}

export function priorityFromArea(areaM2) {
  const size = sizeClass(areaM2)
  return size === 'large' ? 'high' : size === 'small' ? 'low' : 'medium'
}

// ---- Teselas XYZ (misma formula que el frontend, services/tileMath.js) ----
const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const lat2tile = (lat, z) => {
  const r = toRad(lat)
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}
const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180
const tile2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return toDeg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))))
}

export function tileBounds(x, y, z) {
  return { north: tile2lat(y, z), south: tile2lat(y + 1, z), west: tile2lon(x, z), east: tile2lon(x + 1, z) }
}

// Poligono = [[lng, lat], ...] (sin repetir el primer punto).
export function polygonBBox(polygon) {
  const lngs = polygon.map((p) => p[0])
  const lats = polygon.map((p) => p[1])
  return { west: Math.min(...lngs), east: Math.max(...lngs), south: Math.min(...lats), north: Math.max(...lats) }
}

export function pointInPolygon([x, y], polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

// Una tesela cuenta si el poligono la toca: algun vertice dentro, el centro o una esquina dentro del poligono, o se cruzan los lados.
function tileTouchesPolygon(b, polygon) {
  const corners = [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]]
  const center = [(b.west + b.east) / 2, (b.north + b.south) / 2]
  if (pointInPolygon(center, polygon) || corners.some((c) => pointInPolygon(c, polygon))) return true
  if (polygon.some(([x, y]) => x >= b.west && x <= b.east && y >= b.south && y <= b.north)) return true
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    for (let k = 0; k < 4; k += 1) if (segmentsIntersect(p, q, corners[k], corners[(k + 1) % 4])) return true
  }
  return false
}

export function estimateTileCount(polygon, zoom) {
  const b = polygonBBox(polygon)
  const nx = lon2tile(b.east, zoom) - lon2tile(b.west, zoom) + 1
  const ny = lat2tile(b.south, zoom) - lat2tile(b.north, zoom) + 1
  return Math.max(0, nx) * Math.max(0, ny)
}

export function tilesForPolygon(polygon, zoom) {
  const b = polygonBBox(polygon)
  const tiles = []
  for (let y = lat2tile(b.north, zoom); y <= lat2tile(b.south, zoom); y += 1) {
    for (let x = lon2tile(b.west, zoom); x <= lon2tile(b.east, zoom); x += 1) {
      const bounds = tileBounds(x, y, zoom)
      if (tileTouchesPolygon(bounds, polygon)) tiles.push({ x, y, z: zoom, ...bounds })
    }
  }
  return tiles
}

// ---- Poligonos en metros locales ----
export function centroid(polygon) {
  const n = polygon.length
  return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n]
}

export function projector(origin) {
  const m = metersPerDegree(origin[1])
  return {
    toXY: ([lng, lat]) => [(lng - origin[0]) * m.lon, (lat - origin[1]) * m.lat],
    toLngLat: ([x, y]) => [origin[0] + x / m.lon, origin[1] + y / m.lat],
  }
}

export function polygonAreaM2(polygon) {
  const { toXY } = projector(centroid(polygon))
  const pts = polygon.map(toXY)
  let sum = 0
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

export function distanceMeters(a, b) {
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

// Cuadrado de lado 2*radius centrado en [lng, lat].
export function squareAround([lng, lat], radiusM) {
  const m = metersPerDegree(lat)
  const dx = radiusM / m.lon
  const dy = radiusM / m.lat
  return [[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy]]
}

export function validPolygon(polygon) {
  // Debe tener al menos 3 vertices distintos (no una linea ni un punto repetido).
  const distinct = Array.isArray(polygon) ? new Set(polygon.map((p) => `${p?.[0]},${p?.[1]}`)).size : 0
  return (
    distinct >= 3 &&
    Array.isArray(polygon) &&
    polygon.length >= 3 &&
    polygon.length <= 500 &&
    polygon.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
  )
}
