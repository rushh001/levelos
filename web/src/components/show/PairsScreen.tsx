import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import { PeekCue } from './PeekCue'
import type { ScreenProps } from './ShowClass'

/** Look-alike letters: the pair large; the teacher says one (the cue is hidden behind an eye, so the class
 * listens rather than reads it), a child taps it. */
export function PairsScreen({ ex, celebrate }: ScreenProps) {
  const { t } = useTranslation()
  const pairs = useMemo(
    () =>
      (ex.ex1 ?? '')
        .split(',')
        .map((p) => p.split('/').map((s) => s.trim()))
        .filter((p) => p.length === 2 && p.every(Boolean)),
    [ex.ex1],
  )
  const [round, setRound] = useState(0)
  const [result, setResult] = useState<{ tapped: number; right: boolean } | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])
  if (pairs.length === 0) return null
  const pairIdx = Math.floor(round / 2) % pairs.length
  const pair = pairs[pairIdx]
  const target = (round + pairIdx) % 2

  const later = (fn: () => void, ms: number) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  const tap = (k: number) => {
    if (result?.right) return
    if (k === target) {
      setResult({ tapped: k, right: true })
      sound.success()
      celebrate()
      later(() => {
        setResult(null)
        setRound((r) => r + 1)
      }, 1400)
    } else {
      setResult({ tapped: k, right: false })
      sound.wrong()
      later(() => setResult(null), 600)
    }
  }
  const nextPair = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setResult(null)
    setRound(Math.floor(round / 2) * 2 + 2)
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-4">
      <PeekCue render={(secret) => t('show.say', { letter: secret ? pair[target] : '…' })} />
      <div className="grid w-full max-w-md grid-cols-2 gap-4">
        {pair.map((letter, k) => {
          const state = result && result.tapped === k ? (result.right ? 'right' : 'wrong') : ''
          return (
            <button
              key={`${round}-${k}`}
              onClick={() => tap(k)}
              className={`show-text rounded-4xl bg-white py-6 text-center font-semibold text-ink shadow-card transition active:scale-95 ${
                state === 'right' ? 'bg-leaf-soft ring-8 ring-leaf/50' : state === 'wrong' ? 'shake ring-8 ring-coral/40' : ''
              }`}
            >
              {letter}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2">
        {pairs.map((_, k) => (
          <span key={k} className={`h-2.5 w-2.5 rounded-full ${k === pairIdx ? 'bg-brand' : 'bg-line'}`} />
        ))}
      </div>
      <Button kind="secondary" onClick={nextPair}>
        {t('show.next')} ▶
      </Button>
    </div>
  )
}
