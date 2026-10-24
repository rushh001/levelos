import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Api, ApiError } from '../api'
import { InstructionAudio } from '../components/InstructionAudio'
import { ReviewPanel } from '../components/ReviewPanel'
import { TapToMark } from '../components/TapToMark'
import { Button, ErrorBox, Page, ReadingCard, Spinner } from '../components/ui'
import type { Checkin as CheckinT, ItemPublic, Level, UploadResult } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useRecorder } from '../lib/useRecorder'

const LEVELS: Level[] = ['beginner', 'letter', 'word', 'paragraph', 'story']

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Notice = { kind: 'info' | 'warn' | 'ok'; text: string } | null

export default function Checkin() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { data: checkin, setData: setCheckin, error, reload } = useAsync(() => Api.checkin(id), [id])
  const recorder = useRecorder()
  const [busy, setBusy] = useState<null | 'upload' | 'finish' | 'save'>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [tapMode, setTapMode] = useState(false)
  const [notPlaced, setNotPlaced] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)

  const item = checkin?.next_item ?? null
  const position = (checkin?.items.length ?? 0) + 1

  // A finished check-in goes to its result; a completed ladder is finished automatically.
  useEffect(() => {
    if (!checkin) return
    if (checkin.status !== 'in_progress') {
      navigate(`/result/${checkin.id}`, { replace: true })
      return
    }
    if (!checkin.next_item && !checkin.awaiting_review && checkin.items.length > 0 && !busy && !notPlaced) {
      void finish(checkin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin])

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
        text: `${t(`itemLevel.${it.level}`)}: ${t(r.item_result.passed ? 'checkin.passed' : 'checkin.notPassed', c)}`,
      })
      setTapMode(false)
    }
    setCheckin(r.checkin)
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

  const lang = checkin.language === 'hi' ? 'hi' : 'en'
  const uiLang = i18n.language === 'hi' ? 'hi' : 'en'

  return (
    <Page title={item ? t('checkin.item', { n: position }) : undefined} back={`/student/${checkin.student_id}`} wide>
      {notice && (
        <div
          className={`mb-3 rounded-xl p-3 text-sm ${
            { ok: 'bg-green-50 text-green-900', info: 'bg-slate-100 text-slate-800', warn: 'bg-amber-50 text-amber-900' }[notice.kind]
          }`}
        >
          {notice.text}
        </div>
      )}
      <ErrorBox error={actionError} />

      {busy === 'finish' && <Spinner label={t('checkin.finishing')} />}

      {notPlaced && (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
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

      {checkin.awaiting_review && (
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

      {item && !checkin.awaiting_review && (
        <>
          <div className="mb-3 rounded-xl bg-blue-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-medium uppercase text-blue-800">{t('checkin.sayToChild')}</div>
                <div className="text-lg">{item.instructions[lang] ?? item.instructions.en}</div>
                {lang !== uiLang && item.instructions[uiLang] && (
                  <div className="text-sm text-slate-600">{item.instructions[uiLang]}</div>
                )}
              </div>
              <InstructionAudio key={item.id} lang={checkin.language} level={item.level} />
            </div>
          </div>

          <ReadingCard item={item} />

          {tapMode ? (
            <TapToMark item={item} onSave={saveMarks} busy={busy === 'save'} onCancel={() => setTapMode(false)} />
          ) : busy === 'upload' ? (
            <Spinner label={t('checkin.checking')} />
          ) : recorder.state === 'recording' ? (
            <div className="mt-5 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-red-700">
                <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
                <span className="font-mono text-lg">{clock(recorder.elapsed)}</span>
              </div>
              <p className="text-center text-sm text-slate-600">{t('checkin.recording')}</p>
              <button
                onClick={recorder.stop}
                className="h-20 w-20 rounded-full bg-red-600 text-lg font-bold text-white shadow-lg active:bg-red-700"
              >
                {t('checkin.stop')}
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center gap-3">
              <p className="text-center text-sm text-slate-600">{t('checkin.showChild')}</p>
              <button
                onClick={() => void record()}
                aria-label={t('checkin.record')}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-700 text-4xl text-white shadow-lg active:bg-blue-800"
              >
                🎤
              </button>
              {recorder.error && (
                <p className="text-center text-sm text-red-700">
                  {t(recorder.error === 'permission' ? 'checkin.micPermission' : 'checkin.micUnsupported')}
                </p>
              )}
              <Button kind="ghost" onClick={() => setTapMode(true)}>
                {t('checkin.markByTap')}
              </Button>
            </div>
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
