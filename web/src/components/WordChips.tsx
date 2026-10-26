import { useTranslation } from 'react-i18next'
import type { Word } from '../lib/types'

export function wordCorrect(w: Word): boolean {
  if (w.teacher_correct !== null && w.teacher_correct !== undefined) return w.teacher_correct
  return w.label === 'correct' || w.label === 'self_correct'
}

export function heardAs(w: Word): string | null {
  const agreeing = Object.entries(w.labels).filter(([, l]) => l === w.label).map(([p]) => p)
  for (const p of agreeing) if (w.heard[p]) return w.heard[p]
  return Object.values(w.heard).find((h) => h) ?? null
}

/** Per-word result: wrong in red, uncertain (and not yet confirmed) in amber, self-corrected marked ↺. */
export function WordChips({
  words,
  onTap,
  big,
  markedByHand,
  activeIndex,
}: {
  words: Word[]
  onTap?: (w: Word) => void
  big?: boolean
  /** The whole item was tap-marked, so per-word "corrected by teacher" marks would be noise. */
  markedByHand?: boolean
  /** Word being spoken while the recording plays. */
  activeIndex?: number | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.map((w) => {
        const correct = wordCorrect(w)
        const unsure = w.uncertain && w.teacher_correct === null
        const heard = heardAs(w)
        const cls = unsure
          ? 'bg-sun-soft text-sun-deep ring-2 ring-sun'
          : correct
            ? 'bg-white text-ink'
            : 'bg-coral-soft text-coral-deep line-through decoration-2'
        return (
          <button
            key={w.i}
            onClick={onTap ? () => onTap(w) : undefined}
            disabled={!onTap}
            title={heard && heard !== w.ref ? t('checkin.heard', { heard }) : undefined}
            className={`rounded-lg border border-line px-2 py-1 ${big ? 'text-xl' : 'text-base'} ${cls} ${
              activeIndex === w.i ? 'outline outline-2 outline-brand' : ''
            }`}
          >
            {w.ref}
            {w.label === 'self_correct' && correct && <span className="ml-0.5 text-leaf-deep">↺</span>}
            {w.teacher_correct !== null && !markedByHand && <span className="ml-0.5 text-xs text-mute">✎</span>}
          </button>
        )
      })}
    </div>
  )
}

export function WordLegend() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-3 text-xs text-mute">
      <span>
        <span className="mr-1 inline-block h-3 w-3 rounded bg-coral-soft ring-1 ring-coral/40" />
        {t('result.legendWrong')}
      </span>
      <span>
        <span className="mr-1 inline-block h-3 w-3 rounded bg-amber-200 ring-1 ring-amber-400" />
        {t('result.legendUnsure')}
      </span>
      <span>↺ {t('result.legendFixed')}</span>
    </div>
  )
}
