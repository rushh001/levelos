import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, OfflineError } from '../api'
import { db } from '../db'
import { useAuth } from '../lib/auth'
import { nameIn } from '../lib/names'
import type { Cohort, ItemPublic, Level, StudentSummary } from '../lib/types'
import { dateLocale, useUiLang } from '../lib/uiLang'
import { Mascot } from './Mascot'

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

/** `tag`: a short line under the title (which reading test this is), so the title itself keeps the room. The
 * interface language is the reading test's, chosen with the switch on the class and child pages. */
export function Page({
  title,
  tag,
  back,
  children,
  wide,
}: {
  title?: string
  tag?: string
  back?: string | true
  children: ReactNode
  wide?: boolean
}) {
  const { t } = useTranslation()
  const online = useOnline()
  const { teacher, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Reading checks and changes (a class, a child, a group) waiting on the phone for the network.
  const pending = useLiveQuery(
    async () =>
      (await db.checkins.where('status').anyOf('queued', 'failed').count()) +
      (((await db.cache.get('outbox'))?.value as unknown[] | undefined)?.length ?? 0),
    [],
    0,
  )

  return (
    <div className={`mx-auto flex min-h-full flex-col px-4 pb-10 pt-3 ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
      <header className="flex items-center gap-2">
        {back ? (
          <button
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-ink transition active:scale-95 active:bg-brand-soft"
            aria-label={t('back')}
          >
            ←
          </button>
        ) : (
          <Mascot mood="still" size={38} className="shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl leading-tight text-brand-deep">{title ?? t('appName')}</h1>
          {tag && <div className="truncate text-xs font-medium text-mute">{tag}</div>}
        </div>
        {pending > 0 && (
          <span
            className="rounded-full bg-sun-soft px-2 py-0.5 text-xs font-semibold text-sun-deep"
            title={t('pendingUploads', { count: pending })}
          >
            ⏳ {pending}
          </span>
        )}
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            online ? 'text-leaf-deep' : 'bg-sun-soft text-sun-deep'
          }`}
          title={online ? t('online') : t('offline')}
        >
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-leaf' : 'bg-sun'}`} aria-hidden />
          {online ? <span className="sr-only">{t('online')}</span> : t('offline')}
        </span>
        {teacher && (
          <button onClick={logout} className="text-xs text-mute underline underline-offset-2">
            {t('logout')}
          </button>
        )}
      </header>
      <main key={pathname} className="mt-4 flex-1 rise">
        {children}
      </main>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-mute" role="status">
      <Mascot size={64} />
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 rounded-full bg-brand/60 bob" style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }} />
        ))}
      </span>
      {label && <span className="text-sm">{label}</span>}
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
    <div className="rounded-2xl bg-coral-soft p-3 text-sm text-coral-deep pop" title={error.message}>
      <p>{errorText(error, t)}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2">
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
    primary: 'bg-brand text-white shadow-lift active:bg-brand-deep',
    secondary: 'border border-line bg-white text-ink shadow-card active:bg-brand-tint',
    danger: 'border border-coral/40 bg-white text-coral-deep active:bg-coral-soft',
    ghost: 'text-brand underline underline-offset-4',
  }[kind]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-5 py-3 text-base font-semibold transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${styles} ${className}`}
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
      <span className="text-mute">{t('readingTest.label')}</span>
      <div className="inline-flex rounded-full border border-line bg-white p-0.5 shadow-card" role="group" aria-label={t('readingTest.label')}>
        {languages.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            aria-pressed={l === value}
            className={`rounded-full px-3.5 py-1 font-semibold transition ${l === value ? 'bg-brand text-white shadow-card' : 'text-mute'}`}
          >
            {t(`lang.${l}`, { defaultValue: l })}
          </button>
        ))}
      </div>
    </div>
  )
}

export const COHORT_STYLE: Record<Cohort, string> = {
  letter: 'border-amber-200 bg-amber-50',
  word: 'border-sky-200 bg-sky-50',
  paragraph: 'border-emerald-200 bg-emerald-50',
  story: 'border-violet-200 bg-violet-50',
}

/** One glyph per group, in the script the group reads: a letter, a short word, a paragraph of lines, an open book. */
export function CohortIcon({ cohort, lang }: { cohort: Cohort; lang: string }) {
  const glyph: Record<string, [string, string]> = {
    hi: ['अ', 'घर'],
    mr: ['अ', 'घर'],
    en: ['a', 'cat'],
    kn: ['ಅ', 'ಮನೆ'],
    ta: ['அ', 'வீடு'],
    bn: ['অ', 'ঘর'],
  }
  const [letter, word] = glyph[lang] ?? glyph.en
  const tone = {
    letter: 'bg-amber-200 text-amber-900',
    word: 'bg-sky-200 text-sky-900',
    paragraph: 'bg-emerald-200 text-emerald-900',
    story: 'bg-violet-200 text-violet-900',
  }[cohort]
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-semibold ${tone}`} aria-hidden>
      {cohort === 'letter' ? (
        <span className="text-xl">{letter}</span>
      ) : cohort === 'word' ? (
        <span className="text-sm">{word}</span>
      ) : cohort === 'story' ? (
        <svg viewBox="0 0 20 20" width="20" height="20">
          <path d="M10 5c-2-1.5-4.5-1.8-7-1.3v11.6c2.5-.5 5-.2 7 1.3 2-1.5 4.5-1.8 7-1.3V3.7C14.5 3.2 12 3.5 10 5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 5v11.3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width="18" height="18">
          {[4, 8, 12, 16].map((y, i) => (
            <rect key={y} x="3" y={y - 1} width={i === 3 ? 8 : 14} height="2" rx="1" fill="currentColor" />
          ))}
        </svg>
      )}
    </span>
  )
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
  if (!level) return <span className="text-sm text-mute">{t('level.none')}</span>
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${LEVEL_STYLE[level]} ${
        large ? 'px-5 py-2 font-display text-3xl' : 'px-2.5 py-0.5 text-sm'
      } ${confirmed === false ? 'outline-dashed outline-2 outline-offset-2 outline-slate-400' : ''}`}
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
      className={`flex items-center gap-1.5 rounded-full bg-white py-1 pl-1 pr-3 text-sm shadow-card transition active:scale-95 ${
        s.level && !s.level_confirmed ? 'border border-dashed border-slate-400' : 'border border-transparent'
      }`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-paper text-lg leading-none">{s.avatar}</span>
      <span className="font-medium text-ink">{nameIn(s, s.first_name, ui)}</span>
      {s.pending_review && <span className="h-2 w-2 rounded-full bg-sun" aria-hidden />}
    </Link>
  )
}

/** The text the child reads: big, high-contrast, one unit per cell for cards, sentence lines for passages. */
export function ReadingCard({ item }: { item: ItemPublic }) {
  if (item.units) {
    return (
      <div className="grid grid-cols-3 gap-3 rounded-4xl border-2 border-line bg-white p-4 shadow-card sm:grid-cols-5 stagger">
        {item.units.map((u, i) => (
          <div key={i} className="reading-text rounded-2xl bg-paper py-2 text-center font-semibold text-ink">
            {u}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="rounded-4xl border-2 border-line bg-white p-5 shadow-card pop">
      {item.sentences?.map((s, i) => (
        <p key={i} className={`font-medium text-ink ${item.level === 'story' ? 'text-2xl leading-relaxed' : 'reading-text'}`}>
          {s}
        </p>
      ))}
    </div>
  )
}

export function formatDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'short' })
}
