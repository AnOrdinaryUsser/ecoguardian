import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CButton, CFormCheck, CFormInput, CFormSelect, CFormTextarea, CAlert } from '@coreui/react'
import { useAuth } from '../auth/AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import CellImage from '../components/CellImage.jsx'
import {
  addIncidentNote, getIncident, getIncidentsSummary, listAssignees, listIncidents, notifyIncidentAuthority, updateIncident,
} from '../services/api.js'
import { formatArea, formatDate } from '../services/geoUtils.js'

const STATUSES = ['open', 'notified', 'in_progress', 'resolved', 'dismissed']
const PRIORITIES = ['high', 'medium', 'low']
const TABS = ['active', 'resolved', 'dismissed', 'all']
const CROP_BOX = [0.206, 0.206, 0.794, 0.794]

const isOverdue = (i) => i.plannedCleanupDate && ['open', 'notified', 'in_progress'].includes(i.status) && new Date(i.plannedCleanupDate) < new Date(new Date().toDateString())

function Detail({ id, canEdit, canPlan, assignees, onChanged, onError }) {
  const { t, language } = useI18n()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [note, setNote] = useState('')
  const [report, setReport] = useState({ email: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const d = await getIncident(id)
      setData(d)
      setDraft({
        title: d.incident.title, description: d.incident.description ?? '', status: d.incident.status, priority: d.incident.priority,
        assignedTo: d.incident.assignedTo ?? '', authorityName: d.incident.authorityName ?? '', authorityEmail: d.incident.authorityEmail ?? '',
        plannedCleanupDate: d.incident.plannedCleanupDate ?? '',
      })
      setReport({ email: d.incident.authorityEmail ?? '', message: '' })
    } catch (err) {
      onError(err?.response?.data?.error || t('incidents.loadError'))
    }
  }, [id, onError, t])

  useEffect(() => {
    setData(null)
    setNotice(null)
    load()
  }, [load])

  if (!data || !draft) return <aside className="eg-card incident-detail"><p className="muted">{t('incidents.loading')}</p></aside>
  const inc = data.incident
  const dirty = ['title', 'description', 'status', 'priority', 'authorityName', 'authorityEmail', 'plannedCleanupDate'].some((k) => (draft[k] ?? '') !== (k === 'description' ? inc.description ?? '' : inc[k] ?? '')) || String(draft.assignedTo ?? '') !== String(inc.assignedTo ?? '')
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }))

  async function run(fn, okMessage) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await fn()
      await load()
      await onChanged()
      if (okMessage) setNotice(okMessage(result))
    } catch (err) {
      onError(err?.response?.data?.error || t('incidents.error'))
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(() => updateIncident(id, { ...draft, assignedTo: draft.assignedTo === '' ? null : Number(draft.assignedTo), plannedCleanupDate: draft.plannedCleanupDate || null }), () => t('incidents.saved'))
  const addNote = () => run(async () => { await addIncidentNote(id, note); setNote('') })
  const sendReport = () => run(() => notifyIncidentAuthority(id, { email: report.email, name: draft.authorityName || undefined, message: report.message || undefined }),
    (r) => (r.sent ? t('incidents.reportSent') : r.reason === 'smtp_not_configured' ? t('incidents.reportNoSmtp') : t('incidents.reportFailed')))

  return (
    <aside className="eg-card incident-detail">
      <div className="incident-thumb">
        {inc.cellImagePath ? (
          <CellImage cover path={inc.cellImagePath} bbox={inc.bbox} fallback={<span>{t('review.noImage')}</span>} />
        ) : inc.hasImage ? (
          <CellImage cover path={`/api/detections/${inc.detectionId}/image`} bbox={CROP_BOX} fallback={<span>{t('review.noImage')}</span>} />
        ) : <span className="muted small">{t('review.noImage')}</span>}
      </div>

      <div className="incident-facts">
        <span className="eg-chip">#{inc.id}</span>
        <span className={`pill inc-${inc.status}`}>{t(`incidents.status.${inc.status}`)}</span>
        <span className={`pill prio-${inc.priority}`}>{t(`incidents.priority.${inc.priority}`)}</span>
        {inc.areaM2 ? <span className="eg-chip">{formatArea(inc.areaM2, language)}{inc.sizeClass ? ` · ${t(`size.${inc.sizeClass}`)}` : ''}</span> : null}
        {inc.confidence != null ? <span className="eg-chip">{Math.round(inc.confidence * 100)}%</span> : null}
      </div>
      <div className="incident-links small">
        <Link to={`/?lat=${inc.latitude}&lon=${inc.longitude}`}>{t('review.viewMap')}</Link>
        <a href={`https://www.google.com/maps?q=${inc.latitude},${inc.longitude}`} target="_blank" rel="noreferrer">Google Maps</a>
        {canPlan ? <Link to={`/rutas?lat=${inc.latitude}&lon=${inc.longitude}&name=${encodeURIComponent(inc.title)}`}>{t('incidents.planFlight')}</Link> : null}
        <span className="muted">{inc.latitude.toFixed(5)}, {inc.longitude.toFixed(5)}</span>
      </div>
      {inc.nearestLegalName ? <p className="small muted">{t('review.nearestLegal')}: {inc.nearestLegalName} ({Math.round(inc.nearestLegalDistanceM)} m)</p> : null}

      <section className="eg-section">
        <div className="eg-field"><label>{t('incidents.fTitle')}</label><CFormInput value={draft.title} onChange={set('title')} disabled={!canEdit} /></div>
        <div className="eg-grid eg-grid-2">
          <div className="eg-field">
            <label>{t('incidents.fStatus')}</label>
            <CFormSelect value={draft.status} onChange={set('status')} disabled={!canEdit}>{STATUSES.map((s) => <option key={s} value={s}>{t(`incidents.status.${s}`)}</option>)}</CFormSelect>
          </div>
          <div className="eg-field">
            <label>{t('incidents.fPriority')}</label>
            <CFormSelect value={draft.priority} onChange={set('priority')} disabled={!canEdit}>{PRIORITIES.map((p) => <option key={p} value={p}>{t(`incidents.priority.${p}`)}</option>)}</CFormSelect>
          </div>
          <div className="eg-field">
            <label>{t('incidents.fAssigned')}</label>
            <CFormSelect value={draft.assignedTo} onChange={set('assignedTo')} disabled={!canEdit}>
              <option value="">{t('incidents.unassigned')}</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </CFormSelect>
          </div>
          <div className="eg-field"><label>{t('incidents.fCleanup')}</label><CFormInput type="date" value={draft.plannedCleanupDate} onChange={set('plannedCleanupDate')} disabled={!canEdit} /></div>
          <div className="eg-field"><label>{t('incidents.fAuthority')}</label><CFormInput value={draft.authorityName} onChange={set('authorityName')} disabled={!canEdit} placeholder={t('incidents.authorityPlaceholder')} /></div>
          <div className="eg-field"><label>{t('incidents.fAuthorityEmail')}</label><CFormInput type="email" value={draft.authorityEmail} onChange={set('authorityEmail')} disabled={!canEdit} /></div>
        </div>
        <div className="eg-field"><label>{t('incidents.fDescription')}</label><CFormTextarea rows={2} value={draft.description} onChange={set('description')} disabled={!canEdit} /></div>
        {canEdit ? (
          <div className="eg-card-foot">
            <CButton color="primary" size="sm" disabled={busy || !dirty} onClick={save}>{t('incidents.save')}</CButton>
          </div>
        ) : null}
        {notice ? <CAlert color="success" className="mt-2 mb-0 py-2">{notice}</CAlert> : null}
      </section>

      {canEdit ? (
        <section className="eg-section">
          <h3>{t('incidents.notifyTitle')}</h3>
          <p className="small muted">{t('incidents.notifyHint')}</p>
          <div className="eg-field"><label>{t('incidents.fAuthorityEmail')}</label><CFormInput type="email" value={report.email} onChange={(e) => setReport((r) => ({ ...r, email: e.target.value }))} /></div>
          <div className="eg-field"><label>{t('incidents.fMessage')}</label><CFormTextarea rows={2} value={report.message} onChange={(e) => setReport((r) => ({ ...r, message: e.target.value }))} placeholder={t('incidents.messagePlaceholder')} /></div>
          <div className="eg-card-foot"><CButton size="sm" color="secondary" variant="outline" disabled={busy || !report.email} onClick={sendReport}>{t('incidents.sendReport')}</CButton></div>
        </section>
      ) : null}

      <section className="eg-section">
        <h3>{t('incidents.timeline')}</h3>
        {canEdit ? (
          <div className="incident-note">
            <CFormInput value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('incidents.notePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && note.trim() && addNote()} />
            <CButton size="sm" color="primary" disabled={busy || !note.trim()} onClick={addNote}>{t('incidents.addNote')}</CButton>
          </div>
        ) : null}
        <ol className="incident-timeline">
          {data.events.map((e) => (
            <li key={e.id} className={`kind-${e.kind}`}>
              <span className="tl-dot" />
              <div>
                <div className="small">{e.message}</div>
                <div className="muted tiny">{formatDate(e.createdAt, language)}{e.userName ? ` · ${e.userName}` : ''}</div>
              </div>
            </li>
          ))}
        </ol>
        {data.notifications.length ? (
          <>
            <h3>{t('incidents.sentEmails')}</h3>
            <ul className="incident-mails small">
              {data.notifications.map((n, i) => (
                <li key={i}><span className={`pill mail-${n.status}`}>{t(`alerts.status.${n.status}`)}</span> {n.email} <span className="muted">· {formatDate(n.createdAt, language)}</span></li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </aside>
  )
}

export default function IncidentsPage() {
  const { t, language } = useI18n()
  const { hasRole, user } = useAuth()
  const canEdit = hasRole('gestor')
  const canPlan = hasRole('piloto')
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('active')
  const [priority, setPriority] = useState('')
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [error, setError] = useState(null)
  const selected = Number(params.get('id')) || null

  const load = useCallback(async () => {
    try {
      const query = {
        ...(tab === 'active' ? { active: '1' } : tab === 'all' ? {} : { status: tab }),
        ...(priority ? { priority } : {}),
        ...(mine ? { assignedTo: 'me' } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
      }
      const [list, sum] = await Promise.all([listIncidents(query), getIncidentsSummary()])
      setItems(list)
      setSummary(sum)
    } catch (err) {
      setError(err?.response?.data?.error || t('incidents.loadError'))
    }
  }, [tab, priority, mine, q, t])

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  useEffect(() => {
    listAssignees().then(setAssignees).catch(() => {})
  }, [])

  const select = (id) => setParams(id ? { id: String(id) } : {}, { replace: true })
  const kpis = useMemo(
    () => (summary
      ? [
          ['open', summary.byStatus.open], ['notified', summary.byStatus.notified], ['in_progress', summary.byStatus.in_progress],
          ['resolved', summary.byStatus.resolved],
        ]
      : []),
    [summary],
  )

  return (
    <div className="page-scroll incidents-page">
      <header className="page-header">
        <span className="page-eyebrow">{t('nav.incidents')}</span>
        <h1>{t('incidents.title')}</h1>
        <p>{t('incidents.subtitle')}</p>
        {!canEdit ? <p className="muted">{t('incidents.readOnly')}</p> : null}
      </header>

      {summary ? (
        <div className="incident-kpis">
          {kpis.map(([key, n]) => (
            <div key={key} className={`eg-card kpi inc-${key}`}><span className="kpi-n">{n}</span><span className="kpi-l">{t(`incidents.status.${key}`)}</span></div>
          ))}
          <div className="eg-card kpi"><span className="kpi-n">{formatArea(summary.activeAreaM2, language)}</span><span className="kpi-l">{t('incidents.activeArea')}</span></div>
          <div className={`eg-card kpi${summary.overdue ? ' warn' : ''}`}><span className="kpi-n">{summary.overdue}</span><span className="kpi-l">{t('incidents.overdue')}</span></div>
        </div>
      ) : null}

      {error ? <CAlert color="danger" dismissible onClose={() => setError(null)}>{error}</CAlert> : null}

      <div className="review-toolbar">
        <div className="review-tabs" role="tablist">
          {TABS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={`review-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
              {t(`incidents.tab.${key}`)}
            </button>
          ))}
        </div>
        <CFormSelect size="sm" value={priority} onChange={(e) => setPriority(e.target.value)} className="review-filter">
          <option value="">{t('incidents.allPriorities')}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t(`incidents.priority.${p}`)}</option>)}
        </CFormSelect>
        <CFormCheck id="inc-mine" label={t('incidents.mine')} checked={mine} onChange={(e) => setMine(e.target.checked)} />
        <CFormInput size="sm" className="incident-search" placeholder={t('incidents.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className={`incidents-layout${selected ? ' has-detail' : ''}`}>
        <div className="incident-list">
          {items.length === 0 ? <p className="muted">{t('incidents.empty')}</p> : null}
          {items.map((i) => (
            <button key={i.id} type="button" className={`eg-card incident-row${selected === i.id ? ' selected' : ''}`} onClick={() => select(i.id)}>
              <span className={`prio-bar prio-${i.priority}`} aria-hidden="true" />
              <div className="incident-row-main">
                <strong>{i.title}</strong>
                <div className="muted small">
                  {i.latitude.toFixed(4)}, {i.longitude.toFixed(4)} · {formatDate(i.createdAt, language, false)}
                  {i.assignedName ? ` · ${i.assignedName}` : user && i.assignedTo === user.id ? '' : ` · ${t('incidents.unassigned')}`}
                </div>
              </div>
              <div className="incident-row-meta">
                {isOverdue(i) ? <span className="pill prio-high">{t('incidents.overdueTag')}</span> : null}
                {i.areaM2 ? <span className="eg-chip">{formatArea(i.areaM2, language)}</span> : null}
                <span className={`pill inc-${i.status}`}>{t(`incidents.status.${i.status}`)}</span>
              </div>
            </button>
          ))}
        </div>
        {selected ? <Detail key={selected} id={selected} canEdit={canEdit} canPlan={canPlan} assignees={assignees} onChanged={load} onError={setError} /> : (
          <aside className="eg-card incident-detail empty"><p className="muted">{t('incidents.pick')}</p></aside>
        )}
      </div>
    </div>
  )
}
