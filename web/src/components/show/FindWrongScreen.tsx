import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import type { ScreenProps } from './ShowClass'

/** Correct the incorrect: a sentence with one wrong word; a child taps it and the right word takes its place. */
export function FindWrongScreen({ ex, celebrate }: ScreenProps) {
  const { t } = useTranslation()
  const tokens = useMemo(() => (ex.ex1 ?? '').split(/\s+/).filter(Boolean), [ex.ex1])
  const [wrong, right] = useMemo(() => (ex.fix ?? '').split('→').map((s) => s.trim()), [ex.fix])
  const [solved, setSolved] = useState(false)
  const [shake, setShake] = useState<number | null>(null)
  if (tokens.length === 0 || !wrong) return null

  const tap = (i: number) => {
    if (solved) return
    if (tokens[i] === wrong) {
      setSolved(true)
      sound.success()
      celebrate()
    } else {
      sound.wrong()
      setShake(i)
      window.setTimeout(() => setShake(null), 450)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-4">
      <div className="flex flex-wrap justify-center gap-3 rounded-4xl bg-white p-5 shadow-card">
        {tokens.map((w, i) => {
          const isWrong = w === wrong
          return (
            <button
              key={`${i}-${shake === i}`}
              onClick={() => tap(i)}
              className={`show-text-sm rounded-2xl px-3 py-1 font-semibold transition active:scale-95 ${
                solved && isWrong
                  ? 'bg-leaf-soft text-leaf-deep ring-4 ring-leaf/40 pop'
                  : shake === i
                    ? 'bg-coral-soft text-coral-deep shake'
                    : 'bg-paper text-ink'
              }`}
            >
              {solved && isWrong ? (
                <span className="flex flex-col items-center leading-tight">
                  <span className="text-base text-coral-deep line-through decoration-2">{wrong}</span>
                  <span>{right}</span>
                </span>
              ) : (
                w
              )}
            </button>
          )
        })}
      </div>
      {solved && (
        <Button kind="secondary" onClick={() => setSolved(false)}>
          ↻ {t('show.again')}
        </Button>
      )}
    </div>
  )
}
