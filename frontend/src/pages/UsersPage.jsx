import { useCallback, useEffect, useState } from 'react'
import { CButton, CFormCheck, CFormInput, CFormSelect, CAlert } from '@coreui/react'
import { useAuth, ROLE_LABEL_KEYS } from '../auth/AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { listUsers, createUser, updateUser } from '../services/api.js'

const ROLES = ['admin', 'monitor', 'gestor', 'piloto']
const EMPTY_FORM = { fullName: '', email: '', password: '', role: 'monitor', sendEmail: true }

function errorMessage(error, fallback) {
  return error?.response?.data?.error || fallback
}

export default function UsersPage() {
  const { t } = useI18n()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers())
    } catch (err) {
      setError(errorMessage(err, t('users.loadError')))
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(event) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    try {
      const result = await createUser(form)
      setForm(EMPTY_FORM)
      setNotice(
        result?.emailSent === true
          ? t('users.createdEmailed')
          : result?.emailSent === false
            ? t('users.createdNoEmail')
            : t('users.created'),
      )
      load()
    } catch (err) {
      setError(errorMessage(err, t('users.saveError')))
    }
  }

  async function patch(id, changes) {
    setError(null)
    setNotice(null)
    try {
      await updateUser(id, changes)
      load()
    } catch (err) {
      setError(errorMessage(err, t('users.saveError')))
    }
  }

  function resetPassword(target) {
    const password = window.prompt(t('users.newPasswordPrompt', { name: target.fullName }))
    if (password) patch(target.id, { password }).then(() => setNotice(t('users.passwordChanged')))
  }

  return (
    <div className="page-scroll">
      <div className="page-content">
        <header className="page-header">
          <span className="page-eyebrow">{t('nav.users')}</span>
          <h1>{t('users.title')}</h1>
          <p>{t('users.subtitle')}</p>
        </header>

        {error && <CAlert color="danger">{error}</CAlert>}
        {notice && <CAlert color="success">{notice}</CAlert>}

        <form className="glass-panel users-form" onSubmit={handleCreate}>
          <h3 className="users-section-title">{t('users.create')}</h3>
          <div className="users-form-grid">
            <div className="users-field">
              <label htmlFor="u-name">{t('users.fullName')}</label>
              <CFormInput
                id="u-name"
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                required
              />
            </div>
            <div className="users-field">
              <label htmlFor="u-email">{t('auth.email')}</label>
              <CFormInput
                id="u-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </div>
            <div className="users-field">
              <label htmlFor="u-pass">{t('users.initialPassword')}</label>
              <CFormInput
                id="u-pass"
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="users-field">
              <label htmlFor="u-role">{t('users.role')}</label>
              <CFormSelect
                id="u-role"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
                options={ROLES.map((role) => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
              />
            </div>
          </div>
          <div className="users-form-actions">
            <CFormCheck
              id="u-send"
              label={t('users.sendEmail')}
              checked={form.sendEmail}
              onChange={(event) => setForm({ ...form, sendEmail: event.target.checked })}
            />
            <CButton type="submit" color="primary">{t('users.create')}</CButton>
          </div>
        </form>

        <div className="glass-panel users-table-wrap">
          <table className="users-table">
            <colgroup>
              <col style={{ width: '19%' }} /><col style={{ width: '24%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '8%' }} /><col style={{ width: '19%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('users.fullName')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('users.role')}</th>
                <th>{t('users.lastLogin')}</th>
                <th>{t('users.active')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id} className={row.active ? '' : 'users-row-inactive'}>
                  <td>{row.fullName}</td>
                  <td>{row.email}</td>
                  <td>
                    <CFormSelect
                      size="sm"
                      value={row.role}
                      disabled={row.id === me.id}
                      onChange={(event) => patch(row.id, { role: event.target.value })}
                      options={ROLES.map((role) => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
                    />
                  </td>
                  <td>{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : '—'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.active}
                      disabled={row.id === me.id}
                      onChange={(event) => patch(row.id, { active: event.target.checked })}
                      aria-label={t('users.active')}
                    />
                  </td>
                  <td>
                    <CButton size="sm" color="secondary" variant="outline" onClick={() => resetPassword(row)}>
                      {t('users.resetPassword')}
                    </CButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
