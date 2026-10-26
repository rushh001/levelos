import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, OfflineError } from '../api'
import { Mascot } from '../components/Mascot'
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
      <div className="flex items-center gap-4">
        <Mascot mood={busy ? 'speaking' : 'idle'} size={96} className="shrink-0" />
        <p className="font-display text-2xl leading-snug text-brand-deep" style={{ textWrap: 'balance' }}>
          {t('tagline')}
        </p>
      </div>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4 p-5">
        <h2 className="font-display text-lg text-ink">{t('login.title')}</h2>
        <label className="block">
          <span className="text-sm text-mute">{t('login.loginId')}</span>
          <input
            id="login-id"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            className="field mt-1"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-mute">{t('login.pin')}</span>
          <input
            id="login-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            minLength={4}
            maxLength={12}
            className="field mt-1 tracking-widest"
            required
          />
        </label>
        {busy && slow && <p className="text-sm text-mute">{t('login.waking')}</p>}
        {error && <p className="text-sm text-coral-deep pop">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {t('login.submit')}
        </Button>
      </form>
      <div className="mt-6 text-center">
        <Button kind="secondary" onClick={() => void submit('demo', '1234')} disabled={busy}>
          {t('login.tryDemo')}
        </Button>
        <p className="mt-2 text-xs text-mute">{t('login.demoHint')}</p>
      </div>
    </Page>
  )
}
