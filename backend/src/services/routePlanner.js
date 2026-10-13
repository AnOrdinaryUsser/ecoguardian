import { centroid, distanceMeters, DRONE_PROFILES, droneFootprint, droneProfile, polygonAreaM2, projector, validPolygon } from './geo.js'

// Planificador de vuelo "en serpentina" (boustrophedon) sobre un poligono:
// lineas paralelas separadas segun lo que ve la camara a la altura elegida.

const MAX_ALTITUDE_M = 120 // limite de la categoria abierta (UE)
const TURN_SECONDS = 4 // tiempo extra estimado por giro/parada en cada extremo

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback)

// Intersecciones de la recta y = yLine con el poligono (en metros), ordenadas por x.
function scanSegments(points, yLine) {
  const xs = []
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    if (y1 === y2) continue
    if ((y1 <= yLine && y2 > yLine) || (y2 <= yLine && y1 > yLine)) xs.push(x1 + ((yLine - y1) * (x2 - x1)) / (y2 - y1))
  }
  xs.sort((a, b) => a - b)
  const segments = []
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.5) segments.push([xs[i], xs[i + 1]])
  return segments
}

// Direccion del lado mas largo (grados, 0 = este, antihorario): vuelos largos = menos giros.
function longestEdgeAngle(points) {
  let best = 0
  let angle = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len > best) {
      best = len
      angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
    }
  }
  return ((angle % 180) + 180) % 180
}

export function planRoute(input) {
  const polygon = input.polygon
  if (!validPolygon(polygon)) throw Object.assign(new Error('Dibuja un área con al menos 3 puntos.'), { status: 400 })
  const areaM2 = polygonAreaM2(polygon)
  if (areaM2 < 100) throw Object.assign(new Error('El área es demasiado pequeña (menos de 100 m²).'), { status: 400 })
  if (areaM2 > 5_000_000) throw Object.assign(new Error('El área es demasiado grande para un solo vuelo (máximo 500 ha). Divídela en varias.'), { status: 400 })

  if (input.droneModel && !DRONE_PROFILES[input.droneModel]) {
    throw Object.assign(new Error('Modelo de dron no reconocido.'), { status: 400 })
  }
  const droneModel = input.droneModel || 'mini5pro'
  const profile = droneProfile(droneModel)
  const altitude = clamp(num(input.altitude, 100), 20, MAX_ALTITUDE_M)
  const hfov = clamp(num(input.hfov, profile.hfov), 30, 130)
  const sidelap = clamp(num(input.sidelap, 30), 0, 80) / 100
  const forwardOverlap = clamp(num(input.forwardOverlap, 60), 0, 90) / 100
  const speed = clamp(num(input.speed, profile.speed), 1, 15)

  const footprintWidth = 2 * altitude * Math.tan((hfov * Math.PI) / 360)
  const footprint = droneFootprint(altitude, droneModel, profile.aspect)
  const across = footprintWidth // la camara mira hacia abajo, el lado ancho es perpendicular al avance
  const spacing = Math.max(across * (1 - sidelap), 5)
  const along = footprint.height

  const origin = centroid(polygon)
  const proj = projector(origin)
  const pts = polygon.map(proj.toXY)

  const heading = input.heading === undefined || input.heading === null || input.heading === '' || input.heading === 'auto' ? longestEdgeAngle(pts) : ((num(input.heading, 0) % 180) + 180) % 180
  const rad = (-heading * Math.PI) / 180
  const rot = ([x, y]) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)]
  const unrot = ([x, y]) => [x * Math.cos(-rad) - y * Math.sin(-rad), x * Math.sin(-rad) + y * Math.cos(-rad)]
  const rp = pts.map(rot)

  const minY = Math.min(...rp.map((p) => p[1]))
  const maxY = Math.max(...rp.map((p) => p[1]))
  const lines = []
  // La primera linea queda a media separacion del borde: la huella de la camara llega justo al limite.
  for (let y = minY + Math.min(spacing / 2, (maxY - minY) / 2); y <= maxY + 1e-6; y += spacing) lines.push(y)
  if (lines.length === 0) lines.push((minY + maxY) / 2)

  const legs = []
  let leftToRight = true
  for (const y of lines) {
    const segs = scanSegments(rp, y)
    const ordered = leftToRight ? segs : [...segs].reverse()
    for (const [x1, x2] of ordered) legs.push(leftToRight ? [[x1, y], [x2, y]] : [[x2, y], [x1, y]])
    if (segs.length) leftToRight = !leftToRight
  }
  if (legs.length === 0) throw Object.assign(new Error('No se pudo generar la ruta sobre esa área.'), { status: 400 })

  const waypoints = []
  for (const [a, b] of legs) {
    for (const p of [a, b]) {
      const [lng, lat] = proj.toLngLat(unrot(p))
      waypoints.push({ index: waypoints.length, lng: Number(lng.toFixed(7)), lat: Number(lat.toFixed(7)), altitude, speed })
    }
  }

  // Estadisticas
  let distance = 0
  for (let i = 1; i < waypoints.length; i += 1) distance += distanceMeters([waypoints[i - 1].lng, waypoints[i - 1].lat], [waypoints[i].lng, waypoints[i].lat])
  const legDistance = legs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
  const photoSpacing = Math.max(along * (1 - forwardOverlap), 1)
  const flightSeconds = distance / speed + legs.length * TURN_SECONDS
  const usable = profile.minutes
  const warnings = []
  if (waypoints.length > 99) warnings.push('maxWaypoints')
  if (flightSeconds / 60 > usable) warnings.push('batteries')
  if (altitude >= MAX_ALTITUDE_M) warnings.push('maxAltitude')

  return {
    waypoints,
    params: { droneModel, altitude, hfov, sidelap: Math.round(sidelap * 100), forwardOverlap: Math.round(forwardOverlap * 100), speed, heading: Math.round(heading) },
    stats: {
      areaM2: Math.round(areaM2),
      lines: legs.length,
      waypoints: waypoints.length,
      distanceM: Math.round(distance),
      sweepDistanceM: Math.round(legDistance),
      durationMin: Number((flightSeconds / 60).toFixed(1)),
      photos: Math.ceil(legDistance / photoSpacing) + legs.length,
      photoIntervalM: Number(photoSpacing.toFixed(1)),
      photoIntervalS: Number((photoSpacing / speed).toFixed(1)),
      footprintM: { width: Math.round(footprintWidth), height: Math.round(along) },
      lineSpacingM: Math.round(spacing),
      batteries: Math.max(1, Math.ceil(flightSeconds / 60 / usable)),
      batteryMinutes: usable,
      warnings,
    },
  }
}
