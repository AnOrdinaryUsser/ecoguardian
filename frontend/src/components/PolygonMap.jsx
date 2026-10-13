import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polygon, Marker, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { CButton } from '@coreui/react'
import SearchBar from './SearchBar.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''
const SPAIN_CENTER = [40.2, -3.7]

const vertexIcon = L.divIcon({ className: 'polymap-vertex', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })

function Clicker({ enabled, onAdd }) {
  useMapEvents({
    click(e) {
      if (enabled) onAdd([e.latlng.lng, e.latlng.lat])
    },
  })
  return null
}

function Flyer({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], target.isCoordinate ? 18 : 16, { duration: 1.2 })
  }, [target, map])
  return null
}

// Ajusta la vista a `fitPoints` ([lat, lng]) cuando cambia `fitKey`.
function Fitter({ fitPoints, fitKey }) {
  const map = useMap()
  const last = useRef(null)
  useEffect(() => {
    if (!fitPoints?.length || last.current === fitKey) return
    last.current = fitKey
    map.fitBounds(fitPoints, { padding: [50, 50], maxZoom: 18 })
  }, [fitPoints, fitKey, map])
  return null
}

// Mapa satelital donde se dibuja un poligono a base de clics (arrastra los puntos para ajustarlos;
// doble clic en un punto lo elimina). `children` permite pintar capas encima (ruta, detecciones...).
export default function PolygonMap({ polygon = [], onChange, editable = true, fitPoints, fitKey, children, height = 460, initialCenter, initialZoom, search = true }) {
  const { t } = useI18n()
  const [flyTarget, setFlyTarget] = useState(null)
  const latlngs = useMemo(() => polygon.map(([lng, lat]) => [lat, lng]), [polygon])

  const move = (index, latlng) => onChange(polygon.map((p, i) => (i === index ? [latlng.lng, latlng.lat] : p)))
  const remove = (index) => onChange(polygon.filter((_, i) => i !== index))

  return (
    <div className="polymap" style={{ height }}>
      <MapContainer center={initialCenter ?? SPAIN_CENTER} zoom={initialZoom ?? 6} maxZoom={20} scrollWheelZoom zoomControl={false} style={{ height: '100%', width: '100%' }} doubleClickZoom={false}>
        <ZoomControl position="bottomright" />
        {MAPBOX_TOKEN ? (
          <TileLayer
            url={`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`}
            tileSize={512} zoomOffset={-1} maxZoom={20} attribution="&copy; Mapbox &copy; OpenStreetMap"
          />
        ) : (
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="&copy; OpenStreetMap" />
        )}
        <Flyer target={flyTarget} />
        <Fitter fitPoints={fitPoints} fitKey={fitKey} />
        <Clicker enabled={editable} onAdd={(p) => onChange([...polygon, p])} />
        {latlngs.length >= 3 ? <Polygon positions={latlngs} pathOptions={{ color: '#22e3ac', weight: 2, fillOpacity: 0.12 }} /> : null}
        {editable
          ? polygon.map((p, i) => (
              <Marker
                key={`${i}-${polygon.length}`}
                position={[p[1], p[0]]}
                icon={vertexIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => move(i, e.target.getLatLng()),
                  dblclick: () => remove(i),
                }}
              />
            ))
          : null}
        {children}
      </MapContainer>
      {search ? <SearchBar onSelect={setFlyTarget} /> : null}
      {editable ? (
        <div className="polymap-tools glass-panel">
          <span className="small">{polygon.length < 3 ? t('polymap.hint') : t('polymap.points', { count: polygon.length })}</span>
          <CButton size="sm" color="secondary" variant="outline" disabled={!polygon.length} onClick={() => onChange(polygon.slice(0, -1))}>{t('polymap.undo')}</CButton>
          <CButton size="sm" color="secondary" variant="outline" disabled={!polygon.length} onClick={() => onChange([])}>{t('polymap.clear')}</CButton>
        </div>
      ) : null}
    </div>
  )
}
