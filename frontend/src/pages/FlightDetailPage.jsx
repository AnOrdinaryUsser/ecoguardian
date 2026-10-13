import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { CButton, CAlert } from '@coreui/react'
import { useI18n } from '../i18n/I18nContext.jsx'
import AuthImage from '../components/AuthImage.jsx'
import { getFlight, getFlightStatus } from '../services/api.js'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''
const STATUS_COLOR = { pending: '#f9b115', confirmed: '#e55353', rejected: '#8a93a0' }

const droneIcon = L.divIcon({ className: 'drone-marker', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] })

// Azul (bajo) -> rojo (alto).
function altColor(alt, min, max) {
  if (alt == null || max <= min) return '#3d9bff'
  const k = Math.min(Math.max((alt - min) / (max - min), 0), 1)
  return `hsl(${Math.round(210 - 210 * k)}, 85%, 55%)`
}

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 19 })
  }, [map, points])
  return null
}

export default function FlightDetailPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [cursor, setCursor] = useState(0) // indice en frames
  const [playing, setPlaying] = useState(false)
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      setData(await getFlight(id))
    } catch (err) {
      setError(err?.response?.data?.error || t('flights.loadError'))
    }
  }, [id, t])

  useEffect(() => {
    load()
  }, [load])

  const running = data && (data.flight.status === 'uploaded' || data.flight.status === 'processing')
  useEffect(() => {
    if (!running) return undefined
    const poll = setInterval(async () => {
      try {
        const s = await getFlightStatus(id)
        if (s.status === 'done' || s.status === 'error') load()
        else setData((d) => (d ? { ...d, flight: { ...d.flight, ...s } } : d))
      } catch (err) { /* reintenta */ }
    }, 3000)
    return () => clearInterval(poll)
  }, [running, id, load])

  const frames = data?.frames ?? []
  const track = useMemo(() => (data?.telemetry?.length ? data.telemetry : frames), [data, frames])
  const latlngs = useMemo(() => track.filter((p) => p.lat != null && p.lon != null).map((p) => [p.lat, p.lon]), [track])
  const alts = track.map((p) => p.alt).filter((a) => a != null)
  const minAlt = alts.length ? Math.min(...alts) : 0
  const maxAlt = alts.length ? Math.max(...alts) : 0

  const segments = useMemo(() => {
    const pts = track.filter((p) => p.lat != null && p.lon != null)
    const out = []
    for (let i = 1; i < pts.length; i += 1) {
      out.push({ key: i, pos: [[pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon]], color: altColor(pts[i].alt, minAlt, maxAlt) })
    }
    return out
  }, [track, minAlt, maxAlt])

  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => {
      setCursor((c) => {
        if (c >= frames.length - 1) {
          setPlaying(false)
          return c
        }
        return c + 1
      })
    }, 500)
    return () => clearInterval(timer.current)
  }, [playing, frames.length])

  if (error) return <div className="page-scroll"><CAlert color="danger">{error}</CAlert></div>
  if (!data) return null

  const { flight, detections } = data
  const frame = frames[Math.min(cursor, frames.length - 1)]
  const frameDetections = frame ? detections.filter((d) => d.frameId === frame.id && d.bbox) : []
  const center = latlngs[0] ?? [40.96, -5.66]

  return (
    <div className="page-scroll flight-detail">
      <Link to="/drones" className="small">← {t('flights.back')}</Link>
      <header className="page-header">
        <h1>{flight.name}</h1>
        <p className="muted">
          {flight.droneModel} · {t('flights.by')} {flight.createdByName ?? '—'} · {flight.framesDone}/{flight.framesTotal} {t('flights.frames')} · {flight.detectionsCount} {t('flights.detections')}
        </p>
        {running ? <CAlert color="info">{t('flights.processingNote')}</CAlert> : null}
        {flight.status === 'error' ? <CAlert color="danger">{flight.errorMessage}</CAlert> : null}
      </header>

      <div className="flight-layout">
        <section className="flight-map">
          {latlngs.length === 0 ? <p className="muted">{t('flights.noGps')}</p> : (
            <MapContainer center={center} zoom={17} scrollWheelZoom style={{ height: '100%', minHeight: 420 }}>
              {MAPBOX_TOKEN ? (
                <TileLayer
                  url={`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`}
                  tileSize={512} zoomOffset={-1} maxZoom={20} attribution="© Mapbox © OpenStreetMap"
                />
              ) : (
                <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              )}
              <FitBounds points={latlngs} />
              <Polyline positions={latlngs} pathOptions={{ color: '#000', weight: 8, opacity: 0.35 }} />
              {segments.map((s) => <Polyline key={s.key} positions={s.pos} pathOptions={{ color: s.color, weight: 4 }} />)}
              <CircleMarker center={latlngs[0]} radius={7} pathOptions={{ color: '#fff', fillColor: '#2eb85c', fillOpacity: 1 }}><Tooltip>Start</Tooltip></CircleMarker>
              <CircleMarker center={latlngs[latlngs.length - 1]} radius={7} pathOptions={{ color: '#fff', fillColor: '#e55353', fillOpacity: 1 }}><Tooltip>End</Tooltip></CircleMarker>
              {detections.map((d) => (
                <CircleMarker key={d.id} center={[d.lat, d.lon]} radius={9}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: STATUS_COLOR[d.reviewStatus] ?? '#f9b115', fillOpacity: 0.95 }}>
                  <Tooltip>{Math.round(d.confidence * 100)}% · {t(`review.status.${d.reviewStatus}`)}</Tooltip>
                </CircleMarker>
              ))}
              {frame && frame.lat != null ? <Marker position={[frame.lat, frame.lon]} icon={droneIcon} /> : null}
            </MapContainer>
          )}
          <div className="flight-legend small">
            {t('flights.altLegend')}: {minAlt.toFixed(0)} m <span className="alt-gradient" /> {maxAlt.toFixed(0)} m
          </div>
        </section>

        <section className="flight-frames">
          {frame ? (
            <>
              <div className="frame-viewer">
                <AuthImage path={`/api/flights/${flight.id}/frames/${frame.id}/image`} alt="" />
                {frameDetections.map((d) => (
                  <div key={d.id} className="frame-box"
                    style={{ left: `${d.bbox[0] * 100}%`, top: `${d.bbox[1] * 100}%`, width: `${(d.bbox[2] - d.bbox[0]) * 100}%`, height: `${(d.bbox[3] - d.bbox[1]) * 100}%` }} />
                ))}
              </div>
              <div className="frame-controls">
                <CButton size="sm" color="primary" onClick={() => setPlaying((p) => !p)}>{playing ? t('flights.pause') : t('flights.play')}</CButton>
                <input type="range" min={0} max={Math.max(frames.length - 1, 0)} value={cursor}
                  onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} />
              </div>
              <div className="muted small">
                {t('flights.frame')} {frame.idx + 1}/{frames.length} · t={frame.t.toFixed(1)} s
                {frame.alt != null ? ` · ${t('flights.altitude')} ${frame.alt.toFixed(0)} m` : ''}
                {frame.detections ? ` · ${frame.detections} ${t('flights.detections')}` : ''}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}
