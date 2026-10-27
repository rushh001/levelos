import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { picturedWords, Picture } from '../lib/pictures'
import { shuffled } from '../lib/graphemes'
import { sound } from '../lib/sound'
import type { MeaningAnswer } from '../lib/types'
import { Button } from './ui'
import { Stars } from './Stars'

/** "Where is …?" in the language of the test (no gender to agree with), said by the teacher. */
const ASK: Record<string, (w: string) => string> = {
  hi: (w) => `${w} कहाँ है?`,
  en: (w) => `Where is "${w}"?`,
  mr: (w) => `${w} कुठे आहे?`,
  kn: (w) => `${w} ಎಲ್ಲಿದೆ?`,
  ta: (w) => `${w} எங்கே?`,
  bn: (w) => `${w} কোথায়?`,
}

/** Words of a card that have a picture; the step runs only when there are at least three to choose from. */
export function meaningWords(words: string[], lang: string): string[] {
  const known = new Set(picturedWords(lang))
  const own = words.filter((w) => known.has(w.normalize('NFC')))
  return own.length >= 3 ? own : []
}

/**
 * The meaning step after a word card, as ASER's English tool asks the meaning of the words read: a word from the
 * card, three pictures; the child points, the teacher taps. Two rounds. Never part of the level. Like an ASER
 * tester, it never shows the child a wrong mark: a right answer gets stars, any answer just moves on.
 */
export function MeaningCheck({
  words,
  lang,
  seed,
  onDone,
}: {
  words: string[]
  lang: string
  seed: number
  onDone: (answers: MeaningAnswer[]) => void
}) {
  const { t } = useTranslation()
  const ask = ASK[lang] ?? ASK.en
  const rounds = useMemo(() => {
    const own = meaningWords(words, lang)
    return Array.from({ length: Math.min(2, own.length) }, (_, r) => {
      const target = own[(seed + r) % own.length]
      const others = own.filter((w) => w !== target)
      const picked = shuffled(others, seed + r).slice(0, 2)
      return { target, choices: shuffled([target, ...picked], seed * 3 + r) }
    })
  }, [words, lang, seed])
  const [round, setRound] = useState(0)
  const [answers, setAnswers] = useState<MeaningAnswer[]>([])
  const [tapped, setTapped] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])
  const r = rounds[round]
  if (!r) return null

  const finish = (list: MeaningAnswer[]) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    onDone(list)
  }
  const tap = (choice: string) => {
    if (tapped) return
    const correct = choice === r.target
    if (correct) sound.success()
    setTapped(choice)
    const next = [...answers, { word: r.target, correct }]
    setAnswers(next)
    timer.current = window.setTimeout(() => {
      setTapped(null)
      if (round + 1 < rounds.length) setRound(round + 1)
      else finish(next)
    }, 1100)
  }

  return (
    <section className="card mt-4 pop">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-deep/70">{t('meaning.title')}</div>
          <div className="text-sm text-mute">{t('meaning.help')}</div>
        </div>
        <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-mute">
          {round + 1} / {rounds.length}
        </span>
      </div>
      <div key={round} className="mt-3 text-center font-display text-3xl text-ink pop">{ask(r.target)}</div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {r.choices.map((w) => {
          const state = tapped ? (w === r.target ? 'right' : 'dim') : ''
          return (
            <button
              key={`${round}-${w}`}
              onClick={() => tap(w)}
              aria-label={w}
              className={`relative flex aspect-square items-center justify-center rounded-3xl bg-paper p-2 transition active:scale-95 ${
                state === 'right' ? 'bg-leaf-soft ring-4 ring-leaf/50' : state === 'dim' ? 'opacity-40' : ''
              }`}
            >
              {state === 'right' && tapped === w && <Stars n={10} seed={round} spread={40} />}
              <Picture word={w} lang={lang} size={88} className="h-full w-full object-contain" />
            </button>
          )
        })}
      </div>
      <div className="mt-3 text-right">
        <Button kind="ghost" onClick={() => finish(answers)} disabled={tapped !== null}>
          {t('meaning.skip')}
        </Button>
      </div>
    </section>
  )
}
