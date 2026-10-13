import { useEffect, useState } from 'react'
import { CFormInput, CFormCheck, CButton, CAlert, CInputGroup, CInputGroupText } from '@coreui/react'
import { useAuth } from '../auth/AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import LanguageSwitcher from '../components/LanguageSwitcher.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import LoginBackdrop from '../components/LoginBackdrop.jsx'
import { forgotPassword, getAuthProviders } from '../services/api.js'
import { appleCredential, googleCredential } from '../services/socialAuth.js'

function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M3 3l18 18" /> : null}
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM259.1 87.6C286.6 55 284.1 25.4 283.3 15c-24.3 1.4-52.5 16.5-68.6 35.4-17.7 20.8-28.2 46.6-26 73.5 26.3 2 50.3-11.5 70.4-36.3z" />
    </svg>
  )
}

export default function LoginPage() {
  const { login, socialLogin } = useAuth()
  const { t } = useI18n()
  const [mode, setMode] = useState('login') // login | forgot
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [providers, setProviders] = useState({ google: null, apple: null })

  useEffect(() => {
    getAuthProviders().then(setProviders).catch(() => {})
  }, [])

  function switchMode(next) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password, remember)
    } catch (err) {
      const status = err?.response?.status
      setError(
        status === 401
          ? t('auth.badCredentials')
          : status === 429
            ? t('auth.tooManyAttempts')
            : t('auth.serverError'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleForgot(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      await forgotPassword(email)
      setNotice(t('auth.resetSent'))
    } catch (err) {
      setError(err?.response?.status === 429 ? t('auth.tooManyAttempts') : t('auth.serverError'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSocial(provider) {
    setError(null)
    const config = providers[provider]
    if (!config) {
      setError(t('auth.providerOff', { provider: provider === 'google' ? 'Google' : 'Apple' }))
      return
    }
    try {
      const credential = provider === 'google' ? await googleCredential(config) : await appleCredential(config)
      await socialLogin(provider, credential, remember)
    } catch (err) {
      if (err?.response) setError(err.response.data?.error || t('auth.serverError'))
      else if (!/cancel|closed|popup|user_/i.test(String(err?.message ?? ''))) setError(t('auth.socialFailed'))
    }
  }

  return (
    <div className="login-shell">
      <LoginBackdrop />
      <div className="login-wrap">
        {mode === 'login' ? (
          <form className="login-card" onSubmit={handleSubmit}>
            <h1 className="login-title">{t('auth.loginTitle')}</h1>

            <div className="login-field">
              <label htmlFor="login-email">{t('auth.email')}</label>
              <CFormInput
                id="login-email"
                type="email"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div className="login-field">
              <div className="login-label-row">
                <label htmlFor="login-password">{t('auth.password')}</label>
                <button type="button" className="login-link" onClick={() => switchMode('forgot')}>
                  {t('auth.forgot')}
                </button>
              </div>
              <CInputGroup>
                <CFormInput
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth.passwordPlaceholder')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <CInputGroupText
                  as="button"
                  type="button"
                  className="login-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={t('auth.showPassword')}
                  title={t('auth.showPassword')}
                >
                  <EyeIcon off={showPassword} />
                </CInputGroupText>
              </CInputGroup>
            </div>

            <CFormCheck id="login-remember" label={t('auth.remember')} checked={remember} onChange={(e) => setRemember(e.target.checked)} />

            {error && <CAlert color="danger" className="login-error">{error}</CAlert>}

            <CButton type="submit" color="primary" className="login-submit" disabled={submitting}>
              {submitting ? t('auth.signingIn') : t('auth.signIn')}
            </CButton>

            <div className="login-divider"><span>{t('auth.or')}</span></div>

            <div className="login-social">
              <button type="button" className="login-social-btn" onClick={() => handleSocial('google')}>
                <GoogleIcon /> {t('auth.withGoogle')}
              </button>
              <button type="button" className="login-social-btn" onClick={() => handleSocial('apple')}>
                <AppleIcon /> {t('auth.withApple')}
              </button>
            </div>
          </form>
        ) : (
          <form className="login-card" onSubmit={handleForgot}>
            <h1 className="login-title">{t('auth.forgotTitle')}</h1>
            <p className="login-help">{t('auth.forgotHelp')}</p>
            <div className="login-field">
              <label htmlFor="forgot-email">{t('auth.email')}</label>
              <CFormInput
                id="forgot-email"
                type="email"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </div>
            {error && <CAlert color="danger" className="login-error">{error}</CAlert>}
            {notice && <CAlert color="success" className="login-error">{notice}</CAlert>}
            <CButton type="submit" color="primary" className="login-submit" disabled={submitting}>
              {submitting ? t('auth.sending') : t('auth.sendLink')}
            </CButton>
            <button type="button" className="login-link login-back" onClick={() => switchMode('login')}>
              ← {t('auth.backToLogin')}
            </button>
          </form>
        )}

        <p className="login-foot">{t('auth.noAccount')}</p>
        <div className="login-controls">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
