import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { textFor } from '../../lib/content'
import { clusters } from '../../lib/graphemes'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import { PeekCue } from './PeekCue'
import type { ScreenProps } from './ShowClass'

/** A word as the child finds it: without the full stop, danda, comma or quote that follows it in the line. */
const bare = (token: string) => token.replace(/[.,!?;:।॥"'“”‘’()\-–—]/g, '')

/**
 * A free-to-use text held up to the group (a public-domain rhyme or story, credited on the plan): the lines big,
 * a tap lights a line up for reading along; then "find the word" (read), "find every word starting with the
 * letter" (hunt), or the comprehension questions one at a time (story). The text comes with the plan; the shelf's
 * copy falls back to the language's bundled text, so it works offline too.
 */
export function TextScreen({ lang, text, mode, celebrate }: ScreenProps & { mode: 'read' | 'story' | 'hunt' }) {
  const { t } = useTranslation()
  const txt = text ?? textFor(lang, mode === 'story' ? 'story' : 'rhyme')
  const [lit, setLit] = useState<number | null>(null)
  const [target, setTarget] = useState(0)
  const [found, setFound] = useState<string[]>([])
  const [shake, setShake] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState(0)
  const [answer, setAnswer] = useState(false)
  const timer = useRef<number | null>(null)
  const lines = useMemo(() => (txt?.lines ?? []).map((l) => l.split(/\s+/).filter(Boolean)), [txt])
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])
  if (!txt) return null

  const questions = txt.questions ?? [] // the bundled copy of a rhyme has none
  const want = txt.words_to_find.length ? txt.words_to_find[target % txt.words_to_find.length] : ''
  const letter = (clusters(want)[0] ?? '').toLowerCase() // English: H and h are the same letter here
  const startsWith = (w: string) => (clusters(w)[0] ?? '').toLowerCase() === letter
  const letterWords = Array.from(new Set(lines.flat().map(bare).filter((w) => w && startsWith(w))))
  const waiting = timer.current !== null
  const next = () => {
    timer.current = window.setTimeout(() => {
      timer.current = null
      setFound([])
      setTarget((n) => n + 1)
    }, 1400)
  }
  const tapWord = (token: string) => {
    const w = bare(token)
    if (!w || waiting) return
    if (mode === 'hunt') {
      if (letterWords.includes(w) && !found.includes(w)) {
        const now = [...found, w]
        setFound(now)
        sound.success()
        if (now.length >= letterWords.length) {
          celebrate()
          next()
        }
        return
      }
      if (found.includes(w)) return
    } else if (w === want) {
      setFound([w])
      sound.success()
      celebrate()
      next()
      return
    }
    sound.wrong()
    setShake(w)
    window.setTimeout(() => setShake(null), 450)
  }
  const q = questions[question]

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 py-3">
      <div className="text-center">
        <h2 className="font-display text-3xl text-brand-deep" style={{ textWrap: 'balance' }}>
          {txt.title}
        </h2>
        <div className="text-sm text-mute">{t('activity.by', { author: txt.author })}</div>
      </div>
      {asking && q ? (
        <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-3xl bg-white p-5 shadow-card pop" key={question}>
          <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-mute">
            {question + 1} / {questions.length}
          </span>
          <p className="show-text-sm text-center text-ink">{q.q}</p>
          {answer ? (
            <p className="show-text-sm rounded-2xl bg-leaf-soft px-4 py-2 text-center text-leaf-deep pop">{q.a}</p>
          ) : (
            <Button kind="secondary" onClick={() => setAnswer(true)}>
              {t('show.answer')}
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              kind="ghost"
              disabled={question === 0}
              onClick={() => {
                setQuestion((n) => n - 1)
                setAnswer(false)
              }}
            >
              ‹ {t('show.back')}
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                if (question + 1 < questions.length) {
                  setQuestion((n) => n + 1)
                  setAnswer(false)
                } else {
                  setAsking(false)
                  celebrate()
                }
              }}
            >
              {question + 1 < questions.length ? `${t('show.next')} ›` : `✓ ${t('show.done')}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full max-w-lg flex-col gap-2">
          {lines.map((tokens, i) => (
            <div
              key={i}
              onClick={() => setLit(lit === i ? null : i)}
              className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-3xl px-3 py-2 transition ${
                lit === i ? 'bg-sun-soft ring-4 ring-sun/60' : 'bg-white shadow-card'
              }`}
            >
              {tokens.map((w, k) => {
                if (!bare(w)) return <span key={k} className="show-text-sm text-mute">{w}</span> // a dash or dandas: not a word
                const hit = found.includes(bare(w))
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
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {mode === 'story' && questions.length > 0 && (
          <Button
            onClick={() => {
              setAsking((a) => !a)
              setQuestion(0)
              setAnswer(false)
            }}
            className="text-lg"
          >
            {asking ? `📖 ${t('activity.text')}` : `❓ ${t('show.questions')}`}
          </Button>
        )}
        {!asking && want && (
          <PeekCue render={(secret) => (mode === 'hunt' ? t('show.findLetter', { letter: secret ? letter : '…' }) : t('show.find', { word: secret ? want : '…' }))} />
        )}
      </div>
    </div>
  )
}
