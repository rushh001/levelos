import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cards, showCard, shuffled } from '../../lib/graphemes'
import { Picture } from '../../lib/pictures'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import { ChainScreen } from './ChainScreen'
import type { ScreenProps } from './ShowClass'

interface Task {
  cards: string[]
  target: string
}

/** Build words with letter and matra cards: tap the shuffled cards into the slots; then swap one card at a time. */
export function BuildScreen(props: ScreenProps) {
  const { lang, ex, words, celebrate } = props
  const { t } = useTranslation()
  const tasks = useMemo(() => {
    const list: Task[] = []
    if (ex.build?.includes('=')) {
      const [left, right] = ex.build.split('=')
      const parts = left
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length >= 2) list.push({ cards: parts, target: right.trim().normalize('NFC') })
    }
    for (const w of words) {
      const c = cards(w)
      if (c.length >= 2 && c.length <= 8 && !list.some((x) => x.target === w.normalize('NFC'))) list.push({ cards: c, target: w.normalize('NFC') })
    }
    return list
  }, [ex.build, words])
  const [idx, setIdx] = useState(0)
  const [placed, setPlaced] = useState<number[]>([])
  const [stage, setStage] = useState<'build' | 'swap'>('build')
  const task = tasks[idx]
  const pool = useMemo(() => (task ? shuffled(task.cards.map((_, i) => i), idx) : []), [task, idx])
  const complete = !!task && placed.length === task.cards.length
  const built = task ? placed.map((i) => task.cards[i]).join('').normalize('NFC') : ''
  const correct = complete && built === task.target

  useEffect(() => {
    if (complete && !correct) sound.wrong()
    if (!correct) return
    sound.success()
    celebrate()
    const timer = window.setTimeout(() => {
      setPlaced([])
      if (idx + 1 < tasks.length) setIdx(idx + 1)
      else if (ex.swap) setStage('swap')
      else setIdx(0)
    }, 1600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correct, complete])

  if (stage === 'swap') {
    return (
      <div className="flex min-h-full flex-col">
        <ChainScreen {...props} chain={ex.swap} title={t('show.swap')} />
        <div className="pb-2 text-center">
          <Button
            kind="ghost"
            onClick={() => {
              setStage('build')
              setIdx(0)
            }}
          >
            ↻ {t('show.buildWord')}
          </Button>
        </div>
      </div>
    )
  }
  if (!task) return null

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-4">
      <div className="text-sm text-mute">
        {t('show.buildWord')} · {idx + 1} / {tasks.length}
      </div>
      <Picture key={task.target} word={task.target} lang={lang} size={112} className="pop" />
      <div
        key={complete && !correct ? `wrong-${placed.join('')}` : 'slots'}
        className={`flex flex-wrap justify-center gap-2 ${complete && !correct ? 'shake' : ''}`}
      >
        {task.cards.map((_, s) => {
          const i = placed[s]
          return (
            <button
              key={s}
              onClick={() => i !== undefined && setPlaced(placed.filter((_, k) => k !== s))}
              className={`show-text-sm flex h-20 min-w-[4.5rem] items-center justify-center rounded-2xl px-2 font-semibold transition ${
                i === undefined
                  ? 'border-2 border-dashed border-line bg-white/60 text-mute/40'
                  : correct
                    ? 'bg-leaf-soft text-leaf-deep ring-4 ring-leaf/40'
                    : 'bg-white text-ink shadow-card'
              }`}
            >
              {i === undefined ? '·' : showCard(task.cards[i])}
            </button>
          )
        })}
      </div>
      {correct && <div className="show-text font-semibold text-brand-deep pop">{task.target}</div>}
      <div className="flex flex-wrap justify-center gap-3">
        {pool.map((i) =>
          placed.includes(i) ? (
            <span key={i} className="h-20 min-w-[4.5rem] rounded-2xl border-2 border-dashed border-line" />
          ) : (
            <button
              key={i}
              onClick={() => {
                if (complete) return
                sound.tap()
                setPlaced([...placed, i])
              }}
              className="show-text-sm flex h-20 min-w-[4.5rem] items-center justify-center rounded-2xl bg-sun-soft px-2 font-semibold text-ink shadow-card transition active:scale-95"
            >
              {showCard(task.cards[i])}
            </button>
          ),
        )}
      </div>
      <div className="flex gap-3">
        <Button kind="secondary" onClick={() => setPlaced([])} disabled={placed.length === 0}>
          ↻ {t('show.again')}
        </Button>
        {tasks.length > 1 && (
          <Button
            kind="secondary"
            onClick={() => {
              setPlaced([])
              setIdx((idx + 1) % tasks.length)
            }}
          >
            {t('show.next')} ▶
          </Button>
        )}
      </div>
    </div>
  )
}
