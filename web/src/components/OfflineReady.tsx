import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db'
import { aliases } from '../lib/idmap'
import { canInstall, install, installHow, watchInstall } from '../lib/install'
import { useNetState } from './ui'

/** When the class was last saved on the phone for use with no network (lib/saveOffline.ts), if ever. */
function useSavedAt(classId: string): number | null | undefined {
  return useLiveQuery(
    async () => {
      for (const id of await aliases(classId)) {
        const at = (await db.cache.get(`offline-saved/${id}`).catch(() => undefined))?.value as number | undefined
        if (at) return at
      }
      return null
    },
    [classId],
  )
}

function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs])
  return now
}

function ago(at: number, now: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const min = Math.round((now - at) / 60_000)
  if (min < 60) return rtf.format(-min, 'minute')
  const h = Math.round(min / 60)
  return h < 24 ? rtf.format(-h, 'hour') : rtf.format(-Math.round(h / 24), 'day')
}

export function useCanInstall(): boolean {
  return useSyncExternalStore(watchInstall, canInstall)
}

/** On a class page: whether the class is on the phone for use with no network, and since when. */
export function ReadyLine({ classId }: { classId: string }) {
  const { t, i18n } = useTranslation()
  const at = useSavedAt(classId)
  const net = useNetState()
  const now = useNow()
  const installable = useCanInstall()
  if (at === undefined || classId.startsWith('local-')) return null // a class made on this phone is on it
  if (at === null) {
    return (
      <p className="mb-3 text-xs text-mute" role="status">
        {net === 'offline' ? t('ready.notSaved') : t('ready.saving')}
      </p>
    )
  }
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-2 text-xs font-medium text-leaf-deep" role="status">
      <span>✓ {t('ready.done', { when: ago(at, now, i18n.language) })}</span>
      {installable && (
        <button onClick={() => void install()} className="font-semibold text-brand underline underline-offset-2">
          {t('install.button')}
        </button>
      )}
    </p>
  )
}

/** On "My classes": a small tick for a class that is on the phone for use with no network. */
export function ReadyTag({ classId }: { classId: string }) {
  const { t } = useTranslation()
  const at = useSavedAt(classId)
  if (!at) return null
  return (
    <span className="ml-1 whitespace-nowrap text-xs font-medium text-leaf-deep" title={t('ready.tagHelp')}>
      ✓ {t('ready.tag')}
    </span>
  )
}

const DISMISSED = 'levelos.installDismissed'

/** "Add LevelOS to your home screen", once, until the teacher installs it or says not now. */
/** The iPhone's Share icon (a box with an arrow up), as the teacher will see it on their screen. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-4 w-4 align-[-2px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" strokeLinecap="round" />
    </svg>
  )
}

/** "Add LevelOS to your home screen", once, until the teacher installs it or says not now. Chromium shows its own
 * prompt from the button; WebKit (Safari, and every browser on iPhone and iPad) lets no page start an install, so
 * there, as on Firefox for Android and Safari on a Mac, the card shows the browser's own two steps. */
export function InstallCard() {
  const { t } = useTranslation()
  const how = useSyncExternalStore(watchInstall, installHow)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === '1'
    } catch {
      return false
    }
  })
  if (!how || dismissed) return null
  const later = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      /* asked again next time */
    }
  }
  const steps: Record<Exclude<typeof how, 'prompt' | null>, [ReactNode, string]> = {
    ios: [<>{t('install.ios1')} <ShareIcon /></>, t('install.ios2')],
    mac: [t('install.mac1'), t('install.mac2')],
    firefox: [`${t('install.ff1')} ⋮`, t('install.ff2')],
  }
  return (
    <section className="mb-3 flex items-start gap-3 rounded-2xl bg-brand-soft px-4 py-3" role="note">
      <span className="text-2xl" aria-hidden>
        📲
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-brand-deep">{t('install.title')}</div>
        <div className="text-xs text-ink">{t(how === 'ios' ? 'install.iosWhy' : 'install.why')}</div>
        {how !== 'prompt' && (
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-ink">
            <li>{steps[how][0]}</li>
            <li>{steps[how][1]}</li>
          </ol>
        )}
        <div className="mt-2 flex gap-3">
          {how === 'prompt' && (
            <button onClick={() => void install()} className="rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white">
              {t('install.button')}
            </button>
          )}
          <button onClick={later} className="text-sm text-mute underline underline-offset-2">
            {t(how === 'prompt' ? 'install.later' : 'install.gotIt')}
          </button>
        </div>
      </div>
    </section>
  )
}
