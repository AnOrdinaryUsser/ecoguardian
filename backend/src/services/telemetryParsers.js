// Lectura del registro de vuelo del dron. Formatos admitidos:
//   .srt  subtitulos de DJI (los que se guardan junto al video en la tarjeta SD
//         si activas "Subtitulos de video" en DJI Fly): lat, lon y altura por fotograma
//   .gpx  traza GPS (la mayoria de conversores de registros DJI exportan GPX)
//   .csv  p. ej. exportacion de Airdata/CsvView (columnas latitude, longitude, altitude, time)
//   .json lista de puntos {t|time, lat|latitude, lon|lng|longitude, alt|altitude}
// Todos acaban como [{ t (segundos desde el inicio), lat, lon, alt }].

const toNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function validPoint(p) {
  return (
    p &&
    Number.isFinite(p.t) &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180 &&
    // (0,0) = el dron aun no tenia fijacion GPS
    !(Math.abs(p.lat) < 1e-6 && Math.abs(p.lon) < 1e-6)
  )
}

function srtTimeToSeconds(text) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(text)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 10 ** m[4].length
}

export function parseSrt(text) {
  const points = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const timeMatch = /(\d+:\d+:\d+[,.]\d+)\s*-->/.exec(block)
    if (!timeMatch) continue
    const lat = /latitude\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(block)
    const lon = /longitude\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(block)
    if (!lat || !lon) continue
    const rel = /rel_alt\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(block)
    const abs = /abs_alt\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(block)
    points.push({
      t: srtTimeToSeconds(timeMatch[1]),
      lat: Number(lat[1]),
      lon: Number(lon[1]),
      alt: rel ? Number(rel[1]) : abs ? Number(abs[1]) : null,
    })
  }
  return points
}

export function parseGpx(text) {
  const raw = []
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi
  let m
  while ((m = re.exec(text))) {
    const lat = /lat\s*=\s*"(-?[\d.]+)"/i.exec(m[1])
    const lon = /lon\s*=\s*"(-?[\d.]+)"/i.exec(m[1])
    if (!lat || !lon) continue
    const ele = /<ele>\s*(-?[\d.]+)\s*<\/ele>/i.exec(m[2])
    const time = /<time>\s*([^<\s]+)\s*<\/time>/i.exec(m[2])
    raw.push({ ms: time ? Date.parse(time[1]) : null, lat: Number(lat[1]), lon: Number(lon[1]), alt: ele ? Number(ele[1]) : null })
  }
  if (raw.length && raw.every((p) => Number.isFinite(p.ms))) {
    const t0 = raw[0].ms
    return raw.map((p) => ({ t: (p.ms - t0) / 1000, lat: p.lat, lon: p.lon, alt: p.alt }))
  }
  // Sin marcas de tiempo: se asume 1 punto por segundo.
  return raw.map((p, i) => ({ t: i, lat: p.lat, lon: p.lon, alt: p.alt }))
}

function splitCsvLine(line, delimiter) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === delimiter && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase())
  const find = (...tests) => header.findIndex((h) => tests.some((test) => test(h)))
  const iLat = find((h) => h === 'lat' || h.includes('latitude'))
  const iLon = find((h) => h === 'lon' || h === 'lng' || h.includes('longitude'))
  const iAlt = find(
    (h) => h.includes('height_above_takeoff') || h.includes('height_above_ground') || h.includes('relative'),
    (h) => h === 'alt' || h.startsWith('altitude'),
    (h) => h.includes('height'),
  )
  const iTime = find((h) => h.startsWith('time') || h === 't' || h === 'seconds' || h === 'timestamp')
  if (iLat < 0 || iLon < 0) return []

  const timeHeader = iTime >= 0 ? header[iTime] : ''
  const raw = lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line, delimiter)
    let ms = null
    if (iTime >= 0) {
      const value = cells[iTime]
      const numeric = toNum(value)
      if (numeric !== null) ms = timeHeader.includes('millisecond') || timeHeader.includes('(ms)') ? numeric : numeric * 1000
      else if (value) ms = Date.parse(value)
    }
    return { ms, i, lat: toNum(cells[iLat]), lon: toNum(cells[iLon]), alt: iAlt >= 0 ? toNum(cells[iAlt]) : null }
  })
  const hasTime = raw.length > 0 && raw.every((p) => Number.isFinite(p.ms))
  const t0 = hasTime ? raw[0].ms : 0
  return raw.map((p) => ({ t: hasTime ? (p.ms - t0) / 1000 : p.i, lat: p.lat, lon: p.lon, alt: p.alt }))
}

export function parseJson(text) {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : (data.points ?? data.samples ?? data.frames ?? data.track ?? [])
  const pick = (obj, keys) => {
    for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key]
    return undefined
  }
  const raw = list.map((item, i) => {
    const time = pick(item, ['t', 'time', 'timestamp', 'seconds'])
    let ms = null
    if (typeof time === 'number') ms = time > 1e8 ? time : time * 1000
    else if (typeof time === 'string') ms = toNum(time) !== null ? toNum(time) * 1000 : Date.parse(time)
    return {
      ms,
      i,
      lat: toNum(pick(item, ['lat', 'latitude'])),
      lon: toNum(pick(item, ['lon', 'lng', 'longitude'])),
      alt: toNum(pick(item, ['alt', 'altitude', 'height', 'rel_alt'])),
    }
  })
  const hasTime = raw.length > 0 && raw.every((p) => Number.isFinite(p.ms))
  const t0 = hasTime ? raw[0].ms : 0
  return raw.map((p) => ({ t: hasTime ? (p.ms - t0) / 1000 : p.i, lat: p.lat, lon: p.lon, alt: p.alt }))
}

// Detecta el formato por extension/contenido, valida y ordena.
export function parseTelemetry(filename, text) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const trimmed = text.trimStart()
  let points
  if (ext === 'srt' || text.includes('-->')) points = parseSrt(text)
  else if (ext === 'gpx' || trimmed.startsWith('<?xml') || /<gpx\b/i.test(text)) points = parseGpx(text)
  else if (ext === 'json' || trimmed.startsWith('[') || trimmed.startsWith('{')) points = parseJson(text)
  else points = parseCsv(text)

  const valid = points.filter(validPoint).sort((a, b) => a.t - b.t)
  if (valid.length < 2) {
    throw new Error(
      'No se encontraron coordenadas GPS en el registro de vuelo. Sube el .SRT que genera el dron (activa los ' +
        'subtitulos de video en DJI Fly) o un GPX/CSV/JSON con latitud, longitud y tiempo.',
    )
  }
  // Los tiempos ya son relativos al inicio (SRT: del propio video; el resto: respecto al primer punto).
  return valid.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt }))
}

// Posicion interpolada en el instante t (null si t cae fuera del registro por mas de `tolerance` s).
export function interpolateAt(samples, t, tolerance = 2) {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (t < first.t - tolerance || t > last.t + tolerance) return null
  if (t <= first.t) return { lat: first.lat, lon: first.lon, alt: first.alt }
  if (t >= last.t) return { lat: last.lat, lon: last.lon, alt: last.alt }
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
  const lerp = (x, y) => (x === null || y === null ? (x ?? y) : x + (y - x) * k)
  return { lat: lerp(a.lat, b.lat), lon: lerp(a.lon, b.lon), alt: lerp(a.alt, b.alt) }
}

// Reduce a ~maxPoints puntos conservando el primero y el ultimo (para guardar el trazado).
export function downsample(samples, maxPoints = 1500) {
  if (samples.length <= maxPoints) return samples
  const step = (samples.length - 1) / (maxPoints - 1)
  const out = []
  for (let i = 0; i < maxPoints; i += 1) out.push(samples[Math.round(i * step)])
  return out
}
