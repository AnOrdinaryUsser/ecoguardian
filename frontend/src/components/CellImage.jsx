import { useState } from 'react'
import AuthImage from './AuthImage.jsx'

// Celda (o fotograma) con la caja de la deteccion dibujada encima.
// `bbox` = [x1, y1, x2, y2] normalizado 0-1.
// Con `cover` la imagen rellena un marco de proporcion fija (`frameRatio`,
// ancho/alto) recortando lo que sobre, y la caja se mantiene sobre su sitio.
export default function CellImage({ path, bbox, alt = '', className = '', fallback = null, label = null, cover = false, frameRatio = 4 / 3 }) {
  const [ratio, setRatio] = useState(null)
  const valid = Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))
  const [x1, y1, x2, y2] = valid ? bbox : [0, 0, 0, 0]

  const box = valid ? (
    <span
      className="cell-image-box"
      style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}
    >
      {label ? <span className="cell-image-box-label">{label}</span> : null}
    </span>
  ) : null

  if (cover) {
    const inner = ratio
      ? ratio >= frameRatio
        ? { height: '100%', aspectRatio: String(ratio) }
        : { width: '100%', aspectRatio: String(ratio) }
      : { width: '100%' }
    return (
      <div className={`cell-image-cover ${className}`}>
        <div className="cell-image-cover-inner" style={inner}>
          <AuthImage
            path={path}
            alt={alt}
            fallback={fallback}
            onLoad={(e) => setRatio(e.target.naturalWidth / e.target.naturalHeight)}
          />
          {box}
        </div>
      </div>
    )
  }

  return (
    <div className={`cell-image ${className}`}>
      <AuthImage path={path} alt={alt} fallback={fallback} />
      {box}
    </div>
  )
}
