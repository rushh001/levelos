import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Celebration } from '../components/Celebration'
import { Ladder } from '../components/Ladder'
import { MeaningCheck, meaningWords } from '../components/MeaningCheck'
import { RecordControls } from '../components/RecordControls'
import { SayToChild } from '../components/SayToChild'
import { SkipCard } from '../components/SkipCard'
import { SoundToggle } from '../components/SoundToggle'
import { TapToMark } from '../components/TapToMark'
import { Button, LevelBadge, Page, ReadingCard, Spinner } from '../components/ui'
import { db } from '../db'
import { itemPassed, outcomeFromMarks, placedLevel } from '../lib/aser'
import { getItem } from '../lib/content'
import { abandonOffline, addItem, addMeaning, addSkip, finishOffline, nextItem, outcomes } from '../lib/offline'
import { useUiFollows } from '../lib/readingLang'
import type { Level } from '../lib/types'
import { type Clip, useRecorder } from '../lib/useRecorder'

const LEVELS: Level[] = ['beginner', 'letter', 'word', 'paragraph', 'story']

/** A check-in with no network: record (optional) + tap-to-mark per item, ladder run on the phone. */
export default function OfflineCheckin() {
  const { localId = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const c = useLiveQuery(() => db.checkins.get(localId), [localId])
  useUiFollows(c?.language) // the interface is in the language of the test on screen
  const recorder = useRecorder()
  const [clip, setClip] = useState<Clip | null>(null)
  const [marking, setMarking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [celebrate, setCelebrate] = useState<number | null>(null) // the card number being cheered
  const [meaning, setMeaning] = useState<string[] | null>(null) // the picture step's words, after a word card

  const item = c && c.status === 'in_progress' ? nextItem(c) : null
  const placed = c ? placedLevel(outcomes(c)) : null
  // The ladder is complete and places the child: save the provisional level and show the summary (after the cheer
  // and the meaning step).
  const autoFinish = !!c && c.status === 'in_progress' && !item && placed !== null
  useEffect(() => {
    if (autoFinish && celebrate === null && !meaning) void finishOffline(localId)
  }, [autoFinish, localId, celebrate, meaning])

  if (c === undefined) return <Page><Spinner label={t('loading')} /></Page>
  if (c === null || !c) return <Page back="/"><p>{t('error')}</p></Page>

  const back = `/student/${c.studentId}`

  if (c.status !== 'in_progress') {
    return (
      <Page title={`${c.avatar} ${c.studentName}`} back={back}>
        {celebrate !== null && <Celebration lang={c.language} n={celebrate} onDone={() => setCelebrate(null)} />}
        <section className="card">
          <div className="text-sm text-mute">{t('offlineCheck.provisional')}</div>
          <div className="mt-1">
            <LevelBadge level={c.provisionalLevel ?? null} confirmed={false} large />
          </div>
          <p className="mt-3 text-sm text-ink">
            {c.status === 'synced' ? t('offlineCheck.synced') : c.status === 'failed' ? t('offlineCheck.failed') : t('offlineCheck.savedNote')}
          </p>
        </section>
        <ul className="mt-4 space-y-2 stagger">
          {c.items.map((it, k) => {
            const o = it.skipped ? null : outcomeFromMarks(it.level, it.marks, it.durationMs, c.language)
            return (
              <li key={k} className="flex justify-between rounded-2xl bg-white px-4 py-2 text-sm shadow-card">
                <span>{t(`itemLevel.${it.level}`)} {it.clipId ? '🎤' : ''}</span>
                <span className={o ? '' : 'text-mute'}>
                  {o ? `${o.correct}/${o.total}` : t('result.skipped')}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="mt-6 text-center">
          <Link to={`/class/${c.classId}`} className="font-semibold text-brand underline underline-offset-4">
            {t('result.backToClass')}
          </Link>
        </div>
      </Page>
    )
  }

  if (meaning && celebrate === null) {
    return (
      <Page title={`${c.avatar} ${c.studentName}`} back={back} wide>
        <MeaningCheck
          words={meaning}
          lang={c.language}
          seed={c.items.length}
          onDone={(a) => {
            setMeaning(null)
            if (a.length) void addMeaning(c.localId, a)
          }}
        />
      </Page>
    )
  }

  if (!item) {
    if (autoFinish) {
      return (
        <Page>
          {celebrate !== null && <Celebration lang={c.language} n={celebrate} onDone={() => setCelebrate(null)} />}
          <Spinner label={t('checkin.finishing')} />
        </Page>
      )
    }
    return (
      <Page title={`${c.avatar} ${c.studentName}`} back={back}>
        <section className="card space-y-3">
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

  const save = async (marks: boolean[]) => {
    setBusy(true)
    const n = c.items.length + 1
    const ask = item.level === 'word' && meaningWords(item.units ?? [], c.language).length ? item.units ?? [] : null
    await addItem(c.localId, item, marks, clip)
    setClip(null)
    setMarking(false)
    setBusy(false)
    setCelebrate(n)
    setMeaning(ask)
  }
  // The teacher skips the card instead of having it read: it counts for nothing; the ladder moves on (or ends).
  const skip = async () => {
    setBusy(true)
    await addSkip(c.localId, item)
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
    <Page
      title={`${t('checkin.item', { n: c.items.length + 1 })} · ${c.studentName}`}
      tag={t('readingTest.tag', { language: t(`lang.${c.language}`, { defaultValue: c.language }) })}
      back={back}
      wide
    >
      {celebrate !== null && <Celebration lang={c.language} n={celebrate} onDone={() => setCelebrate(null)} />}
      <div className="mb-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Ladder items={outcomes(c).map((o) => ({ level: o.level, passed: itemPassed(o), skipped: !!o.skipped }))} current={item.level} />
        </div>
        <SoundToggle className="mb-1" />
      </div>
      <div className="mb-3 rounded-2xl bg-sun-soft px-3 py-2 text-sm text-sun-deep">{t('offlineCheck.banner')}</div>
      {last && lastItem && (
        <div className="mb-3 rounded-2xl bg-white px-3 py-2 text-sm text-mute shadow-card pop">
          {last.skipped
            ? t('checkin.skipped', { level: t(`itemLevel.${last.level}`) })
            : `${t(`itemLevel.${last.level}`)} · ${last.marks.filter(Boolean).length}/${last.marks.length}`}
        </div>
      )}
      <SayToChild item={item} test={c.language} />
      <ReadingCard item={item} />

      {marking ? (
        <>
          <p className="mt-4 text-sm text-ink">{clip ? t('offlineCheck.recorded') : t('offlineCheck.markNow')}</p>
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
      ) : (
        <RecordControls
          recorder={recorder}
          onRecord={() => void record()}
          onTap={() => setMarking(true)}
          hint={t('offlineCheck.recordThenMark')}
          tapLabel={t('offlineCheck.skipRecording')}
        />
      )}
      {!marking && !busy && <SkipCard onSkip={() => void skip()} />}

      <div className="mt-8 text-center">
        <Button kind="danger" onClick={() => void stop()}>
          {t('checkin.stopCheck')}
        </Button>
      </div>
    </Page>
  )
}
