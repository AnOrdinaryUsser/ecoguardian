import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import { CButton, CFormInput, CFormSelect, CAlert } from '@coreui/react'
import { useI18n } from '../i18n/I18nContext.jsx'
import PolygonMap from '../components/PolygonMap.jsx'
import {
  deleteFlightPlan, downloadFile, getDroneProfiles, listAreas, listFlightPlans, planRoute, saveFlightPlan,
} from '../services/api.js'
import { formatArea, formatDate, squareAround, toLatLngs } from '../services/geoUtils.js'

const FORMATS = [
  { id: 'kmz', labelKey: 'routes.fmtKmz', hintKey: 'routes.fmtKmzHint' },
  { id: 'litchi', labelKey: 'routes.fmtLitchi', hintKey: 'routes.fmtLitchiHint' },
  { id: 'gpx', labelKey: 'routes.fmtGpx', hintKey: 'routes.fmtGpxHint' },
  { id: 'geojson', labelKey: 'routes.fmtGeojson', hintKey: 'routes.fmtGeojsonHint' },
]
const DEFAULTS = { name: '', droneModel: 'mini5pro', altitude: 100, sidelap: 30, forwardOverlap: 60, speed: '', heading: 'auto' }

export default function RoutesPage() {
  const { t, language } = useI18n()
  const [search] = useSearchParams()
  const [profiles, setProfiles] = useState([])
  const [areas, setAreas] = useState([])
  const [plans, setPlans] = useState([])
  const [form, setForm] = useState(DEFAULTS)
  const [polygon, setPolygon] = useState([])
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState({ key: 0, points: null })

  const loadPlans = useCallback(async () => {
    try {
      setPlans(await listFlightPlans())
    } catch (err) {
      setError(err?.response?.data?.error || t('routes.loadError'))
    }
  }, [t])

  useEffect(() => {
    getDroneProfiles().then(setProfiles).catch(() => {})
    listAreas().then((d) => setAreas(d.areas)).catch(() => {})
    loadPlans()
  }, [loadPlans])

  // Enlace desde una incidencia: /rutas?lat=..&lon=..&name=.. -> ruta de inspección alrededor del punto.
  useEffect(() => {
    const lat = Number(search.get('lat'))
    const lon = Number(search.get('lon'))
    if (!search.get('lat') || !Number.isFinite(lat) || !Number.isFinite(lon)) return
    const poly = squareAround(lon, lat, 60)
    setPolygon(poly)
    setForm((f) => ({ ...f, altitude: 40, name: `${t('routes.inspection')}: ${search.get('name') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`}` }))
    setFocus((x) => ({ key: x.key + 1, points: toLatLngs(poly) }))
  }, [search, t])

  const request = useMemo(
    () => ({
      polygon,
      droneModel: form.droneModel,
      altitude: Number(form.altitude),
      sidelap: Number(form.sidelap),
      forwardOverlap: Number(form.forwardOverlap),
      ...(form.speed !== '' ? { speed: Number(form.speed) } : {}),
      heading: form.heading === 'auto' || form.heading === '' ? 'auto' : Number(form.heading),
    }),
    [polygon, form],
  )

  // Recalcula la ruta al cambiar el area o los parametros.
  useEffect(() => {
    if (polygon.length < 3) {
      setPlan(null)
      return undefined
    }
    const timer = setTimeout(async () => {
      try {
        setPlan(await planRoute(request))
        setError(null)
      } catch (err) {
        setPlan(null)
        setError(err?.response?.data?.error || t('routes.error'))
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [request, polygon.length, t])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const routeLine = useMemo(() => (plan ? plan.waypoints.map((w) => [w.lat, w.lng]) : []), [plan])
  const profile = profiles.find((p) => p.id === form.droneModel)
  const stats = plan?.stats

  async function download(format) {
    setError(null)
    try {
      await downloadFile('post', '/api/flight-plans/export', { body: { ...request, name: form.name || 'ruta-ecoguardian', format }, fallbackName: `ruta.${format}` })
    } catch (err) {
      setError(err?.response?.data?.error || t('routes.error'))
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveFlightPlan({ ...request, name: form.name })
      setNotice(t('routes.saved'))
      await loadPlans()
    } catch (err) {
      setError(err?.response?.data?.error || t('routes.error'))
    } finally {
      setBusy(false)
    }
  }

  function loadPlan(p) {
    setPolygon(p.polygon)
    setForm({ ...DEFAULTS, name: p.name, droneModel: p.params.droneModel, altitude: p.params.altitude, sidelap: p.params.sidelap, forwardOverlap: p.params.forwardOverlap, speed: p.params.speed, heading: p.params.heading })
    setFocus((x) => ({ key: x.key + 1, points: toLatLngs(p.polygon) }))
  }

  function useArea(id) {
    const area = areas.find((a) => a.id === Number(id))
    if (!area) return
    setPolygon(area.polygon)
    if (!form.name) setForm((f) => ({ ...f, name: area.name }))
    setFocus((x) => ({ key: x.key + 1, points: toLatLngs(area.polygon) }))
  }

  return (
    <div className="page-scroll routes-page">
      <header className="page-header">
        <span className="page-eyebrow">{t('nav.routes')}</span>
        <h1>{t('routes.title')}</h1>
        <p>{t('routes.subtitle')}</p>
      </header>
      {error ? <CAlert color="danger" dismissible onClose={() => setError(null)}>{error}</CAlert> : null}
      {notice ? <CAlert color="success" dismissible onClose={() => setNotice(null)}>{notice}</CAlert> : null}

      <div className="routes-layout">
        <section className="eg-card routes-map-card">
          <PolygonMap polygon={polygon} onChange={setPolygon} height={560} fitPoints={focus.points} fitKey={focus.key}>
            {routeLine.length ? <Polyline positions={routeLine} pathOptions={{ color: '#ffd24d', weight: 3 }} /> : null}
            {plan?.waypoints.map((w, i) => (
              <CircleMarker key={w.index} center={[w.lat, w.lng]} radius={i === 0 || i === plan.waypoints.length - 1 ? 7 : 4}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor: i === 0 ? '#2eb85c' : i === plan.waypoints.length - 1 ? '#e55353' : '#ffd24d', fillOpacity: 1 }}>
                <Tooltip>{`${t('routes.waypoint')} ${w.index + 1} · ${w.altitude} m`}</Tooltip>
              </CircleMarker>
            ))}
          </PolygonMap>
        </section>

        <div className="routes-side">
          <section className="eg-card routes-form">
            <div className="eg-card-head"><div><h2>{t('routes.params')}</h2><p>{t('routes.paramsHint')}</p></div></div>
            <div className="eg-field">
              <label>{t('routes.name')}</label>
              <CFormInput value={form.name} onChange={set('name')} placeholder={t('routes.namePlaceholder')} />
            </div>
            {areas.length ? (
              <div className="eg-field">
                <label>{t('routes.fromArea')}</label>
                <CFormSelect value="" onChange={(e) => useArea(e.target.value)}>
                  <option value="">{t('routes.pickArea')}</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </CFormSelect>
              </div>
            ) : null}
            <div className="eg-grid eg-grid-2">
              <div className="eg-field">
                <label>{t('routes.drone')}</label>
                <CFormSelect value={form.droneModel} onChange={set('droneModel')}>
                  {(profiles.length ? profiles : [{ id: 'mini5pro', label: 'DJI Mini 5 Pro' }]).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </CFormSelect>
              </div>
              <div className="eg-field">
                <label>{t('routes.altitude')}</label>
                <CFormInput type="number" min="20" max="120" value={form.altitude} onChange={set('altitude')} />
                <small>{t('routes.altitudeHelp')}</small>
              </div>
              <div className="eg-field">
                <label>{t('routes.sidelap')}</label>
                <CFormInput type="number" min="0" max="80" value={form.sidelap} onChange={set('sidelap')} />
              </div>
              <div className="eg-field">
                <label>{t('routes.forward')}</label>
                <CFormInput type="number" min="0" max="90" value={form.forwardOverlap} onChange={set('forwardOverlap')} />
              </div>
              <div className="eg-field">
                <label>{t('routes.speed')}</label>
                <CFormInput type="number" min="1" max="15" step="0.5" value={form.speed} onChange={set('speed')} placeholder={profile ? String(profile.speed) : ''} />
              </div>
              <div className="eg-field">
                <label>{t('routes.heading')}</label>
                <CFormInput value={form.heading} onChange={set('heading')} placeholder="auto" />
                <small>{t('routes.headingHelp')}</small>
              </div>
            </div>
            {form.droneModel === 'avata2' ? <CAlert color="info" className="mb-0 py-2 small">{t('routes.avataNote')}</CAlert> : null}
          </section>

          <section className="eg-card routes-stats">
            <div className="eg-card-head"><div><h2>{t('routes.summary')}</h2></div></div>
            {!stats ? <p className="muted small">{t('routes.drawHint')}</p> : (
              <>
                <dl className="route-facts">
                  <div><dt>{t('routes.sArea')}</dt><dd>{formatArea(stats.areaM2, language)}</dd></div>
                  <div><dt>{t('routes.sLines')}</dt><dd>{stats.lines}</dd></div>
                  <div><dt>{t('routes.sWaypoints')}</dt><dd>{stats.waypoints}</dd></div>
                  <div><dt>{t('routes.sDistance')}</dt><dd>{(stats.distanceM / 1000).toFixed(2)} km</dd></div>
                  <div><dt>{t('routes.sDuration')}</dt><dd>{stats.durationMin} min</dd></div>
                  <div><dt>{t('routes.sBatteries')}</dt><dd>{stats.batteries}</dd></div>
                  <div><dt>{t('routes.sPhotos')}</dt><dd>~{stats.photos}</dd></div>
                  <div><dt>{t('routes.sInterval')}</dt><dd>{stats.photoIntervalM} m · {stats.photoIntervalS} s</dd></div>
                  <div><dt>{t('routes.sFootprint')}</dt><dd>{stats.footprintM.width}×{stats.footprintM.height} m</dd></div>
                  <div><dt>{t('routes.sSpacing')}</dt><dd>{stats.lineSpacingM} m</dd></div>
                </dl>
                {stats.warnings.map((w) => <CAlert key={w} color="warning" className="py-2 small mb-2">{t(`routes.warn.${w}`, { minutes: stats.batteryMinutes })}</CAlert>)}
                <div className="routes-downloads">
                  {FORMATS.map((f) => (
                    <CButton key={f.id} color="secondary" variant="outline" size="sm" onClick={() => download(f.id)} title={t(f.hintKey)}>{t(f.labelKey)}</CButton>
                  ))}
                  <CButton color="primary" size="sm" disabled={busy || !form.name.trim()} onClick={save}>{t('routes.save')}</CButton>
                </div>
                <p className="small muted routes-legal">{t('routes.legal')}</p>
              </>
            )}
          </section>
        </div>
      </div>

      <h2 className="eg-list-title">{t('routes.saved.title')} <span className="review-count">{plans.length}</span></h2>
      {plans.length === 0 ? <p className="muted">{t('routes.noPlans')}</p> : null}
      <div className="flight-list">
        {plans.map((p) => (
          <div key={p.id} className="eg-card flight-row">
            <div className="flight-row-main">
              <span className="flight-row-name">{p.name}</span>
              <div className="muted small">{formatDate(p.createdAt, language)} · {p.createdByName ?? '—'} · {p.params.droneModel} · {p.params.altitude} m</div>
            </div>
            <div className="flight-meta">
              <span className="eg-chip">{formatArea(p.stats.areaM2, language)}</span>
              <span className="eg-chip">{p.stats.waypoints} {t('routes.sWaypoints').toLowerCase()}</span>
              <span className="eg-chip">{p.stats.durationMin} min</span>
              <CButton size="sm" color="secondary" variant="outline" onClick={() => loadPlan(p)}>{t('routes.load')}</CButton>
              <CButton size="sm" color="danger" variant="ghost" onClick={() => window.confirm(t('routes.deleteConfirm')) && deleteFlightPlan(p.id).then(loadPlans)}>{t('routes.delete')}</CButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
