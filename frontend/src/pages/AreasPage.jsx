import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Polygon, Tooltip } from 'react-leaflet'
import { CButton, CFormCheck, CFormInput, CAlert, CProgress } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilClock } from '@coreui/icons'
import { useAuth } from '../auth/AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import PolygonMap from '../components/PolygonMap.jsx'
import { createArea, deleteArea, listAreaRuns, listAreas, runArea, updateArea } from '../services/api.js'
import { formatArea, formatDate, polygonAreaM2, polygonCellEstimate, polygonCenter, toLatLngs } from '../services/geoUtils.js'

const EMPTY = { name: '', intervalDays: 30, confidence: 0.5, runNow: true }

function AreaCard({ area, canEdit, onChanged, onFocus, onError }) {
  const { t, language } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: area.name, intervalDays: area.intervalDays, confidence: area.confidenceThreshold })
  const [runs, setRuns] = useState(null)
  const run = area.lastRun
  const running = run?.status === 'running'
  const center = polygonCenter(area.polygon)

  async function act(fn) {
    try {
      await fn()
      await onChanged()
    } catch (err) {
      onError(err?.response?.data?.error || t('areas.error'))
    }
  }

  async function toggleHistory() {
    if (runs) return setRuns(null)
    try {
      setRuns(await listAreaRuns(area.id))
    } catch (err) {
      onError(err?.response?.data?.error || t('areas.error'))
    }
  }

  const statusKey = running ? 'running' : area.active ? 'active' : 'paused'

  return (
    <article className="eg-card area-card">
      <div className="area-card-head">
        <div className="area-card-title">
          <strong>{area.name}</strong>
          <span className={`pill area-${statusKey}`}>{t(`areas.status.${statusKey}`)}</span>
        </div>
        <div className="area-card-meta muted small">
          {formatArea(area.areaKm2 * 1e6, language)} · {t('areas.cells', { count: area.cellsEstimate ?? 0 })} · {t('areas.every', { days: area.intervalDays })}
        </div>
      </div>

      {running ? (
        <div className="area-progress">
          <CProgress value={run.cellsTotal ? Math.round((run.cellsDone / run.cellsTotal) * 100) : 0} />
          <span className="small muted">{t('areas.progress', { done: run.cellsDone, total: run.cellsTotal })}</span>
        </div>
      ) : null}

      <dl className="area-facts">
        <div><dt>{t('areas.lastRun')}</dt><dd>{area.lastRunAt ? formatDate(area.lastRunAt, language) : t('areas.never')}</dd></div>
        <div><dt>{t('areas.nextRun')}</dt><dd>{area.active && area.nextRunAt ? formatDate(area.nextRunAt, language) : '—'}</dd></div>
        <div>
          <dt>{t('areas.lastResult')}</dt>
          <dd>
            {run && !running
              ? run.status === 'error'
                ? <span className="text-danger">{run.error || t('areas.runError')}</span>
                : <>{t('areas.newFound', { count: run.newDetections })}{run.cellsFailed ? <span className="muted"> · {t('areas.cellsFailed', { count: run.cellsFailed })}</span> : null}</>
              : '—'}
          </dd>
        </div>
        <div><dt>{t('areas.detectionsTotal')}</dt><dd>{area.detectionsTotal}</dd></div>
      </dl>

      {editing ? (
        <div className="eg-grid eg-grid-3 area-edit">
          <div className="eg-field"><label>{t('areas.name')}</label><CFormInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div className="eg-field"><label>{t('areas.interval')}</label><CFormInput type="number" min="1" max="365" value={draft.intervalDays} onChange={(e) => setDraft({ ...draft, intervalDays: e.target.value })} /></div>
          <div className="eg-field"><label>{t('areas.confidence')}</label><CFormInput type="number" min="0.3" max="0.95" step="0.05" value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: e.target.value })} /></div>
          <div className="area-edit-actions">
            <CButton size="sm" color="primary" onClick={() => act(async () => { await updateArea(area.id, { name: draft.name, intervalDays: Number(draft.intervalDays), confidenceThreshold: Number(draft.confidence) }); setEditing(false) })}>{t('areas.save')}</CButton>
            <CButton size="sm" color="secondary" variant="ghost" onClick={() => setEditing(false)}>{t('areas.cancel')}</CButton>
          </div>
        </div>
      ) : null}

      <div className="area-actions">
        <CButton size="sm" color="secondary" variant="outline" onClick={() => onFocus(area)}>{t('areas.showOnMap')}</CButton>
        <Link className="btn btn-sm btn-outline-secondary" to={`/revision`}>{t('areas.review')}</Link>
        <CButton size="sm" color="secondary" variant="ghost" onClick={toggleHistory}><CIcon icon={cilClock} className="me-1" />{t('areas.history')}</CButton>
        {canEdit ? (
          <>
            <CButton size="sm" color="primary" disabled={running} onClick={() => act(() => runArea(area.id))}>{t('areas.runNow')}</CButton>
            <CButton size="sm" color="secondary" variant="ghost" onClick={() => setEditing((v) => !v)}>{t('areas.edit')}</CButton>
            <CButton size="sm" color="secondary" variant="ghost" onClick={() => act(() => updateArea(area.id, { active: !area.active }))}>{area.active ? t('areas.pause') : t('areas.resume')}</CButton>
            <CButton size="sm" color="danger" variant="ghost" onClick={() => window.confirm(t('areas.deleteConfirm')) && act(() => deleteArea(area.id))}>{t('areas.delete')}</CButton>
          </>
        ) : null}
        <a className="small muted area-coords" href={`https://www.google.com/maps?q=${center.lat},${center.lng}`} target="_blank" rel="noreferrer">{center.lat.toFixed(4)}, {center.lng.toFixed(4)}</a>
      </div>

      {runs ? (
        <ul className="area-runs small">
          {runs.length === 0 ? <li className="muted">{t('areas.noRuns')}</li> : null}
          {runs.map((r) => (
            <li key={r.id}>
              <span>{formatDate(r.startedAt, language)}</span>
              <span className="eg-chip">{t(`areas.trigger.${r.trigger}`)}</span>
              <span className={`pill area-run-${r.status}`}>{t(`areas.runStatus.${r.status}`)}</span>
              <span className="muted">{t('areas.runLine', { cells: r.cellsTotal, new: r.newDetections })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

export default function AreasPage() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const canEdit = hasRole('monitor')
  const [areas, setAreas] = useState([])
  const [maxCells, setMaxCells] = useState(400)
  const [form, setForm] = useState(EMPTY)
  const [polygon, setPolygon] = useState([])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [focus, setFocus] = useState({ key: 0, points: null })

  const load = useCallback(async () => {
    try {
      const data = await listAreas()
      setAreas(data.areas)
      setMaxCells(data.maxCells)
    } catch (err) {
      setError(err?.response?.data?.error || t('areas.loadError'))
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  // Mientras se analiza algun area se refresca el progreso.
  const anyRunning = areas.some((a) => a.lastRun?.status === 'running')
  useEffect(() => {
    if (!anyRunning) return undefined
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [anyRunning, load])

  const cells = useMemo(() => polygonCellEstimate(polygon, 18), [polygon])
  const areaM2 = useMemo(() => polygonAreaM2(polygon), [polygon])
  const tooMany = cells > maxCells

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await createArea({
        name: form.name,
        polygon,
        intervalDays: Number(form.intervalDays),
        confidenceThreshold: Number(form.confidence),
        runNow: form.runNow,
      })
      setForm(EMPTY)
      setPolygon([])
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || t('areas.error'))
    } finally {
      setSaving(false)
    }
  }

  function focusArea(area) {
    setFocus((f) => ({ key: f.key + 1, points: toLatLngs(area.polygon) }))
    window.scrollTo?.({ top: 0 })
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="page-scroll areas-page">
      <header className="page-header">
        <span className="page-eyebrow">{t('nav.areas')}</span>
        <h1>{t('areas.title')}</h1>
        <p>{t('areas.subtitle')}</p>
        {!canEdit ? <p className="muted">{t('areas.readOnly')}</p> : null}
      </header>

      {error ? <CAlert color="danger" dismissible onClose={() => setError(null)}>{error}</CAlert> : null}

      <div className={`areas-layout${canEdit ? '' : ' single'}`}>
        <section className="eg-card areas-map-card">
          <PolygonMap
            polygon={polygon}
            onChange={setPolygon}
            editable={canEdit}
            height={520}
            fitPoints={focus.points}
            fitKey={focus.key}
          >
            {areas.map((a) => (
              <Polygon key={a.id} positions={toLatLngs(a.polygon)} pathOptions={{ color: a.active ? '#4da3ff' : '#8a93a0', weight: 2, dashArray: '6 6', fillOpacity: 0.08 }}>
                <Tooltip sticky>{a.name}</Tooltip>
              </Polygon>
            ))}
          </PolygonMap>
        </section>

        {canEdit ? (
          <form className="eg-card areas-form" onSubmit={submit}>
            <div className="eg-card-head">
              <div>
                <h2>{t('areas.new')}</h2>
                <p>{t('areas.newHint')}</p>
              </div>
            </div>
            <div className="eg-field">
              <label htmlFor="a-name">{t('areas.name')}</label>
              <CFormInput id="a-name" value={form.name} onChange={set('name')} placeholder={t('areas.namePlaceholder')} required />
            </div>
            <div className="eg-grid eg-grid-2">
              <div className="eg-field">
                <label htmlFor="a-int">{t('areas.interval')}</label>
                <CFormInput id="a-int" type="number" min="1" max="365" value={form.intervalDays} onChange={set('intervalDays')} />
                <small>{t('areas.intervalHelp')}</small>
              </div>
              <div className="eg-field">
                <label htmlFor="a-conf">{t('areas.confidence')}</label>
                <CFormInput id="a-conf" type="number" min="0.3" max="0.95" step="0.05" value={form.confidence} onChange={set('confidence')} />
                <small>{t('areas.confidenceHelp')}</small>
              </div>
            </div>
            <div className="areas-estimate">
              <span className="eg-chip">{formatArea(areaM2)}</span>
              <span className={`eg-chip${tooMany ? ' danger' : ''}`}>{t('areas.cells', { count: cells })}</span>
              {tooMany ? <small className="text-danger">{t('areas.tooMany', { max: maxCells })}</small> : null}
            </div>
            <CFormCheck id="a-run" label={t('areas.runNowCheck')} checked={form.runNow} onChange={(e) => setForm((f) => ({ ...f, runNow: e.target.checked }))} />
            <div className="eg-card-foot">
              <CButton type="submit" color="primary" disabled={saving || polygon.length < 3 || tooMany || !form.name.trim()}>{t('areas.create')}</CButton>
            </div>
          </form>
        ) : null}
      </div>

      <h2 className="eg-list-title">{t('areas.listTitle')} <span className="review-count">{areas.length}</span></h2>
      {areas.length === 0 ? <p className="muted">{t('areas.empty')}</p> : null}
      <div className="areas-list">
        {areas.map((a) => (
          <AreaCard key={a.id} area={a} canEdit={canEdit} onChanged={load} onFocus={focusArea} onError={setError} />
        ))}
      </div>
    </div>
  )
}
