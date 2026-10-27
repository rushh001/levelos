import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Api, ApiError } from '../api'
import { Celebration } from '../components/Celebration'
import { Ladder } from '../components/Ladder'
import { MeaningCheck, meaningWords } from '../components/MeaningCheck'
import { RecordControls } from '../components/RecordControls'
import { ReviewPanel } from '../components/ReviewPanel'
import { SayToChild } from '../components/SayToChild'
import { SoundToggle } from '../components/SoundToggle'
import { TapToMark } from '../components/TapToMark'
import { Button, ErrorBox, Page, ReadingCard, Spinner } from '../components/ui'
import type { Checkin as CheckinT, ItemPublic, Level, UploadResult } from '../lib/types'
import { useUiFollows } from '../lib/readingLang'
import { useAsync } from '../lib/useAsync'
import { useRecorder } from '../lib/useRecorder'

const LEVELS: Level[] = ['beginner', 'letter', 'word', 'paragraph', 'story']

type Notice = { kind: 'info' | 'warn' | 'ok'; text: string } | null

export default function Checkin() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: checkin, setData: setCheckin, error, reload } = useAsync(() => Api.checkin(id), [id])
  useUiFollows(checkin?.language) // the interface is in the language of the test on screen
  const recorder = useRecorder()
  const [busy, setBusy] = useState<null | 'upload' | 'finish' | 'save'>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [tapMode, setTapMode] = useState(false)
  const [notPlaced, setNotPlaced] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)
  const [celebrate, setCelebrate] = useState<number | null>(null) // the card number being cheered
  const [meaning, setMeaning] = useState<{ itemResultId: string; words: string[] } | null>(null) // the picture step

  const item = checkin?.next_item ?? null
  const position = (checkin?.items.length ?? 0) + 1

  // A finished check-in goes to its result; a completed ladder is finished automatically — after the cheer and
  // the meaning step.
  useEffect(() => {
    if (!checkin || celebrate !== null || meaning) return
    if (checkin.status !== 'in_progress') {
      navigate(`/result/${checkin.id}`, { replace: true })
      return
    }
    if (!checkin.next_item && !checkin.awaiting_review && checkin.items.length > 0 && !busy && !notPlaced) {
      void finish(checkin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin, celebrate, meaning])

  const finish = async (c: CheckinT) => {
    setBusy('finish')
    try {
      const done = await Api.finish(c.id)
      navigate(`/result/${done.id}`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNotPlaced(true)
      else setActionError(e as Error)
    } finally {
      setBusy(null)
    }
  }

  const applyResult = (r: UploadResult, it: ItemPublic) => {
    if (r.status === 'rerecord') {
      setNotice({ kind: 'warn', text: t(`checkin.rerecord.${r.reason ?? 'bad_audio'}`) })
    } else if (r.status === 'failed') {
      setNotice({ kind: 'warn', text: t('checkin.failed') })
      setTapMode(true)
    } else if (r.item_result) {
      const c = r.item_result.result.counts
      setNotice({
        kind: r.item_result.passed ? 'ok' : 'info',
        text: `${t(`itemLevel.${it.level}`)} · ${t(r.item_result.passed ? 'checkin.passed' : 'checkin.notPassed', c)}`,
      })
      setTapMode(false)
      setCelebrate(position)
      // After a word card: the meaning step, when enough of its words have pictures.
      if (it.level === 'word' && meaningWords(it.units ?? [], r.checkin.language).length) {
        setMeaning({ itemResultId: r.item_result.id, words: it.units ?? [] })
      }
    }
    setCheckin(r.checkin)
  }

  // The step stays open until the server has the answers, so the ladder cannot finish past them.
  const saveMeaning = async (answers: { word: string; correct: boolean }[]) => {
    const m = meaning
    if (!checkin || !m || busy) return
    if (answers.length === 0) {
      setMeaning(null)
      return
    }
    setBusy('save')
    try {
      setCheckin(await Api.meaning(checkin.id, m.itemResultId, answers))
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(null)
      setMeaning(null)
    }
  }

  const record = async () => {
    if (!checkin || !item) return
    setNotice(null)
    setActionError(null)
    const clip = await recorder.start()
    if (!clip) return
    setBusy('upload')
    try {
      applyResult(await Api.uploadItem(checkin.id, item.id, clip.blob, clip.mime), item)
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(null)
    }
  }

  const saveMarks = async (marks: boolean[]) => {
    if (!checkin || !item) return
    setBusy('save')
    try {
      applyResult(await Api.markItem(checkin.id, item.id, marks), item)
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(null)
    }
  }

  const stopCheck = async () => {
    if (!checkin || !window.confirm(t('checkin.stopConfirm'))) return
    recorder.cancel()
    await Api.abandon(checkin.id)
    navigate(`/student/${checkin.student_id}`, { replace: true })
  }

  const setLevel = async (level: Level) => {
    if (!checkin) return
    const done = await Api.override(checkin.id, level)
    navigate(`/result/${done.id}`, { replace: true })
  }

  if (!checkin) {
    return <Page back>{error ? <ErrorBox error={error} onRetry={reload} /> : <Spinner label={t('loading')} />}</Page>
  }

  return (
    <Page
      title={item ? t('checkin.item', { n: position }) : undefined}
      tag={t('readingTest.tag', { language: t(`lang.${checkin.language}`, { defaultValue: checkin.language }) })}
      back={`/student/${checkin.student_id}`}
      wide
    >
      {celebrate !== null && <Celebration lang={checkin.language} n={celebrate} onDone={() => setCelebrate(null)} />}

      <div className="mb-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Ladder items={checkin.items.map((r) => ({ level: r.item_level, passed: r.passed }))} current={item?.level ?? null} />
        </div>
        <SoundToggle className="mb-1" />
      </div>

      {notice && (
        <div
          className={`mb-3 rounded-2xl px-3 py-2 text-sm pop ${
            { ok: 'bg-leaf-soft text-leaf-deep', info: 'bg-white text-mute shadow-card', warn: 'bg-sun-soft text-sun-deep' }[notice.kind]
          }`}
        >
          {notice.text}
        </div>
      )}
      <ErrorBox error={actionError} />

      {busy === 'finish' && <Spinner label={t('checkin.finishing')} />}

      {notPlaced && (
        <section className="card space-y-3">
          <p>{t('checkin.notPlaced')}</p>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <Button key={l} kind="secondary" onClick={() => void setLevel(l)}>
                {t(`level.${l}`)}
              </Button>
            ))}
          </div>
        </section>
      )}

      {checkin.awaiting_review && !meaning && (
        <ReviewPanel
          checkinId={checkin.id}
          items={checkin.items.filter((r) => r.needs_review)}
          onDone={async (marks) => {
            setBusy('save')
            try {
              setCheckin(await Api.review(checkin.id, marks))
              setNotice(null)
            } catch (e) {
              setActionError(e as Error)
            } finally {
              setBusy(null)
            }
          }}
          busy={busy === 'save'}
        />
      )}

      {meaning && celebrate === null && (
        <MeaningCheck words={meaning.words} lang={checkin.language} seed={checkin.items.length} onDone={(a) => void saveMeaning(a)} />
      )}

      {item && !checkin.awaiting_review && !meaning && (
        <>
          <SayToChild item={item} test={checkin.language} />

          <ReadingCard item={item} />

          {tapMode ? (
            <TapToMark item={item} onSave={saveMarks} busy={busy === 'save'} onCancel={() => setTapMode(false)} />
          ) : busy === 'upload' ? (
            <Spinner label={t('checkin.checking')} />
          ) : (
            <RecordControls recorder={recorder} onRecord={() => void record()} onTap={() => setTapMode(true)} />
          )}
        </>
      )}

      {checkin.status === 'in_progress' && (
        <div className="mt-8 text-center">
          <Button kind="danger" onClick={() => void stopCheck()}>
            {t('checkin.stopCheck')}
          </Button>
        </div>
      )}
    </Page>
  )
}
