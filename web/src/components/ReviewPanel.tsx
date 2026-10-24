import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemResult, Word } from '../lib/types'
import { useClip, wordWindow } from '../lib/useClip'
import { Button } from './ui'

const grapheme = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('hi', { granularity: 'grapheme' }) : null

/** A letter read aloud comes back as a syllable (म -> मा): show just the letter, as the scorer compares it. */
function letterOf(s: string): string {
  if (/[a-z]/i.test(s)) return s.toLowerCase()
  const first = grapheme ? [...grapheme.segment(s)][0]?.segment ?? s : s
  return first.replace(/\p{M}/gu, '') || s
}

/** What each speech service heard for this word, without repeats; "—" when a service heard nothing there. */
function heardForms(w: Word, letters: boolean): string[] {
  const forms = Object.values(w.heard).map((h) => (h === null ? '—' : letters ? letterOf(h) : h))
  return [...new Set(forms)]
}

/** The teacher confirms each word the speech services disagreed on, where it could change the item's result —
 *  listening to the recording when there is one. */
export function ReviewPanel({
  checkinId,
  items,
  onDone,
  busy,
}: {
  checkinId: string
  items: ItemResult[]
  onDone: (marks: { item_result_id: string; i: number; correct: boolean }[]) => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const open = items.flatMap((r) =>
    r.result.words.filter((w) => w.uncertain && w.teacher_correct === null).map((w) => ({ r, w })),
  )
  const key = (r: ItemResult, w: Word) => `${r.id}:${w.i}`
  const complete = open.every(({ r, w }) => key(r, w) in answers)

  return (
    <section className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <h2 className="text-lg font-semibold">{t('checkin.confirmTitle')}</h2>
      <p className="text-sm text-slate-700">{t('checkin.confirmHelp')}</p>
      {items.map((r) => (
        <ItemReview
          key={r.id}
          checkinId={checkinId}
          item={r}
          answers={answers}
          onAnswer={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
          keyOf={key}
        />
      ))}
      <Button
        disabled={!complete || busy}
        onClick={() => onDone(open.map(({ r, w }) => ({ item_result_id: r.id, i: w.i, correct: answers[key(r, w)] })))}
        className="w-full"
      >
        {t('checkin.confirm')}
      </Button>
    </section>
  )
}

function ItemReview({
  checkinId,
  item,
  answers,
  onAnswer,
  keyOf,
}: {
  checkinId: string
  item: ItemResult
  answers: Record<string, boolean>
  onAnswer: (key: string, value: boolean) => void
  keyOf: (r: ItemResult, w: Word) => string
}) {
  const { t } = useTranslation()
  const clip = useClip(checkinId, item.id)
  const words = item.result.words
  const letters = item.item_level === 'letter'
  const open = words.filter((w) => w.uncertain && w.teacher_correct === null)
  if (!open.length) return null

  const playWord = (w: Word) => {
    const win = wordWindow(words, w.i)
    void (win ? clip.play(win[0], win[1]) : clip.play())
  }

  return (
    <div className="space-y-2">
      {item.has_audio && (
        <button
          onClick={() => (clip.state === 'playing' ? clip.stop() : void clip.play())}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white py-2 font-semibold text-blue-800"
        >
          {clip.state === 'playing' ? '⏸' : clip.state === 'loading' ? '…' : '▶'} {t('checkin.listenAll')}
        </button>
      )}
      {clip.state === 'error' && <p className="text-xs text-slate-500">{t('result.noRecording')}</p>}
      <ul className="space-y-2">
        {open.map((w) => {
          const k = keyOf(item, w)
          return (
            <li key={k} className="flex items-center justify-between gap-2 rounded-xl bg-white p-3">
              <div className="flex min-w-0 items-center gap-2">
                {item.has_audio && (
                  <button
                    onClick={() => playWord(w)}
                    aria-label={t('checkin.listenWord')}
                    className="shrink-0 rounded-full border border-blue-200 px-2.5 py-1.5 text-lg"
                  >
                    🔊
                  </button>
                )}
                <div className="min-w-0">
                  <div className="text-2xl font-semibold">{w.ref}</div>
                  <div className="truncate text-xs text-slate-500">
                    {t('checkin.heard', { heard: heardForms(w, letters).join(' · ') })}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    onClick={() => onAnswer(k, v)}
                    className={`rounded-xl border px-3 py-2 font-semibold ${
                      answers[k] === v
                        ? v
                          ? 'border-green-600 bg-green-600 text-white'
                          : 'border-red-600 bg-red-600 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {v ? `✓ ${t('checkin.readRight')}` : `✗ ${t('checkin.readWrong')}`}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
