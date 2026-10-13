import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { CButton, CFormCheck, CFormInput, CFormSelect, CAlert } from '@coreui/react'
import { useAuth } from '../auth/AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import CellImage from '../components/CellImage.jsx'
import { downloadFile, getDatasetSummary, listReview, reviewCounts, reviewDetection } from '../services/api.js'
import { formatArea } from '../services/geoUtils.js'

const TABS = ['pending', 'confirmed', 'rejected']
const PAGE = 24
// El recorte se hace con 35 % de margen alrededor de la caja: la caja ocupa el centro (1/1.7).
const CROP_BOX = [0.206, 0.206, 0.794, 0.794]

export default function ReviewPage() {
  const { t, language } = useI18n()
  const { hasRole } = useAuth()
  const canReview = hasRole('monitor')
  const canPlan = hasRole('piloto')
  const [tab, setTab] = useState('pending')
  const [source, setSource] = useState('')
  const [includeLegal, setIncludeLegal] = useState(false)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0, rejected: 0 })
  const [notes, setNotes] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [dataset, setDataset] = useState(null)
  const [negatives, setNegatives] = useState(true)
  const [exporting, setExporting] = useState(false)

  const params = useCallback(
    (extra = {}) => ({ source: source || undefined, includeLegal: includeLegal ? '1' : undefined, ...extra }),
    [source, includeLegal],
  )

  const load = useCallback(
    async (offset = 0) => {
      setError(null)
      try {
        const [list, c] = await Promise.all([
          listReview(params({ status: tab, limit: PAGE, offset })),
          reviewCounts(params()),
        ])
        setItems((prev) => (offset ? [...prev, ...list.items] : list.items))
        setTotal(list.total)
        setCounts(c)
      } catch (err) {
        setError(err?.response?.data?.error || t('review.loadError'))
      }
    },
    [params, tab, t],
  )

  useEffect(() => {
    load(0)
  }, [load])

  const datasetParams = useCallback(() => ({ source: source || undefined, negatives: negatives ? '1' : '0' }), [source, negatives])

  useEffect(() => {
    if (!canReview) return
    getDatasetSummary(datasetParams()).then(setDataset).catch(() => setDataset(null))
  }, [canReview, datasetParams, counts])

  async function exportDataset() {
    setExporting(true)
    setError(null)
    try {
      await downloadFile('get', '/api/review/export', { params: datasetParams(), fallbackName: 'ecoguardian-dataset.zip' })
    } catch (err) {
      setError(err?.response?.data?.error || t('review.exportError'))
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!viewing) return undefined
    const onKey = (e) => e.key === 'Escape' && setViewing(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])

  async function decide(item, status) {
    setBusy(true)
    setError(null)
    try {
      await reviewDetection(item.id, status, notes[item.id] || undefined)
      await load(0)
    } catch (err) {
      setError(err?.response?.data?.error || t('review.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-scroll review-page">
      <header className="page-header">
        <span className="page-eyebrow">{t('nav.review')}</span>
        <h1>{t('review.title')}</h1>
        <p>{t('review.subtitle')}</p>
        {!canReview ? <p className="muted">{t('review.readOnly')}</p> : null}
      </header>

      <div className="review-toolbar">
        <div className="review-tabs" role="tablist">
          {TABS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key}
              className={`review-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
              {t(`review.tab.${key}`)} <span className="review-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <CFormSelect size="sm" value={source} onChange={(e) => setSource(e.target.value)} className="review-filter">
          <option value="">{t('review.source.all')}</option>
          <option value="satellite">{t('review.source.satellite')}</option>
          <option value="drone">{t('review.source.drone')}</option>
        </CFormSelect>
        <CFormCheck id="incl-legal" label={t('review.includeLegal')} checked={includeLegal}
          onChange={(e) => setIncludeLegal(e.target.checked)} />
      </div>

      {canReview && dataset ? (
        <div className="eg-card dataset-card">
          <div className="dataset-text">
            <strong>{t('review.dataset.title')}</strong>
            <span className="muted small">{t('review.dataset.hint')}</span>
            <span className="small">
              {t('review.dataset.summary', { images: dataset.images, positive: dataset.positiveImages, negative: dataset.negativeImages })}
              {dataset.skippedPending ? <span className="muted"> · {t('review.dataset.skipped', { count: dataset.skippedPending })}</span> : null}
            </span>
          </div>
          <CFormCheck id="ds-neg" label={t('review.dataset.negatives')} checked={negatives} onChange={(e) => setNegatives(e.target.checked)} />
          <CButton color="primary" size="sm" disabled={exporting || dataset.images === 0} onClick={exportDataset}>
            {exporting ? t('review.dataset.exporting') : t('review.dataset.download')}
          </CButton>
        </div>
      ) : null}

      {error ? <CAlert color="danger">{error}</CAlert> : null}
      {items.length === 0 && !error ? <p className="muted">{t('review.empty')}</p> : null}

      <div className="review-grid">
        {items.map((item) => (
          <article key={item.id} className={`review-card status-${item.reviewStatus}`}>
            <div
              className={`review-thumb${item.cellImagePath || item.hasImage ? ' clickable' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => (item.cellImagePath || item.hasImage) && setViewing(item)}
              onKeyDown={(e) => e.key === 'Enter' && (item.cellImagePath || item.hasImage) && setViewing(item)}
              title={t('review.viewLarge')}
            >
              {item.cellImagePath ? (
                <CellImage cover path={item.cellImagePath} bbox={item.bbox} fallback={<span>{t('review.noImage')}</span>} />
              ) : item.hasImage ? (
                <CellImage cover path={`/api/detections/${item.id}/image`} bbox={CROP_BOX} fallback={<span>{t('review.noImage')}</span>} />
              ) : (
                <span>{t('review.noImage')}</span>
              )}
              <span className={`badge-source ${item.sourceType}`}>
                {t(`review.source.${item.sourceType}`)}
              </span>
            </div>
            <div className="review-body">
              <div className="review-line">
                <strong>{t('review.confidence')}: {Math.round(item.confidence * 100)}%</strong>
                {item.sightings > 1 ? <span className="muted">{item.sightings} {t('review.sightings')}</span> : null}
              </div>
              <div className="muted small">
                {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                {item.positionAccuracy === 'drone_position' ? ` · ${t('review.approx')}` : ''}
              </div>
              <div className="small">
                {t('review.size')}: {item.areaM2 ? <strong>{formatArea(item.areaM2, language)}{item.sizeClass ? ` · ${t(`size.${item.sizeClass}`)}` : ''}</strong> : <span className="muted">{t('review.sizeUnknown')}</span>}
                {item.areaM2 && item.sourceType === 'drone' ? <span className="muted"> ({t('review.approx')})</span> : null}
              </div>
              <div className="muted small">
                {t('review.nearestLegal')}: {item.nearestLegalName
                  ? `${item.nearestLegalName} (${Math.round(item.nearestLegalDistanceM)} m)` : t('review.none')}
              </div>
              <div className="review-links small">
                <Link to={`/?lat=${item.latitude}&lon=${item.longitude}`}>{t('review.viewMap')}</Link>
                {item.flightId ? <Link to={`/drones/${item.flightId}`}>{t('review.viewFlight')}: {item.flightName}</Link> : null}
                {item.incidentId ? <Link to={`/incidencias?id=${item.incidentId}`}>{t('review.viewIncident')} #{item.incidentId}</Link> : null}
                {canPlan && item.reviewStatus === 'confirmed' ? <Link to={`/rutas?lat=${item.latitude}&lon=${item.longitude}`}>{t('review.planFlight')}</Link> : null}
              </div>

              {item.reviewStatus !== 'pending' ? (
                <div className="small">
                  <span className={`pill ${item.reviewStatus}`}>{t(`review.status.${item.reviewStatus}`)}</span>{' '}
                  {item.reviewerName ? `${t('review.by')} ${item.reviewerName}` : null}
                  {item.reviewNote ? <em> — {item.reviewNote}</em> : null}
                </div>
              ) : null}

              {canReview ? (
                <div className="review-actions">
                  {item.reviewStatus === 'pending' ? (
                    <>
                      <CFormInput size="sm" placeholder={t('review.note')} value={notes[item.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))} />
                      <div className="review-buttons">
                        <CButton size="sm" color="success" disabled={busy} onClick={() => decide(item, 'confirmed')}>{t('review.confirm')}</CButton>
                        <CButton size="sm" color="secondary" variant="outline" disabled={busy} onClick={() => decide(item, 'rejected')}>{t('review.reject')}</CButton>
                      </div>
                    </>
                  ) : (
                    <CButton size="sm" color="secondary" variant="ghost" disabled={busy} onClick={() => decide(item, 'pending')}>{t('review.reopen')}</CButton>
                  )}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {viewing ? createPortal(
        <div className="review-modal" role="dialog" aria-modal="true" onClick={() => setViewing(null)}>
          <div className="review-modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="review-modal-close" onClick={() => setViewing(null)} aria-label={t('review.close')}>×</button>
            <div className="review-modal-image">
              {viewing.cellImagePath ? (
                <CellImage
                  path={viewing.cellImagePath}
                  bbox={viewing.bbox}
                  label={`${Math.round(viewing.confidence * 100)}%`}
                  fallback={<span>{t('review.noImage')}</span>}
                />
              ) : (
                <CellImage
                  path={`/api/detections/${viewing.id}/image`}
                  bbox={CROP_BOX}
                  label={`${Math.round(viewing.confidence * 100)}%`}
                />
              )}
            </div>
            <div className="review-modal-info small">
              <strong>{t('review.confidence')}: {Math.round(viewing.confidence * 100)}%</strong>
              {viewing.areaM2 ? <>{' · '}{t('review.size')}: {formatArea(viewing.areaM2, language)}</> : null}
              {' · '}{viewing.latitude.toFixed(5)}, {viewing.longitude.toFixed(5)}
              {' · '}<Link to={`/?lat=${viewing.latitude}&lon=${viewing.longitude}`}>{t('review.viewMap')}</Link>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {items.length < total ? (
        <div className="review-more">
          <CButton color="secondary" variant="outline" onClick={() => load(items.length)}>{t('review.more')}</CButton>
        </div>
      ) : null}
    </div>
  )
}
