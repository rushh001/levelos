import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemPublic } from '../lib/types'
import { Button } from './ui'

/** Same split as the server (punctuation dropped, letters/marks/digits kept) so tap-marks line up with words. */
export function tokens(text: string): string[] {
  return text.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}'’]+/gu, ' ').split(/\s+/).filter(Boolean)
}

export function itemTokens(item: ItemPublic): string[] {
  return item.units ? item.units.flatMap(tokens) : tokens((item.sentences ?? []).join(' '))
}

/** Teacher taps every letter or word the child read wrongly: classic manual marking, used offline and as a fallback. */
export function TapToMark({
  item,
  onSave,
  onCancel,
  busy,
}: {
  item: ItemPublic
  onSave: (marks: boolean[]) => void
  onCancel: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const words = useMemo(() => itemTokens(item), [item])
  const [wrong, setWrong] = useState<Set<number>>(new Set())
  const toggle = (i: number) =>
    setWrong((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  return (
    <section className="mt-4 space-y-3 card">
      <p className="text-sm text-ink">{t('checkin.markHelp')}</p>
      <div className="flex flex-wrap gap-1.5">
        {words.map((w, i) => (
          <button
            key={i}
            onClick={() => toggle(i)}
            className={`rounded-lg border px-2.5 py-1.5 text-lg ${
              wrong.has(i) ? 'border-coral/40 bg-coral-soft text-coral-deep line-through' : 'border-line bg-white'
            }`}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onSave(words.map((_, i) => !wrong.has(i)))} disabled={busy}>
          {t('checkin.saveMarks')}
        </Button>
        <Button kind="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </section>
  )
}
