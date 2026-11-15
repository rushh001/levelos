import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db'
import { aliases } from '../lib/idmap'
import { canInstall, install, watchInstall } from '../lib/install'
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
export function InstallCard() {
  const { t } = useTranslation()
  const installable = useCanInstall()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === '1'
    } catch {
      return false
    }
  })
  if (!installable || dismissed) return null
  const later = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      /* asked again next time */
    }
  }
  return (
    <section className="mb-3 flex items-center gap-3 rounded-2xl bg-brand-soft px-4 py-3">
      <span className="text-2xl" aria-hidden>
        📲
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-brand-deep">{t('install.title')}</div>
        <div className="text-xs text-ink">{t('install.why')}</div>
        <div className="mt-2 flex gap-3">
          <button onClick={() => void install()} className="rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white">
            {t('install.button')}
          </button>
          <button onClick={later} className="text-sm text-mute underline underline-offset-2">
            {t('install.later')}
          </button>
        </div>
      </div>
    </section>
  )
}
