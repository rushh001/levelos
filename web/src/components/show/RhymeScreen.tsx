import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rhymeFor } from '../../lib/content'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import { PeekCue } from './PeekCue'
import type { ScreenProps } from './ShowClass'

const LINE_FALLBACK_MS = 2600
/** A word as the child finds it: without the full stop, danda or comma that follows it in the line. */
const bare = (token: string) => token.replace(/[.,!?;:।॥"'()\-–—]/g, '')

/** Rhyme and read: the rhyme read aloud line by line (pre-recorded with the language's voice, so it works offline),
 * each line lighting up as it plays; then "find the word": the teacher says a word and a child taps it. */
export function RhymeScreen({ lang, celebrate }: ScreenProps) {
  const { t } = useTranslation()
  const rhyme = rhymeFor(lang)
  const [playing, setPlaying] = useState<number | null>(null)
  const [all, setAll] = useState(false)
  const [target, setTarget] = useState(0)
  const [found, setFound] = useState(false)
  const [shake, setShake] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const timer = useRef<number | null>(null)
  const findTimer = useRef<number | null>(null)
  const lines = useMemo(() => (rhyme?.lines ?? []).map((l) => l.split(/\s+/).filter(Boolean)), [rhyme])

  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }
  const stop = () => {
    const a = audio.current
    audio.current = null // callbacks of the old element check this and do nothing
    a?.pause()
    clearTimer()
    setPlaying(null)
    setAll(false)
  }
  useEffect(
    () => () => {
      stop()
      if (findTimer.current) window.clearTimeout(findTimer.current)
    },
    [],
  )

  const playLine = (i: number, chain: boolean) => {
    const old = audio.current
    audio.current = null
    old?.pause()
    clearTimer()
    if (!rhyme || i >= rhyme.lines.length) {
      setPlaying(null)
      setAll(false)
      return
    }
    setPlaying(i)
    setAll(chain)
    const a = new Audio(`/audio/rhyme/${lang}/${i + 1}.mp3`)
    audio.current = a
    let advanced = false
    const advance = () => {
      if (advanced || audio.current !== a) return // stopped or superseded meanwhile
      advanced = true
      if (chain) playLine(i + 1, true)
      else {
        audio.current = null
        setPlaying(null)
      }
    }
    // No recording (or it cannot play): light the line for a moment anyway, so the screen still works.
    const fallback = () => {
      if (audio.current !== a || timer.current !== null) return
      timer.current = window.setTimeout(advance, LINE_FALLBACK_MS)
    }
    a.onended = advance
    a.onerror = fallback
    void a.play().catch(fallback)
  }

  if (!rhyme) return null
  const want = rhyme.words_to_find[target % rhyme.words_to_find.length]

  const tapWord = (token: string) => {
    if (found) return
    const w = bare(token)
    if (w === want) {
      setFound(true)
      sound.success()
      celebrate()
      findTimer.current = window.setTimeout(() => {
        setFound(false)
        setTarget((n) => n + 1)
      }, 1400)
    } else {
      sound.wrong()
      setShake(w)
      window.setTimeout(() => setShake(null), 450)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 py-3">
      <h2 className="font-display text-3xl text-brand-deep" style={{ textWrap: 'balance' }}>
        {rhyme.title}
      </h2>
      <div className="flex w-full max-w-lg flex-col gap-2">
        {lines.map((tokens, i) => (
          <div
            key={i}
            onClick={() => (playing === i ? stop() : playLine(i, false))}
            className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-3xl px-3 py-2 transition ${
              playing === i ? 'bg-sun-soft ring-4 ring-sun/60' : 'bg-white shadow-card'
            }`}
          >
            {tokens.map((w, k) => {
              const hit = found && bare(w) === want
              return (
                <button
                  key={k}
                  onClick={(e) => {
                    e.stopPropagation()
                    tapWord(w)
                  }}
                  className={`show-text-sm rounded-xl px-1.5 font-medium transition active:scale-95 ${
                    hit ? 'bg-leaf-soft text-leaf-deep ring-4 ring-leaf/40 pop' : shake === bare(w) ? 'shake text-coral-deep' : 'text-ink'
                  }`}
                >
                  {w}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => (all ? stop() : playLine(0, true))} className="text-lg">
          {all ? `■ ${t('show.stop')}` : `▶ ${t('show.play')}`}
        </Button>
        <PeekCue render={(secret) => t('show.find', { word: secret ? want : '…' })} />
      </div>
    </div>
  )
}
