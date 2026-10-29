import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shuffled } from '../../lib/graphemes'
import { sound } from '../../lib/sound'
import { PeekCue } from './PeekCue'
import type { ScreenProps } from './ShowClass'

/**
 * A Letter group's screen: only letters, big and scattered, each written twice (as on the board). The teacher
 * says one letter's sound (the cue hides behind an eye, so the class listens rather than reads it); a child taps
 * every place it is written. The children never see a word or a line here.
 */
export function LettersScreen({ words, celebrate }: ScreenProps) {
  const { t } = useTranslation()
  const letters = useMemo(() => Array.from(new Set(words.map((w) => w.trim()).filter(Boolean))), [words])
  const [round, setRound] = useState(0)
  const [found, setFound] = useState<number[]>([])
  const [shake, setShake] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])
  const cells = useMemo(() => shuffled([...letters, ...letters], round + 1), [letters, round])
  if (letters.length === 0) return null
  const target = letters[round % letters.length]
  const copies = cells.filter((c) => c === target).length

  const tap = (i: number) => {
    if (found.includes(i) || timer.current !== null) return
    if (cells[i] !== target) {
      sound.wrong()
      setShake(i)
      window.setTimeout(() => setShake(null), 450)
      return
    }
    const now = [...found, i]
    setFound(now)
    sound.success()
    if (now.length >= copies) {
      celebrate()
      timer.current = window.setTimeout(() => {
        timer.current = null
        setFound([])
        setRound((r) => r + 1)
      }, 1400)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-3">
      <div className="grid w-full max-w-md grid-cols-3 gap-3">
        {cells.map((c, i) => (
          <button
            key={`${round}-${i}`}
            onClick={() => tap(i)}
            className={`flex aspect-square items-center justify-center rounded-3xl font-display text-6xl transition active:scale-95 ${
              found.includes(i) ? 'bg-leaf-soft text-leaf-deep ring-4 ring-leaf/40 pop' : shake === i ? 'shake bg-white text-coral-deep shadow-card' : 'bg-white text-ink shadow-card'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <PeekCue render={(secret) => t('show.say', { letter: secret ? target : '…' })} />
    </div>
  )
}
