import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemResult, Word } from '../lib/types'
import { heardAs } from './WordChips'
import { Button } from './ui'

/** The teacher confirms each word the speech paths disagreed on, where it could change the item's result. */
export function ReviewPanel({
  items,
  onDone,
  busy,
}: {
  items: ItemResult[]
  onDone: (marks: { item_result_id: string; i: number; correct: boolean }[]) => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const open = items.flatMap((r) =>
    r.result.words.filter((w) => w.uncertain && w.teacher_correct === null).map((w) => ({ r, w })),
  )
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const key = (r: ItemResult, w: Word) => `${r.id}:${w.i}`
  const complete = open.every(({ r, w }) => key(r, w) in answers)

  return (
    <section className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <h2 className="text-lg font-semibold">{t('checkin.confirmTitle')}</h2>
      <p className="text-sm text-slate-700">{t('checkin.confirmHelp')}</p>
      <ul className="space-y-2">
        {open.map(({ r, w }) => {
          const k = key(r, w)
          const heard = heardAs(w)
          return (
            <li key={k} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3">
              <div>
                <div className="text-2xl font-semibold">{w.ref}</div>
                {heard && heard !== w.ref && <div className="text-xs text-slate-500">{t('checkin.heard', { heard })}</div>}
              </div>
              <div className="flex gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    onClick={() => setAnswers((a) => ({ ...a, [k]: v }))}
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
