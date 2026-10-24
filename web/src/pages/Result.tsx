import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Api } from '../api'
import { ReviewPanel } from '../components/ReviewPanel'
import { WordChips, WordLegend, wordCorrect } from '../components/WordChips'
import { ErrorBox, LevelBadge, Page, Spinner } from '../components/ui'
import { patternKey } from '../lib/readingLang'
import type { Checkin, ItemResult, Level, Word } from '../lib/types'
import { useClip, wordAt } from '../lib/useClip'
import { useAsync } from '../lib/useAsync'

const LEVELS: Level[] = ['beginner', 'letter', 'word', 'paragraph', 'story']

export default function Result() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'hi' ? 'hi' : 'en'
  const { data: checkin, setData: setCheckin, error, reload } = useAsync(() => Api.checkin(id), [id])
  const { data: student, reload: reloadStudent } = useAsync(
    () => (checkin ? Api.student(checkin.student_id) : Promise.resolve(null)),
    [checkin?.student_id],
  )
  const { data: health } = useAsync(() => Api.health().catch(() => null))
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)

  // The quick (rule-based) analysis is replaced by Claude's a few seconds later: poll briefly for it.
  const waitingForAi =
    !!health?.claude && health.claude_budget?.available !== false && checkin?.diagnosis?.model === 'rules'
  useEffect(() => {
    if (!waitingForAi) return
    let tries = 0
    const timer = window.setInterval(async () => {
      tries += 1
      const fresh = await Api.checkin(id).catch(() => null)
      if (fresh) setCheckin(fresh)
      if (tries >= 10 || (fresh && fresh.diagnosis?.model !== 'rules')) window.clearInterval(timer)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [waitingForAi, id, setCheckin])

  const act = async (fn: () => Promise<Checkin>) => {
    setSaving(true)
    setActionError(null)
    try {
      setCheckin(await fn())
      await reloadStudent()
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setSaving(false)
    }
  }

  if (!checkin) {
    return <Page back>{error ? <ErrorBox error={error} onRetry={reload} /> : <Spinner label={t('loading')} />}</Page>
  }

  const tapWord = (itemResultId: string, w: Word) =>
    void act(() => Api.review(checkin.id, [{ item_result_id: itemResultId, i: w.i, correct: !wordCorrect(w) }]))

  const d = checkin.diagnosis
  const confirmedNow =
    student && checkin.level_final && student.levels[checkin.language]?.confirmed_level === checkin.level_final

  return (
    <Page
      title={student ? `${student.avatar} ${student.first_name} · ${t(`lang.${checkin.language}`, { defaultValue: checkin.language })}` : undefined}
      back={`/student/${checkin.student_id}`}
    >
      <ErrorBox error={actionError} />

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-600">{t('result.level')}</div>
        {checkin.status === 'needs_review' ? (
          <div className="mt-1 text-lg font-semibold text-amber-800">{t('result.needsReview')}</div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <LevelBadge level={checkin.level_final} large />
            {checkin.teacher_overrode && <span className="text-xs text-slate-500">({t('result.overrode')})</span>}
          </div>
        )}
        {checkin.status === 'scored' && student && (
          <p className="mt-2 text-sm text-slate-600">{confirmedNow ? t('result.confirmedNote') : t('result.provisionalNote')}</p>
        )}
        <label className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-slate-600">{t('result.changeLevel')}</span>
          <select
            disabled={saving}
            value={checkin.teacher_overrode ? checkin.level_final ?? '' : ''}
            onChange={(e) => void act(() => Api.override(checkin.id, (e.target.value || null) as Level | null))}
            className="rounded-lg border bg-white px-2 py-1.5"
          >
            <option value="">{t('result.clearOverride')}</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`level.${l}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {checkin.status === 'needs_review' && (
        <div className="mt-4">
          <ReviewPanel
            checkinId={checkin.id}
            items={checkin.items.filter((r) => r.needs_review)}
            busy={saving}
            onDone={(marks) => void act(() => Api.review(checkin.id, marks))}
          />
        </div>
      )}

      {d && (
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t('result.diagnosis')}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {d.model === 'rules' ? t('result.quick') : t('result.ai')}
            </span>
          </div>
          {d.error_patterns.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.error_patterns.map((p) => (
                <span key={p} className="rounded-full bg-violet-100 px-2 py-0.5 text-sm text-violet-900">
                  {t(patternKey(p, checkin.language))}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-slate-800">{d.summary[lang] ?? d.summary.en}</p>
          {d.evidence.some((e) => e.words.length) && (
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {d.evidence
                .filter((e) => e.words.length)
                .map((e, k) => (
                  <li key={k}>
                    <span className="font-medium">{t(patternKey(e.pattern, checkin.language))}:</span>{' '}
                    {e.words.map((w) => `${w.ref} → ${w.heard ?? '—'}`).join(', ')}
                    {(lang === 'hi' ? e.note_hi : e.note_en) && <span> — {lang === 'hi' ? e.note_hi : e.note_en}</span>}
                  </li>
                ))}
            </ul>
          )}
          {waitingForAi && <p className="mt-2 text-xs text-slate-500">{t('result.updating')}</p>}
        </section>
      )}

      <section className="mt-4">
        <h2 className="font-semibold">{t('result.items')}</h2>
        <p className="text-xs text-slate-500">{t('result.tapWord')}</p>
        <div className="mt-2">
          <WordLegend />
        </div>
        <div className="mt-3 space-y-3">
          {checkin.items.map((r) => (
            <ItemCard
              key={r.id}
              checkinId={checkin.id}
              item={r}
              onTapWord={saving ? undefined : (w) => tapWord(r.id, w)}
            />
          ))}
        </div>
      </section>

      {checkin.items.some((r) => r.has_audio) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{t('result.keptDays', { days: health?.audio_retention_days ?? 30 })}</span>
          <button
            onClick={() => {
              if (window.confirm(t('result.deleteConfirm'))) void act(() => Api.deleteRecordings(checkin.id))
            }}
            className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600"
          >
            {t('result.deleteRecordings')}
          </button>
        </div>
      )}

      {student && (
        <div className="mt-6 text-center">
          <Link to={`/class/${student.class_id}`} className="font-semibold text-blue-700 underline">
            {t('result.backToClass')}
          </Link>
        </div>
      )}
    </Page>
  )
}

function ItemCard({ checkinId, item, onTapWord }: { checkinId: string; item: ItemResult; onTapWord?: (w: Word) => void }) {
  const { t } = useTranslation()
  const clip = useClip(checkinId, item.id)
  const s = item.result
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          {t(`itemLevel.${item.item_level}`)} {item.passed ? '✓' : '✗'}
        </span>
        <span className="flex items-center gap-2">
          {item.has_audio && (
            <button
              onClick={() => (clip.state === 'playing' ? clip.stop() : void clip.play())}
              className="rounded-full border border-blue-200 px-3 py-1 text-sm font-semibold text-blue-800"
            >
              {clip.state === 'playing' ? `⏸ ${t('result.pause')}` : clip.state === 'loading' ? '…' : `▶ ${t('result.listen')}`}
            </button>
          )}
          <span className="text-sm text-slate-600">
            {s.counts.correct}/{s.counts.total}
          </span>
        </span>
      </div>
      {clip.state === 'error' && <p className="mt-1 text-xs text-slate-500">{t('result.noRecording')}</p>}
      <div className="mt-2">
        <WordChips
          words={s.words}
          onTap={onTapWord}
          markedByHand={item.source === 'offline_marks' && !s.ai_scored}
          activeIndex={clip.state === 'playing' ? wordAt(s.words, clip.ms) : null}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-500">
        {item.source === 'offline_marks' && (
          <span>{s.ai_scored ? t('result.markedAndChecked') : t('result.markedByTeacher')}</span>
        )}
        {(item.item_level === 'paragraph' || item.item_level === 'story') && s.hesitations !== null && (
          <span>{t('result.pauses', { count: s.hesitations })}</span>
        )}
        {s.wcpm !== null && <span>{t('result.wcpm', { wcpm: Math.round(s.wcpm) })}</span>}
      </div>
    </div>
  )
}
