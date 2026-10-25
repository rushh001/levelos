import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, OfflineError } from '../api'
import { db } from '../db'
import { useAuth } from '../lib/auth'
import { nameIn } from '../lib/names'
import { LANG_SHORT, dateLocale, nextUiLang, rememberRegional, setUiLang, useUiLang } from '../lib/uiLang'
import type { Cohort, ItemPublic, Level, StudentSummary } from '../lib/types'

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** `tag`: a short line under the title (which reading test this is), so the title itself keeps the room.
 * `regional`: the language of the class or child on the page; the language button pairs it with English. */
export function Page({
  title,
  tag,
  back,
  children,
  wide,
  regional,
}: {
  title?: string
  tag?: string
  back?: string | true
  children: ReactNode
  wide?: boolean
  regional?: string | null
}) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const online = useOnline()
  const { teacher, logout } = useAuth()
  const navigate = useNavigate()
  const pending = useLiveQuery(() => db.checkins.where('status').anyOf('queued', 'failed').count(), [], 0)
  const next = nextUiLang(ui, regional)
  useEffect(() => rememberRegional(regional), [regional])

  return (
    <div className={`mx-auto flex min-h-full flex-col px-4 pb-10 pt-4 ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
      <header className="flex items-center gap-2">
        {back && (
          <button
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
            className="-ml-2 rounded-full px-2 py-1 text-xl text-slate-600"
            aria-label={t('back')}
          >
            ←
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-blue-700">{title ?? t('appName')}</h1>
          {tag && <div className="truncate text-xs font-medium text-blue-800">{tag}</div>}
        </div>
        {pending > 0 && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
            title={t('pendingUploads', { count: pending })}
          >
            ⏳ {pending}
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            online ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {online ? t('online') : t('offline')}
        </span>
        <button
          onClick={() => setUiLang(next)}
          className="rounded-md border px-2 py-0.5 text-xs"
          aria-label="language"
          title={t(`lang.${next}`, { defaultValue: next })}
        >
          {LANG_SHORT[next] ?? next}
        </button>
        {teacher && (
          <button onClick={logout} className="text-xs text-slate-500 underline">
            {t('logout')}
          </button>
        )}
      </header>
      <main className="mt-4 flex-1">{children}</main>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-slate-600" role="status">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      {label && <span>{label}</span>}
    </div>
  )
}

/** A teacher-facing message for any error, in the interface language; the server's own (English, technical) text
 * stays only as a tooltip for whoever debugs it. */
function errorText(error: Error, t: (key: string) => string): string {
  if (error instanceof OfflineError) return t('errors.offline')
  if (!(error instanceof ApiError)) return t('error')
  const m = error.message
  if (error.status === 401) return t('errors.session')
  if (error.status === 404) return t('errors.notFound')
  if (error.status === 413) return t('errors.tooLong')
  if (error.status >= 500) return t('login.serverError')
  if (/uncertain words/.test(m)) return t('errors.confirmFirst')
  if (/do not place the child/.test(m)) return t('checkin.notPlaced')
  if (/no items were read/.test(m)) return t('errors.nothingRead')
  if (/check-in is |ladder is complete|expected a /.test(m)) return t('errors.checkMoved')
  return t('error')
}

export function ErrorBox({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800" title={error.message}>
      <p>{errorText(error, t)}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-medium underline">
          {t('retry')}
        </button>
      )}
    </div>
  )
}

export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles = {
    primary: 'bg-blue-700 text-white active:bg-blue-800',
    secondary: 'border border-slate-300 bg-white text-slate-800 active:bg-slate-100',
    danger: 'border border-red-300 bg-white text-red-700 active:bg-red-50',
    ghost: 'text-blue-700 underline',
  }[kind]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3 text-base font-semibold disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

/** Which reading test the page shows, when there is more than one (the regional language and English). */
export function ReadingTestSwitch({
  languages,
  value,
  onChange,
}: {
  languages: string[]
  value: string
  onChange: (lang: string) => void
}) {
  const { t } = useTranslation()
  if (languages.length < 2) return null
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">{t('readingTest.label')}</span>
      <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label={t('readingTest.label')}>
        {languages.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            aria-pressed={l === value}
            className={`rounded-md px-3 py-1 font-medium ${l === value ? 'bg-blue-700 text-white' : 'text-slate-700'}`}
          >
            {t(`lang.${l}`, { defaultValue: l })}
          </button>
        ))}
      </div>
    </div>
  )
}

export const COHORT_STYLE: Record<Cohort, string> = {
  letter: 'border-amber-300 bg-amber-50',
  word: 'border-sky-300 bg-sky-50',
  paragraph: 'border-emerald-300 bg-emerald-50',
}

const LEVEL_STYLE: Record<Level, string> = {
  beginner: 'bg-amber-200 text-amber-900',
  letter: 'bg-amber-100 text-amber-900',
  word: 'bg-sky-100 text-sky-900',
  paragraph: 'bg-emerald-100 text-emerald-900',
  story: 'bg-emerald-200 text-emerald-900',
}

export function LevelBadge({ level, confirmed, large }: { level: Level | null; confirmed?: boolean; large?: boolean }) {
  const { t } = useTranslation()
  if (!level) return <span className="text-sm text-slate-500">{t('level.none')}</span>
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${LEVEL_STYLE[level]} ${
        large ? 'px-4 py-1.5 text-2xl' : 'px-2 py-0.5 text-sm'
      } ${confirmed === false ? 'outline-dashed outline-2 outline-offset-1 outline-slate-400' : ''}`}
    >
      {t(`level.${level}`)}
      {confirmed === false && <span aria-label={t('student.provisional')}>?</span>}
    </span>
  )
}

export function ChildChip({ s, to }: { s: StudentSummary; to: string }) {
  const ui = useUiLang()
  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-sm shadow-sm ${
        s.level && !s.level_confirmed ? 'border border-dashed border-slate-400' : 'border border-transparent'
      }`}
    >
      <span className="text-lg leading-none">{s.avatar}</span>
      <span>{nameIn(s, s.first_name, ui)}</span>
      {s.pending_review && <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
    </Link>
  )
}

/** The text the child reads: big, high-contrast, one unit per cell for cards, sentence lines for passages. */
export function ReadingCard({ item }: { item: ItemPublic }) {
  if (item.units) {
    return (
      <div className="grid grid-cols-3 gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 sm:grid-cols-5">
        {item.units.map((u, i) => (
          <div key={i} className="reading-text rounded-xl bg-slate-50 py-2 text-center font-semibold">
            {u}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      {item.sentences?.map((s, i) => (
        <p key={i} className={`font-medium ${item.level === 'story' ? 'text-2xl leading-relaxed' : 'reading-text'}`}>
          {s}
        </p>
      ))}
    </div>
  )
}

export function formatDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'short' })
}
