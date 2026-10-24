import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { InstructionAudio } from '../components/InstructionAudio'
import { TapToMark } from '../components/TapToMark'
import { Button, LevelBadge, Page, ReadingCard, Spinner } from '../components/ui'
import { db } from '../db'
import { outcomeFromMarks, placedLevel } from '../lib/aser'
import { getItem } from '../lib/content'
import { abandonOffline, addItem, finishOffline, nextItem, outcomes } from '../lib/offline'
import type { Level } from '../lib/types'
import { type Clip, useRecorder } from '../lib/useRecorder'

const LEVELS: Level[] = ['beginner', 'letter', 'word', 'paragraph', 'story']

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A check-in with no network: record (optional) + tap-to-mark per item, ladder run on the phone. */
export default function OfflineCheckin() {
  const { localId = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const c = useLiveQuery(() => db.checkins.get(localId), [localId])
  const recorder = useRecorder()
  const [clip, setClip] = useState<Clip | null>(null)
  const [marking, setMarking] = useState(false)
  const [busy, setBusy] = useState(false)

  const item = c && c.status === 'in_progress' ? nextItem(c) : null
  const placed = c ? placedLevel(outcomes(c)) : null
  // The ladder is complete and places the child: save the provisional level and show the summary.
  const autoFinish = !!c && c.status === 'in_progress' && !item && placed !== null
  useEffect(() => {
    if (autoFinish) void finishOffline(localId)
  }, [autoFinish, localId])

  if (c === undefined) return <Page><Spinner label={t('loading')} /></Page>
  if (c === null || !c) return <Page back="/"><p>{t('error')}</p></Page>

  const back = `/student/${c.studentId}`

  if (c.status !== 'in_progress') {
    return (
      <Page title={`${c.avatar} ${c.studentName}`} back={back}>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-600">{t('offlineCheck.provisional')}</div>
          <div className="mt-1">
            <LevelBadge level={c.provisionalLevel ?? null} confirmed={false} large />
          </div>
          <p className="mt-3 text-sm text-slate-700">
            {c.status === 'synced' ? t('offlineCheck.synced') : c.status === 'failed' ? t('offlineCheck.failed') : t('offlineCheck.savedNote')}
          </p>
        </section>
        <ul className="mt-4 space-y-2">
          {c.items.map((it, k) => {
            const o = outcomeFromMarks(it.level, it.marks, it.durationMs)
            return (
              <li key={k} className="flex justify-between rounded-xl bg-white px-4 py-2 text-sm shadow-sm">
                <span>{t(`itemLevel.${it.level}`)} {it.clipId ? '🎤' : ''}</span>
                <span>
                  {o.correct}/{o.total}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="mt-6 text-center">
          <Link to={`/class/${c.classId}`} className="font-semibold text-blue-700 underline">
            {t('result.backToClass')}
          </Link>
        </div>
      </Page>
    )
  }

  if (!item) {
    if (autoFinish) return <Page><Spinner label={t('checkin.finishing')} /></Page>
    return (
      <Page title={`${c.avatar} ${c.studentName}`} back={back}>
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <p>{t('checkin.notPlaced')}</p>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <Button key={l} kind="secondary" onClick={() => void finishOffline(c.localId, l)}>
                {t(`level.${l}`)}
              </Button>
            ))}
          </div>
        </section>
      </Page>
    )
  }

  const lang = c.language === 'hi' ? 'hi' : 'en'
  const save = async (marks: boolean[]) => {
    setBusy(true)
    await addItem(c.localId, item, marks, clip)
    setClip(null)
    setMarking(false)
    setBusy(false)
  }
  const record = async () => {
    const got = await recorder.start()
    if (got) {
      setClip(got)
      setMarking(true)
    }
  }
  const stop = async () => {
    if (window.confirm(t('checkin.stopConfirm'))) {
      recorder.cancel()
      await abandonOffline(c.localId)
      navigate(back, { replace: true })
    }
  }
  const last = c.items[c.items.length - 1]
  const lastItem = last ? getItem(last.itemId) : null

  return (
    <Page title={`${t('checkin.item', { n: c.items.length + 1 })} · ${c.studentName}`} back={back} wide>
      <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('offlineCheck.banner')}</div>
      {last && lastItem && (
        <div className="mb-3 rounded-xl bg-slate-100 p-3 text-sm">
          {t(`itemLevel.${last.level}`)}: {last.marks.filter(Boolean).length}/{last.marks.length}
        </div>
      )}
      <div className="mb-3 rounded-xl bg-blue-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-medium uppercase text-blue-800">{t('checkin.sayToChild')}</div>
            <div className="text-lg">{item.instructions[lang] ?? item.instructions.en}</div>
          </div>
          <InstructionAudio key={item.id} lang={c.language} level={item.level} />
        </div>
      </div>
      <ReadingCard item={item} />

      {marking ? (
        <>
          <p className="mt-4 text-sm text-slate-700">{clip ? t('offlineCheck.recorded') : t('offlineCheck.markNow')}</p>
          <TapToMark
            key={item.id}
            item={item}
            busy={busy}
            onSave={(marks) => void save(marks)}
            onCancel={() => {
              setMarking(false)
              setClip(null)
            }}
          />
        </>
      ) : recorder.state === 'recording' ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-red-700">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
            <span className="font-mono text-lg">{clock(recorder.elapsed)}</span>
          </div>
          <button
            onClick={recorder.stop}
            className="h-20 w-20 rounded-full bg-red-600 text-lg font-bold text-white shadow-lg"
          >
            {t('checkin.stop')}
          </button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col items-center gap-3">
          <p className="text-center text-sm text-slate-600">{t('offlineCheck.recordThenMark')}</p>
          <button
            onClick={() => void record()}
            aria-label={t('checkin.record')}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-700 text-4xl text-white shadow-lg"
          >
            🎤
          </button>
          {recorder.error && (
            <p className="text-center text-sm text-red-700">
              {t(recorder.error === 'permission' ? 'checkin.micPermission' : 'checkin.micUnsupported')}
            </p>
          )}
          <Button kind="ghost" onClick={() => setMarking(true)}>
            {t('offlineCheck.skipRecording')}
          </Button>
        </div>
      )}

      <div className="mt-8 text-center">
        <Button kind="danger" onClick={() => void stop()}>
          {t('checkin.stopCheck')}
        </Button>
      </div>
    </Page>
  )
}
