import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { syncAll } from '../lib/offline'
import { mine } from '../lib/outbox'

interface Change {
  id: string
  method: string
  path: string
  body?: Record<string, unknown>
  owner?: string | null
}

/** A waiting change in the teacher's words. */
function label(c: Change, t: (k: string, o?: Record<string, unknown>) => string): string {
  const b = c.body ?? {}
  if (c.method === 'POST' && c.path === '/classes') return t('pending.newClass', { name: b.name ?? '' })
  if (c.method === 'POST' && /\/students$/.test(c.path)) return t('pending.newChild', { name: b.first_name ?? '' })
  if (c.method === 'PATCH' && c.path.startsWith('/students/')) return t('pending.group')
  if (c.method === 'DELETE' && c.path.startsWith('/classes/')) return t('pending.deleteClass')
  if (c.path.endsWith('/rating')) return t('pending.rating')
  if (c.path.endsWith('/review')) return t('pending.review')
  if (c.path.endsWith('/override')) return t('pending.level')
  if (c.path.endsWith('/audio')) return t('pending.recordings')
  return t('pending.other')
}

/** The ⏳ count in the header; tapped, everything waiting on the phone to be sent, and "Send now". */
export function PendingBadge({ count, online }: { count: number; online: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const checks = useLiveQuery(
    () => (open ? db.checkins.where('status').anyOf('queued', 'failed').filter(mine).sortBy('startedAt') : []),
    [open],
    [],
  )
  const changes = useLiveQuery(
    async () => (open ? (((await db.cache.get('outbox'))?.value as Change[] | undefined) ?? []).filter(mine) : []),
    [open],
    [],
  )
  const send = async () => {
    setSending(true)
    try {
      await syncAll()
    } finally {
      setSending(false)
    }
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-sun-soft px-2 py-0.5 text-xs font-semibold text-sun-deep"
        title={t('pendingUploads', { count })}
        aria-label={t('pendingUploads', { count })}
      >
        ⏳ {count}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 sm:items-center" onClick={() => setOpen(false)}>
          <section
            role="dialog"
            aria-label={t('pending.title')}
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-lift sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-xl text-ink">{t('pending.title')}</h2>
            <p className="mt-1 text-sm text-mute">{online ? t('pending.helpOnline') : t('pending.helpOffline')}</p>
            <ul className="mt-3 divide-y rounded-2xl bg-paper">
              {checks.map((c) => (
                <li key={c.localId}>
                  <Link to={`/check/${c.localId}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="truncate">
                      {c.avatar} {t('pending.check', { name: c.studentName })}
                    </span>
                    <span className={`shrink-0 text-xs ${c.status === 'failed' ? 'text-coral-deep' : 'text-mute'}`}>
                      {c.status === 'failed' ? t('offlineCheck.failedShort') : t('offlineCheck.waiting')}
                    </span>
                  </Link>
                </li>
              ))}
              {changes.map((c) => (
                <li key={c.id} className="px-3 py-2.5 text-sm">
                  {label(c, t)}
                </li>
              ))}
              {!checks.length && !changes.length && <li className="px-3 py-2.5 text-sm text-mute">{t('pending.none')}</li>}
            </ul>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void send()}
                disabled={!online || sending || (!checks.length && !changes.length)}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {sending ? t('pending.sending') : t('pending.sendNow')}
              </button>
              <button onClick={() => setOpen(false)} className="rounded-full px-4 py-2 text-sm text-mute">
                {t('pending.close')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
