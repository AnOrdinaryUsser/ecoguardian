// Limitador de peticiones en memoria, por IP y por proceso. Sin dependencias
// externas: suficiente para una instalacion en una sola maquina (red local).
// Cada llamada a la factoria tiene su propio contador.
export function createRateLimiter({ max, windowMs, message }) {
  const hits = new Map() // ip -> timestamps (ms)

  return function rateLimit(req, res, next) {
    const ip = req.ip
    const now = Date.now()
    const windowStart = now - windowMs
    const recent = (hits.get(ip) ?? []).filter((timestamp) => timestamp > windowStart)

    if (recent.length >= max) {
      const retryAfterSeconds = Math.ceil((recent[0] + windowMs - now) / 1000)
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)))
      return res.status(429).json({
        error: message || `Demasiadas solicitudes. Maximo ${max} cada ${Math.round(windowMs / 1000)}s.`,
      })
    }

    recent.push(now)
    hits.set(ip, recent)
    next()
  }
}
