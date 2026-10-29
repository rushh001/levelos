import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Api, ApiError, OfflineError } from '../api'
import { LangPicker } from '../components/LangPicker'
import { Mascot } from '../components/Mascot'
import { Button, Page } from '../components/ui'
import { useAuth } from '../lib/auth'
import type { Teacher } from '../lib/types'

/**
 * A teacher creates an account with a name, an email and a PIN, and is given a 6-digit login ID. The ID is shown
 * big, once, with a note to write it down; the teacher then goes into the app already logged in.
 */
export default function Signup() {
  const { t, i18n } = useTranslation()
  const { teacher, adopt } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ token: string; teacher: Teacher; login: string } | null>(null)

  if (teacher && !done) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!/^\d{4,8}$/.test(pin)) {
      setError(t('signup.pinDigits'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      setDone(await Api.signup(name, email, pin, i18n.language))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t('signup.emailTaken')
          : err instanceof ApiError && err.status === 422 && /email/i.test(err.message)
            ? t('signup.invalidEmail')
            : err instanceof ApiError && err.status === 422 && /PIN/i.test(err.message)
              ? t('signup.pinDigits')
              : err instanceof OfflineError
                ? t('login.unreachable')
                : t('login.serverError'),
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Page>
        <div className="card mt-4 space-y-4 p-6 text-center pop">
          <Mascot mood="happy" size={96} className="mx-auto" />
          <h2 className="font-display text-2xl text-brand-deep">{t('signup.done')}</h2>
          <div>
            <div className="text-sm text-mute">{t('signup.yourId')}</div>
            <div className="mt-1 select-all font-display text-5xl tracking-[0.25em] text-ink" data-testid="new-login-id">
              {done.login}
            </div>
          </div>
          <p className="rounded-xl bg-sun-soft px-3 py-2 text-sm text-sun-deep">{t('signup.note')}</p>
          <Button
            className="w-full"
            onClick={() => {
              adopt(done.token, done.teacher)
              navigate('/', { replace: true })
            }}
          >
            {t('signup.continue')}
          </Button>
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <LangPicker />
      <form onSubmit={submit} className="card mt-4 space-y-4 p-5">
        <h2 className="font-display text-lg text-ink">{t('signup.title')}</h2>
        <label className="block">
          <span className="text-sm text-mute">{t('signup.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} className="field mt-1" required />
        </label>
        <label className="block">
          <span className="text-sm text-mute">{t('signup.email')}</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            maxLength={254}
            className="field mt-1"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-mute">{t('signup.pin')}</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            minLength={4}
            maxLength={8}
            className="field mt-1 tracking-widest"
            required
          />
        </label>
        {error && <p className="text-sm text-coral-deep pop">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {t('signup.submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-brand underline underline-offset-4">
          {t('signup.have')}
        </Link>
      </p>
    </Page>
  )
}
