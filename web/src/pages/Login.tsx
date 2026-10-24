import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, OfflineError } from '../api'
import { Button, Page } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { t } = useTranslation()
  const { teacher, login } = useAuth()
  const navigate = useNavigate()
  const [loginId, setLoginId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)

  // The free API server sleeps when idle, and the first request can take up to a minute to wake it.
  useEffect(() => {
    if (!busy) {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 4000)
    return () => window.clearTimeout(timer)
  }, [busy])

  if (teacher) return <Navigate to="/" replace />

  const submit = async (id: string, p: string) => {
    setBusy(true)
    setError(null)
    try {
      await login(id, p)
      navigate('/', { replace: true })
    } catch (e) {
      // Only a 401 means a wrong login or PIN; a blocked or failed request must not look like one.
      setError(
        e instanceof ApiError && e.status === 401
          ? t('login.wrong')
          : e instanceof OfflineError
            ? t('login.unreachable')
            : t('login.serverError'),
      )
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(loginId, pin)
  }

  return (
    <Page>
      <p className="text-slate-600">{t('tagline')}</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{t('login.title')}</h2>
        <label className="block">
          <span className="text-sm text-slate-600">{t('login.loginId')}</span>
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            className="mt-1 w-full rounded-lg border px-3 py-3 text-lg"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">{t('login.pin')}</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            minLength={4}
            maxLength={12}
            className="mt-1 w-full rounded-lg border px-3 py-3 text-lg tracking-widest"
            required
          />
        </label>
        {busy && slow && <p className="text-sm text-slate-600">{t('login.waking')}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {t('login.submit')}
        </Button>
      </form>
      <div className="mt-6 text-center">
        <Button kind="secondary" onClick={() => void submit('demo', '1234')} disabled={busy}>
          {t('login.tryDemo')}
        </Button>
        <p className="mt-2 text-xs text-slate-500">{t('login.demoHint')}</p>
      </div>
    </Page>
  )
}
