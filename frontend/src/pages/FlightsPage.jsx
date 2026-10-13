import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CButton, CFormInput, CFormSelect, CFormTextarea, CAlert, CProgress } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilCloudUpload, cilMovie, cilLocationPin, cilSend } from '@coreui/icons'
import { useAuth } from '../auth/AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { listFlights, uploadFlight, deleteFlight } from '../services/api.js'

const EMPTY = { name: '', droneModel: 'avata2', notes: '', intervalSeconds: 2, confidence: 0.5, offsetSeconds: 0 }

export default function FlightsPage() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const canUpload = hasRole('piloto')
  const [flights, setFlights] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [video, setVideo] = useState(null)
  const [telemetry, setTelemetry] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setFlights(await listFlights())
    } catch (err) {
      setError(err?.response?.data?.error || t('flights.loadError'))
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  // Mientras haya vuelos en cola/procesando se refresca la lista.
  useEffect(() => {
    if (!flights.some((f) => f.status === 'uploaded' || f.status === 'processing')) return undefined
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [flights, load])

  async function submit(event) {
    event.preventDefault()
    setError(null)
    if (!video || !telemetry) return
    const body = new FormData()
    Object.entries(form).forEach(([k, v]) => body.append(k, v))
    body.append('video', video)
    body.append('telemetry', telemetry)
    setProgress(0)
    try {
      await uploadFlight(body, setProgress)
      setForm(EMPTY)
      setVideo(null)
      setTelemetry(null)
      event.target.reset()
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || t('flights.uploadError'))
    } finally {
      setProgress(null)
    }
  }

  async function remove(flight) {
    if (!window.confirm(t('flights.deleteConfirm'))) return
    try {
      await deleteFlight(flight.id)
      load()
    } catch (err) {
      setError(err?.response?.data?.error || t('flights.loadError'))
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const fileName = (file) => file?.name ?? t('flights.noFile')

  return (
    <div className="page-scroll flights-page">
      <header className="page-header">
        <span className="page-eyebrow">{t('nav.drones')}</span>
        <h1>{t('flights.title')}</h1>
        <p>{t('flights.subtitle')}</p>
      </header>

      {error ? <CAlert color="danger">{error}</CAlert> : null}

      {canUpload ? (
        <form className="eg-card flight-form" onSubmit={submit}>
          <div className="eg-card-head">
            <span className="eg-card-icon"><CIcon icon={cilCloudUpload} size="lg" /></span>
            <div>
              <h2>{t('flights.new')}</h2>
              <p>{t('flights.hint')}</p>
            </div>
          </div>

          <section className="eg-section">
            <h3>{t('flights.secData')}</h3>
            <div className="eg-grid eg-grid-2">
              <div className="eg-field">
                <label htmlFor="f-name">{t('flights.name')}</label>
                <CFormInput id="f-name" value={form.name} onChange={set('name')} required />
              </div>
              <div className="eg-field">
                <label htmlFor="f-drone">{t('flights.drone')}</label>
                <CFormSelect id="f-drone" value={form.droneModel} onChange={set('droneModel')}>
                  <option value="avata2">DJI Avata 2</option>
                  <option value="mini5pro">DJI Mini 5 Pro</option>
                  <option value="otro">Otro</option>
                </CFormSelect>
              </div>
            </div>
          </section>

          <section className="eg-section">
            <h3>{t('flights.secFiles')}</h3>
            <div className="eg-grid eg-grid-2">
              <label className={`eg-drop${video ? ' has-file' : ''}`}>
                <span className="eg-drop-icon"><CIcon icon={cilMovie} size="xl" /></span>
                <span className="eg-drop-title">{t('flights.video')}</span>
                <span className="eg-drop-file">{fileName(video)}</span>
                <span className="eg-drop-btn">{t('flights.chooseFile')}</span>
                <input type="file" accept="video/*" required onChange={(e) => setVideo(e.target.files[0] ?? null)} />
              </label>
              <label className={`eg-drop${telemetry ? ' has-file' : ''}`}>
                <span className="eg-drop-icon"><CIcon icon={cilLocationPin} size="xl" /></span>
                <span className="eg-drop-title">{t('flights.telemetry')}</span>
                <span className="eg-drop-file">{fileName(telemetry)}</span>
                <span className="eg-drop-btn">{t('flights.chooseFile')}</span>
                <input type="file" accept=".srt,.gpx,.csv,.json" required onChange={(e) => setTelemetry(e.target.files[0] ?? null)} />
              </label>
            </div>
          </section>

          <section className="eg-section">
            <h3>{t('flights.secParams')}</h3>
            <div className="eg-grid eg-grid-3">
              <div className="eg-field">
                <label htmlFor="f-int">{t('flights.interval')}</label>
                <CFormInput id="f-int" type="number" min="0.5" max="30" step="0.5" value={form.intervalSeconds} onChange={set('intervalSeconds')} />
                <small>{t('flights.intervalHelp')}</small>
              </div>
              <div className="eg-field">
                <label htmlFor="f-conf">{t('flights.confidence')}</label>
                <CFormInput id="f-conf" type="number" min="0.05" max="0.95" step="0.05" value={form.confidence} onChange={set('confidence')} />
                <small>{t('flights.confidenceHelp')}</small>
              </div>
              <div className="eg-field">
                <label htmlFor="f-off">{t('flights.offset')}</label>
                <CFormInput id="f-off" type="number" step="0.5" value={form.offsetSeconds} onChange={set('offsetSeconds')} />
                <small>{t('flights.offsetHelp')}</small>
              </div>
            </div>
          </section>

          <section className="eg-section">
            <div className="eg-field">
              <label htmlFor="f-notes">{t('flights.notes')}</label>
              <CFormTextarea id="f-notes" rows={2} placeholder={t('flights.notesPlaceholder')} value={form.notes} onChange={set('notes')} />
            </div>
          </section>

          {progress !== null ? <CProgress value={progress} className="mb-3" /> : null}
          <div className="eg-card-foot">
            <CButton type="submit" color="primary" disabled={progress !== null}>
              {progress !== null ? `${t('flights.uploading')} ${progress}%` : t('flights.submit')}
            </CButton>
          </div>
        </form>
      ) : null}

      <h2 className="eg-list-title">{t('nav.drones')} <span className="review-count">{flights.length}</span></h2>
      {flights.length === 0 ? <p className="muted">{t('flights.empty')}</p> : null}
      <div className="flight-list">
        {flights.map((f) => (
          <div key={f.id} className="eg-card flight-row">
            <span className="eg-card-icon"><CIcon icon={cilSend} size="lg" /></span>
            <div className="flight-row-main">
              <Link to={`/drones/${f.id}`} className="flight-row-name">{f.name}</Link>
              <div className="muted small">
                {new Date(f.createdAt).toLocaleString()} · {f.createdByName ?? '—'} · {f.droneModel}
              </div>
              {f.status === 'error' ? <div className="small text-danger">{f.errorMessage}</div> : null}
            </div>
            <div className="flight-meta">
              <span className="eg-chip">{f.framesDone}/{f.framesTotal} {t('flights.frames')}</span>
              <span className="eg-chip">{f.detectionsCount} {t('flights.detections')}</span>
              <span className={`pill flight-${f.status}`}>{t(`flights.status.${f.status}`)}</span>
              {canUpload ? <CButton size="sm" color="danger" variant="ghost" onClick={() => remove(f)}>{t('flights.delete')}</CButton> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
