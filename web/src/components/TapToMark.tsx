import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { itemTokens } from '../lib/content'
import type { ItemPublic } from '../lib/types'
import { Button } from './ui'


/**
 * The teacher marks every letter or word the child read wrongly. When the AI has listened to the recording first,
 * its marks are filled in (`initialWrong`) and the words it is unsure of carry a dot (`unsure`): the teacher checks,
 * changes any, and saves. Without the AI (no network, or it was too slow), the teacher marks from scratch.
 * To show the AI's marks after the teacher has opened the card, the parent remounts this with a new `key`; it
 * does that only while the teacher has not tapped anything (`onTouch`). While the child reads (`actions` false), it
 * has no Save or Cancel: the taps go to `onChange` and carry over to the marking that follows the recording.
 */
export function TapToMark({
  item,
  onSave,
  onCancel,
  busy,
  initialWrong,
  unsure,
  onTouch,
  note,
  onChange,
  actions = true,
}: {
  item: ItemPublic
  onSave: (marks: boolean[]) => void
  onCancel: () => void
  busy: boolean
  initialWrong?: ReadonlySet<number>
  unsure?: ReadonlySet<number>
  onTouch?: () => void
  note?: ReactNode
  onChange?: (wrong: ReadonlySet<number>) => void
  actions?: boolean
}) {
  const { t } = useTranslation()
  const words = useMemo(() => itemTokens(item), [item])
  const [wrong, setWrong] = useState<Set<number>>(() => new Set(initialWrong ?? []))
  const report = useRef(onChange)
  report.current = onChange
  useEffect(() => report.current?.(wrong), [wrong])
  const toggle = (i: number) => {
    onTouch?.()
    setWrong((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  return (
    <section className="mt-4 space-y-3 card">
      {note ?? <p className="text-sm text-ink">{t('checkin.markHelp')}</p>}
      <div className="flex flex-wrap gap-1.5">
        {words.map((w, i) => (
          <button
            key={i}
            onClick={() => toggle(i)}
            aria-pressed={wrong.has(i)}
            className={`relative rounded-lg border px-2.5 py-1.5 text-lg ${
              wrong.has(i) ? 'border-coral/40 bg-coral-soft text-coral-deep line-through' : 'border-line bg-white'
            }`}
          >
            {w}
            {unsure?.has(i) && (
              <span
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sun ring-2 ring-white"
                aria-label={t('phoneCheck.unsureWord')}
              />
            )}
          </button>
        ))}
      </div>
      {actions && (
        <div className="flex gap-2">
          <Button onClick={() => onSave(words.map((_, i) => !wrong.has(i)))} disabled={busy}>
            {t('checkin.saveMarks')}
          </Button>
          <Button kind="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      )}
    </section>
  )
}
