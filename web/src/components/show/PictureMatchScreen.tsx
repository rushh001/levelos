import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shuffled } from '../../lib/graphemes'
import { hasPicture, Picture, picturedWords } from '../../lib/pictures'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import type { ScreenProps } from './ShowClass'

const SET = 4

/** Match words to pictures: four words on the left, their pictures shuffled on the right; tap a word, then its
 * picture. The group's own misread words come first, then the bank's examples, then other pictured words. */
export function PictureMatchScreen({ lang, ex, words, celebrate }: ScreenProps) {
  const { t } = useTranslation()
  const pool = useMemo(() => {
    const bank = (ex.ex1 ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return [...new Set([...words, ...bank, ...picturedWords(lang)].map((w) => w.normalize('NFC')))].filter((w) => hasPicture(w, lang))
  }, [words, ex.ex1, lang])
  const [set, setSet] = useState(0)
  const [sel, setSel] = useState<{ word?: string; pic?: string }>({})
  const [done, setDone] = useState<string[]>([])
  const [shake, setShake] = useState<string | null>(null)

  const items = useMemo(() => {
    if (pool.length === 0) return []
    const start = (set * SET) % pool.length
    return Array.from({ length: Math.min(SET, pool.length) }, (_, i) => pool[(start + i) % pool.length])
  }, [pool, set])
  const left = useMemo(() => shuffled(items, set), [items, set])
  const right = useMemo(() => shuffled(items, set + 5), [items, set])
  if (items.length < 2) return null
  const finished = done.length === items.length

  const pick = (kind: 'word' | 'pic', w: string) => {
    if (done.includes(w)) return
    const next = { ...sel, [kind]: w }
    if (next.word && next.pic) {
      setSel({})
      if (next.word === next.pic) {
        sound.success()
        const d = [...done, w]
        setDone(d)
        if (d.length === items.length) celebrate()
      } else {
        sound.wrong()
        setShake(w)
        window.setTimeout(() => setShake(null), 450)
      }
    } else {
      sound.tap()
      setSel(next)
    }
  }
  const nextSet = () => {
    setSet(set + 1)
    setDone([])
    setSel({})
  }
  const cls = (w: string, selected: boolean) =>
    done.includes(w)
      ? 'bg-leaf-soft ring-4 ring-leaf/40 text-leaf-deep'
      : selected
        ? 'bg-brand-soft ring-4 ring-brand/50'
        : shake === w
          ? 'shake bg-coral-soft'
          : 'bg-white'

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 py-3">
      <div className="grid w-full max-w-md grid-cols-2 gap-x-6 gap-y-3">
        <div className="flex flex-col gap-3">
          {left.map((w) => (
            <button
              key={`w-${w}`}
              onClick={() => pick('word', w)}
              className={`show-text-sm flex min-h-[5.5rem] items-center justify-center rounded-3xl px-3 font-semibold text-ink shadow-card transition active:scale-95 ${cls(w, sel.word === w)}`}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {right.map((w) => (
            <button
              key={`p-${w}`}
              onClick={() => pick('pic', w)}
              aria-label={w}
              className={`flex min-h-[5.5rem] items-center justify-center rounded-3xl p-2 shadow-card transition active:scale-95 ${cls(w, sel.pic === w)}`}
            >
              <Picture word={w} lang={lang} size={72} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-mute">
          {done.length} / {items.length}
        </span>
        {finished && pool.length > items.length && <Button onClick={nextSet}>{t('show.nextSet')} ▶</Button>}
        {finished && pool.length <= items.length && (
          <Button kind="secondary" onClick={nextSet}>
            ↻ {t('show.again')}
          </Button>
        )}
      </div>
    </div>
  )
}
