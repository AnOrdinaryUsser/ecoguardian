import { useCallback, useEffect, useState } from 'react'
import { CButton, CFormCheck, CFormInput, CAlert } from '@coreui/react'
import { useI18n } from '../i18n/I18nContext.jsx'
import {
  createAlertRecipient, deleteAlertRecipient, getAlertLog, listAlertRecipients, sendTestAlert, updateAlertRecipient,
} from '../services/api.js'
import { formatDate } from '../services/geoUtils.js'

const EMPTY = { name: '', email: '', organization: '' }

export default function AlertsPage() {
  const { t, language } = useI18n()
  const [recipients, setRecipients] = useState([])
  const [log, setLog] = useState([])
  const [smtp, setSmtp] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([listAlertRecipients(), getAlertLog()])
      setRecipients(r)
      setLog(l.log)
      setSmtp(l.smtpConfigured)
    } catch (err) {
      setError(err?.response?.data?.error || t('alerts.loadError'))
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  async function act(fn, okMessage) {
    setError(null)
    setNotice(null)
    try {
      const result = await fn()
      if (okMessage) setNotice(okMessage(result))
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || t('alerts.error'))
    }
  }

  const add = (event) => {
    event.preventDefault()
    act(async () => {
      await createAlertRecipient(form)
      setForm(EMPTY)
    })
  }
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="page-scroll alerts-page">
      <header className="page-header">
        <span className="page-eyebrow">{t('nav.alerts')}</span>
        <h1>{t('alerts.title')}</h1>
        <p>{t('alerts.subtitle')}</p>
      </header>

      {!smtp ? <CAlert color="warning">{t('alerts.noSmtp')}</CAlert> : null}
      {error ? <CAlert color="danger" dismissible onClose={() => setError(null)}>{error}</CAlert> : null}
      {notice ? <CAlert color="success" dismissible onClose={() => setNotice(null)}>{notice}</CAlert> : null}

      <div className="alerts-layout">
        <section className="eg-card alerts-recipients">
          <div className="eg-card-head"><div><h2>{t('alerts.recipients')}</h2><p>{t('alerts.recipientsHint')}</p></div></div>
          <form className="alerts-form" onSubmit={add}>
            <CFormInput placeholder={t('alerts.name')} value={form.name} onChange={set('name')} required />
            <CFormInput type="email" placeholder={t('alerts.email')} value={form.email} onChange={set('email')} required />
            <CFormInput placeholder={t('alerts.organization')} value={form.organization} onChange={set('organization')} />
            <CButton type="submit" color="primary">{t('alerts.add')}</CButton>
          </form>
          {recipients.length === 0 ? <p className="muted small">{t('alerts.empty')}</p> : null}
          <ul className="alerts-list">
            {recipients.map((r) => (
              <li key={r.id} className={r.active ? '' : 'off'}>
                <div className="alerts-who">
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.email}{r.organization ? ` · ${r.organization}` : ''}</span>
                </div>
                <CFormCheck id={`rc-${r.id}`} switch label={t('alerts.active')} checked={r.active} onChange={(e) => act(() => updateAlertRecipient(r.id, { active: e.target.checked }))} />
                <CButton size="sm" color="secondary" variant="outline"
                  onClick={() => act(() => sendTestAlert(r.email), (res) => (res.sent ? t('alerts.testSent', { email: r.email }) : res.status === 'not_configured' ? t('alerts.noSmtp') : t('alerts.testFailed')))}>
                  {t('alerts.test')}
                </CButton>
                <CButton size="sm" color="danger" variant="ghost" onClick={() => window.confirm(t('alerts.deleteConfirm')) && act(() => deleteAlertRecipient(r.id))}>{t('alerts.delete')}</CButton>
              </li>
            ))}
          </ul>
          <div className="alerts-rules small muted">
            <strong>{t('alerts.whenTitle')}</strong>
            <ul>
              <li>{t('alerts.when1')}</li>
              <li>{t('alerts.when2')}</li>
              <li>{t('alerts.when3')}</li>
            </ul>
          </div>
        </section>

        <section className="eg-card alerts-log">
          <div className="eg-card-head"><div><h2>{t('alerts.log')}</h2><p>{t('alerts.logHint')}</p></div></div>
          {log.length === 0 ? <p className="muted small">{t('alerts.logEmpty')}</p> : null}
          <ul className="alerts-log-list">
            {log.map((l) => (
              <li key={l.id}>
                <span className={`pill mail-${l.status}`}>{t(`alerts.status.${l.status}`)}</span>
                <div>
                  <div className="small">{l.subject || t(`alerts.kind.${l.kind}`)}</div>
                  <div className="muted tiny">{l.email} · {formatDate(l.createdAt, language)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
