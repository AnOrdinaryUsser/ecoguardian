import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CFormInput, CButton, CAlert } from '@coreui/react'
import { useI18n } from '../i18n/I18nContext.jsx'
import LoginBackdrop from '../components/LoginBackdrop.jsx'
import { resetPassword } from '../services/api.js'

// Pagina a la que lleva el enlace del correo de recuperacion: /restablecer?token=...
export default function ResetPasswordPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // El token se guarda en memoria y se quita de la barra de direcciones.
  const [token] = useState(() => params.get('token') || '')
  useEffect(() => {
    if (params.get('token')) window.history.replaceState(null, '', '/restablecer')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) return setError(t('auth.passwordShort'))
    if (password !== repeat) return setError(t('auth.passwordMismatch'))
    setSubmitting(true)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err?.response?.data?.error || t('auth.serverError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell">
      <LoginBackdrop />
      <div className="login-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <h1 className="login-title">{t('auth.resetTitle')}</h1>
          {done ? (
            <>
              <CAlert color="success" className="login-error">{t('auth.resetDone')}</CAlert>
              <CButton color="primary" className="login-submit" onClick={() => navigate('/', { replace: true })}>
                {t('auth.backToLogin')}
              </CButton>
            </>
          ) : (
            <>
              <div className="login-field">
                <label htmlFor="rp-1">{t('auth.newPassword')}</label>
                <CFormInput id="rp-1" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              </div>
              <div className="login-field">
                <label htmlFor="rp-2">{t('auth.repeatPassword')}</label>
                <CFormInput id="rp-2" type="password" autoComplete="new-password" minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
              </div>
              {!token && <CAlert color="warning" className="login-error">{t('auth.noToken')}</CAlert>}
              {error && <CAlert color="danger" className="login-error">{error}</CAlert>}
              <CButton type="submit" color="primary" className="login-submit" disabled={submitting || !token}>
                {submitting ? t('auth.sending') : t('auth.savePassword')}
              </CButton>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
