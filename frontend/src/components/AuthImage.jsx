import { useEffect, useState } from 'react'
import { fetchBlobUrl } from '../services/api.js'

// <img> que descarga la imagen con el token (las rutas de imagen requieren sesion).
export default function AuthImage({ path, alt = '', fallback = null, ...rest }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked = false
    let created = null
    setUrl(null)
    setFailed(false)
    if (!path) return undefined
    fetchBlobUrl(path)
      .then((u) => {
        if (revoked) URL.revokeObjectURL(u)
        else {
          created = u
          setUrl(u)
        }
      })
      .catch(() => setFailed(true))
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [path])

  if (failed || !path) return fallback
  if (!url) return <div className="auth-image-loading" />
  return <img src={url} alt={alt} {...rest} />
}
