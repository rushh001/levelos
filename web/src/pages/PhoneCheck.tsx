import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Api, netState } from '../api'
import { Celebration } from '../components/Celebration'
import { Ladder } from '../components/Ladder'
import { MeaningCheck, meaningWords } from '../components/MeaningCheck'
import { RecordControls } from '../components/RecordControls'
import { SayToChild } from '../components/SayToChild'
import { SkipCard } from '../components/SkipCard'
import { SoundToggle } from '../components/SoundToggle'
import { TapToMark } from '../components/TapToMark'
import { Button, ErrorBox, LevelBadge, Page, ReadingCard, Spinner, useNetState } from '../components/ui'
import { db } from '../db'
import { itemPassed, outcomeFromMarks, placedLevel } from '../lib/aser'
import { type ClipCheck, checkClip } from '../lib/audioCheck'
import { getItem } from '../lib/content'
import { abandonOffline, addItem, addMeaning, addSkip, finishOffline, nextItem, outcomes, retryOffline, syncAll } from '../lib/offline'
import { useUiFollows } from '../lib/readingLang'
import type { Level } from '../lib/types'
import { type Clip, useRecorder } from '../lib/useRecorder'

const LEVELS: Level[] = ['beginner', 'letter', 'word', 'paragraph', 'story']

/** After this long without the AI's marks, the teacher is asked to mark the card; the marks still fill in if they
 * arrive before the teacher taps anything. */
const AI_PATIENCE_MS = 8_000
/** The AI's request is given up after this (a slow upload of a long story on a weak signal). */
const AI_GIVE_UP_MS = 45_000

/** What the AI is doing for the card on screen. */
type AiState =
  | { kind: 'off' } // no recording, or no network: the teacher marks
  | { kind: 'waiting'; late: boolean }
  | { kind: 'marked'; wrong: Set<number>; unsure: Set<number>; ai: { scoreJson: string; sig: string } }
  | { kind: 'rerecord'; reason: string } // the AI could not hear it clearly
  // The teacher marks: `why` says so on the screen. touched: they started before the AI answered (theirs stand);
  // notSetUp: this server has no speech keys; unavailable: the speech services did not answer the server;
  // couldNot: the AI could not mark this recording; noAnswer: the network did not bring the AI's answer.
  | { kind: 'failed'; why: 'touched' | 'notSetUp' | 'unavailable' | 'couldNot' | 'noAnswer' }

// Whether this server can mark recordings at all (speech keys set). Asked once; when it cannot, recordings are not
// uploaded for marking and the teacher is told why.
let speechReady: Promise<boolean | null> | null = null
const canAiMark = (): Promise<boolean | null> =>
  (speechReady ??= Api.health().then(
    (h) => Object.values(h.speech_paths ?? {}).some(Boolean),
    () => {
      speechReady = null // ask again next time
      return null
    },
  ))

/**
 * Every reading check runs here, on the phone, with or without network: the ladder, the cards and the level are
 * worked out on the phone, so a weak or vanishing signal never stops a check. Per card:
 *  1. the teacher records the child; the phone measures the recording at once (lib/audioCheck): too short or
 *     silent → record again; else reading time and long pauses;
 *  2. with network, the AI listens meanwhile and its marks fill in for the teacher to confirm; without it, or if
 *     it takes too long, the teacher marks;
 *  3. the phone decides pass/fail and the next card. The check is sent when there is network (lib/offline.ts):
 *     the AI's signed result goes with the teacher's marks, recordings the AI has not heard are scored then.
 */
export default function PhoneCheck() {
  const { localId = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const net = useNetState()
  const c = useLiveQuery(() => db.checkins.get(localId), [localId])
  useUiFollows(c?.language) // the interface is in the language of the test on screen
  const recorder = useRecorder()
  const [clip, setClip] = useState<Clip | null>(null)
  const [measured, setMeasured] = useState<ClipCheck | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [checking, setChecking] = useState(false) // measuring the recording (well under a second)
  const [ai, setAi] = useState<AiState>({ kind: 'off' })
  const touched = useRef(false) // the teacher has tapped a word: the AI's marks no longer replace theirs
  const aiCall = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [celebrate, setCelebrate] = useState<number | null>(null) // the card number being cheered
  const [meaning, setMeaning] = useState<string[] | null>(null) // the picture step's words, after a word card
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null) // the phone could not save (its storage full)

  const item = c && c.status === 'in_progress' ? nextItem(c) : null
  const placed = c ? placedLevel(outcomes(c)) : null
  // The ladder is complete and places the child: save the provisional level and show the summary (after the cheer
  // and the meaning step), and send it at once if there is network.
  const autoFinish = !!c && c.status === 'in_progress' && !item && placed !== null
  useEffect(() => {
    if (autoFinish && celebrate === null && !meaning) void finishOffline(localId).then(() => syncAll())
  }, [autoFinish, localId, celebrate, meaning])

  useEffect(() => () => aiCall.current?.abort(), [])
  // A playable copy of the recording, for the teacher to listen again while marking.
  useEffect(() => {
    if (!clip) return setPlayUrl(null)
    const url = URL.createObjectURL(clip.blob)
    setPlayUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [clip])

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
            {c.status === 'synced'
              ? t('offlineCheck.synced')
              : c.status === 'failed'
                ? t('offlineCheck.notSent')
                : net === 'online'
                  ? t('phoneCheck.sending')
                  : t('offlineCheck.savedNote')}
          </p>
          {c.status === 'failed' && (
            // The server refused it (the child was removed, say): sent again, or removed with its recordings.
            <div className="mt-3 space-y-2">
              {c.error && <p className="break-words text-xs text-mute">{c.error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button kind="secondary" onClick={() => void retryOffline(c.localId)}>
                  {t('offlineCheck.sendAgain')}
                </Button>
                <Button
                  kind="danger"
                  onClick={() => {
                    if (window.confirm(t('offlineCheck.removeConfirm'))) void abandonOffline(c.localId).then(() => navigate(back, { replace: true }))
                  }}
                >
                  {t('offlineCheck.remove')}
                </Button>
              </div>
            </div>
          )}
          {c.status === 'synced' && c.serverId && (
            <Link
              to={`/result/${c.serverId}`}
              className="mt-3 inline-block font-semibold text-brand underline underline-offset-4"
            >
              {t('phoneCheck.seeResult')}
            </Link>
          )}
        </section>
        <ul className="mt-4 space-y-2 stagger">
          {c.items.map((it, k) => {
            const o = it.skipped
              ? null
              : outcomeFromMarks(it.level, it.marks, it.durationMs, c.language, it.hesitations ?? null)
            return (
              <li key={k} className="flex justify-between rounded-2xl bg-white px-4 py-2 text-sm shadow-card">
                <span>
                  {t(`itemLevel.${it.level}`)} {it.clipId || it.audioUploaded ? '🎤' : ''} {it.ai ? '✨' : ''}
                </span>
                <span className={o ? '' : 'text-mute'}>{o ? `${o.correct}/${o.total}` : t('result.skipped')}</span>
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
              <Button key={l} kind="secondary" onClick={() => void finishOffline(c.localId, l).then(() => syncAll())}>
                {t(`level.${l}`)}
              </Button>
            ))}
          </div>
        </section>
      </Page>
    )
  }

  const resetCard = () => {
    aiCall.current?.abort()
    aiCall.current = null
    touched.current = false
    setClip(null)
    setMeasured(null)
    setMarking(false)
    setAi({ kind: 'off' })
  }

  /** The AI listens to the card while the teacher looks at it; its marks fill in if the teacher has not started. */
  const askAi = async (got: Clip) => {
    const ctrl = new AbortController()
    aiCall.current = ctrl
    setAi({ kind: 'waiting', late: false })
    const ready = await Promise.race([canAiMark(), new Promise<null>((r) => window.setTimeout(() => r(null), 1_500))])
    if (ctrl.signal.aborted) return
    if (ready === false) return setAi({ kind: 'failed', why: 'notSetUp' })
    const lateTimer = window.setTimeout(() => {
      if (!ctrl.signal.aborted) setAi((a) => (a.kind === 'waiting' ? { kind: 'waiting', late: true } : a))
    }, AI_PATIENCE_MS)
    Api.scoreCard(item.id, got.blob, got.mime, ctrl.signal, AI_GIVE_UP_MS)
      .then((r) => {
        if (ctrl.signal.aborted) return
        if (r.status === 'scored' && r.score_json && r.sig) {
          if (touched.current) return setAi({ kind: 'failed', why: 'touched' }) // the teacher is marking already: theirs stand
          const wrong = new Set<number>()
          const unsure = new Set<number>()
          r.words.forEach((w, i) => {
            if (w.label !== 'correct' && w.label !== 'self_correct') wrong.add(i)
            if (w.uncertain) unsure.add(i)
          })
          setAi({ kind: 'marked', wrong, unsure, ai: { scoreJson: r.score_json, sig: r.sig } })
        } else if (r.status === 'rerecord') {
          setAi({ kind: 'rerecord', reason: r.reason ?? 'bad_audio' })
        } else setAi({ kind: 'failed', why: r.reason === 'speech_unavailable' ? 'unavailable' : 'couldNot' })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setAi({ kind: 'failed', why: 'noAnswer' })
      })
      .finally(() => window.clearTimeout(lateTimer))
  }

  const record = async () => {
    setNotice(null)
    const got = await recorder.start()
    if (!got) return
    setChecking(true)
    const m = await checkClip(got.blob)
    setChecking(false)
    if (m?.problem) {
      setNotice(t(`checkin.rerecord.${m.problem}`))
      return // the same card: record again
    }
    touched.current = false
    setClip(got)
    setMeasured(m)
    setMarking(true)
    if (netState() !== 'offline') void askAi(got)
    else setAi({ kind: 'off' })
  }

  const save = async (marks: boolean[]) => {
    setBusy(true)
    setSaveError(null)
    const n = c.items.length + 1
    const ask = item.level === 'word' && meaningWords(item.units ?? [], c.language).length ? item.units ?? [] : null
    // The AI's result goes with the marks only if the teacher saw its marks before saving.
    const confirmed = ai.kind === 'marked' ? ai.ai : null
    try {
      await addItem(c.localId, item, marks, clip, measured, confirmed)
      resetCard()
      setCelebrate(n)
      setMeaning(ask)
    } catch (e) {
      setSaveError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  // The teacher skips the card instead of having it read: it counts for nothing; the ladder moves on (or ends).
  const skip = async () => {
    setBusy(true)
    setSaveError(null)
    try {
      await addSkip(c.localId, item)
      resetCard()
    } catch (e) {
      setSaveError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (window.confirm(t('checkin.stopConfirm'))) {
      recorder.cancel()
      resetCard()
      await abandonOffline(c.localId)
      navigate(back, { replace: true })
    }
  }
  const last = c.items[c.items.length - 1]
  const lastItem = last ? getItem(last.itemId) : null

  const markNote = (() => {
    if (!clip) return <p className="text-sm text-ink">{t('offlineCheck.markNow')}</p>
    const line = (text: string, tone = 'text-ink') => <p className={`text-sm ${tone}`}>{text}</p>
    switch (ai.kind) {
      case 'waiting':
        return ai.late ? (
          line(t('phoneCheck.aiLate'), 'text-sun-deep')
        ) : (
          <p className="flex items-center gap-2 text-sm text-brand-deep">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
            {t('phoneCheck.aiListening')}
          </p>
        )
      case 'marked':
        return (
          <div className="space-y-1">
            {line(t('phoneCheck.aiMarked'))}
            {ai.unsure.size > 0 && line(t('phoneCheck.aiUnsure'), 'text-mute')}
          </div>
        )
      case 'rerecord':
        return line(t('phoneCheck.aiRerecord'), 'text-sun-deep')
      case 'failed':
        if (ai.why === 'touched') return line(t('offlineCheck.recorded'))
        return line(t(`phoneCheck.ai_${ai.why}`), 'text-sun-deep')
      default:
        return line(t('offlineCheck.recorded'))
    }
  })()

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
          <Ladder
            items={outcomes(c).map((o) => ({ level: o.level, passed: itemPassed(o), skipped: !!o.skipped }))}
            current={item.level}
          />
        </div>
        <SoundToggle className="mb-1" />
      </div>
      {net !== 'online' && (
        <div className="mb-3 rounded-2xl bg-sun-soft px-3 py-2 text-sm text-sun-deep">
          {t(net === 'slow' ? 'phoneCheck.slowBanner' : 'offlineCheck.banner')}
        </div>
      )}
      {last && lastItem && (
        <div className="mb-3 rounded-2xl bg-white px-3 py-2 text-sm text-mute shadow-card pop">
          {last.skipped
            ? t('checkin.skipped', { level: t(`itemLevel.${last.level}`) })
            : `${t(`itemLevel.${last.level}`)} · ${last.marks.filter(Boolean).length}/${last.marks.length}`}
        </div>
      )}
      <SayToChild item={item} test={c.language} />
      <ReadingCard item={item} />
      <ErrorBox error={saveError} />

      {marking ? (
        <>
          {measured?.readingMs != null && (
            <p className="mt-3 text-xs text-mute">
              {t('offlineCheck.measured', { s: Math.round(measured.readingMs / 1000), n: measured.hesitations })}
            </p>
          )}
          {playUrl && (
            <audio className="mt-2 h-9 w-full" src={playUrl} controls preload="metadata" aria-label={t('phoneCheck.listen')} />
          )}
          <TapToMark
            key={`${item.id}:${ai.kind === 'marked' ? 'ai' : 'own'}`}
            item={item}
            busy={busy}
            initialWrong={ai.kind === 'marked' ? ai.wrong : undefined}
            unsure={ai.kind === 'marked' ? ai.unsure : undefined}
            onTouch={() => {
              touched.current = true
            }}
            note={markNote}
            onSave={(marks) => void save(marks)}
            onCancel={resetCard}
          />
        </>
      ) : checking ? (
        <Spinner label={t('phoneCheck.checkingRecording')} />
      ) : (
        <>
          {notice && <div className="mt-4 rounded-2xl bg-sun-soft px-3 py-2 text-sm text-sun-deep">{notice}</div>}
          <RecordControls
            recorder={recorder}
            onRecord={() => void record()}
            onTap={() => {
              setNotice(null)
              setAi({ kind: 'off' })
              setMarking(true)
            }}
            hint={t('offlineCheck.recordThenMark')}
            tapLabel={t('offlineCheck.skipRecording')}
          />
        </>
      )}
      {!marking && !busy && !checking && <SkipCard onSkip={() => void skip()} />}

      <div className="mt-8 text-center">
        <Button kind="danger" onClick={() => void stop()}>
          {t('checkin.stopCheck')}
        </Button>
      </div>
    </Page>
  )
}
