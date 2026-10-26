import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Picture, pictureFor } from '../../lib/pictures'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import type { ScreenProps } from './ShowClass'

/** Quick-flash common words: a card flips over for a second or two (with its picture when there is one), then
 * ✓ to the group's pile or ↻ to see it again later. */
export function FlashScreen({ lang, ex, words, celebrate }: ScreenProps) {
  const { t } = useTranslation()
  const initial = useMemo(() => {
    const own = words.map((w) => w.trim()).filter(Boolean)
    const bank = (ex.ex1 ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return own.length >= 3 ? own : [...own, ...bank.filter((b) => !own.includes(b))]
  }, [words, ex.ex1])
  const [queue, setQueue] = useState<string[]>(initial)
  const [pile, setPile] = useState<string[]>([])
  const [visible, setVisible] = useState(false)
  const [seconds, setSeconds] = useState(2)
  const current = queue[0]

  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => setVisible(false), seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [visible, seconds, current])

  const show = () => {
    sound.flip()
    setVisible(true)
  }
  const ok = () => {
    sound.success()
    setPile([...pile, current])
    setQueue(queue.slice(1))
    setVisible(false)
    if (queue.length === 1) celebrate()
  }
  const again = () => {
    sound.tap()
    setQueue([...queue.slice(1), current])
    setVisible(false)
  }

  if (!current) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-5 py-4">
        <div className="font-display text-4xl text-brand-deep">{t('show.allDone')}</div>
        <div className="flex flex-wrap justify-center gap-2">
          {pile.map((w, i) => (
            <span key={i} className="rounded-full bg-leaf-soft px-3 py-1 text-lg text-leaf-deep">
              {w}
            </span>
          ))}
        </div>
        <Button
          onClick={() => {
            setQueue(pile)
            setPile([])
          }}
        >
          ↻ {t('show.again')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 py-4">
      <div className="text-sm text-mute">
        {pile.length + 1} / {pile.length + queue.length}
      </div>
      <button
        onClick={show}
        className={`flex min-h-[10rem] w-full max-w-md items-center justify-center gap-4 rounded-4xl px-6 py-4 text-center font-semibold shadow-card transition active:scale-[0.98] ${
          visible ? 'bg-white text-ink flip-in' : 'bg-brand text-white'
        }`}
      >
        {visible ? (
          <span className="show-text">{current}</span> /* the word alone: the group must read it, not name a picture */
        ) : (
          <span className="font-display text-3xl">👁 {t('show.showWord')}</span>
        )}
      </button>
      <div className="flex gap-3">
        <Button kind="secondary" onClick={again} className="text-lg">
          ↻
        </Button>
        <Button onClick={ok} className="px-8 text-lg">
          ✓
        </Button>
      </div>
      <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-card">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => setSeconds(n)}
            aria-pressed={seconds === n}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${seconds === n ? 'bg-brand text-white' : 'text-mute'}`}
          >
            {t('show.seconds', { n })}
          </button>
        ))}
      </div>
      {pile.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-xs text-mute">{t('show.pile')}:</span>
          {pile.map((w, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full bg-leaf-soft py-0.5 pl-1.5 pr-2.5 text-sm text-leaf-deep">
              {pictureFor(w, lang) && <Picture word={w} lang={lang} size={20} />}
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
