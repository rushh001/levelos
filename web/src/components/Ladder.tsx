import { useTranslation } from 'react-i18next'
import type { ItemLevel } from '../lib/types'
import { Mascot } from './Mascot'

const RUNGS: ItemLevel[] = ['letter', 'word', 'paragraph', 'story']
const HEIGHT = [44, 60, 76, 92]

/** The ASER ladder as the child sees it: four steps climbing to the right, the parrot sitting on the card being
 * read, a star on every step already passed. A step that was not passed, or that the teacher skipped, just stays
 * quiet, so the child never sees a cross. */
export function Ladder({
  items,
  current,
}: {
  items: { level: ItemLevel; passed: boolean | null; skipped?: boolean }[]
  current: ItemLevel | null
}) {
  const { t } = useTranslation()
  const passed = new Set(items.filter((i) => i.passed && !i.skipped).map((i) => i.level))
  return (
    <ol className="mx-auto flex max-w-md items-end justify-center gap-1.5" aria-label="ladder">
      {RUNGS.map((r, i) => {
        const state = passed.has(r) ? 'passed' : r === current ? 'current' : 'ahead'
        const cls = {
          passed: 'bg-leaf text-white shadow-card',
          current: 'bg-brand text-white shadow-lift',
          ahead: 'border border-dashed border-line bg-white/70 text-mute',
        }[state]
        return (
          <li key={r} className="relative flex flex-1 flex-col items-center justify-end" style={{ height: `${HEIGHT[3] + 44}px` }}>
            {state === 'current' && (
              <span className="absolute left-1/2 -translate-x-1/2" style={{ bottom: `${HEIGHT[i] - 4}px` }}>
                <span className="block pop">
                  <Mascot mood="still" size={40} />
                </span>
              </span>
            )}
            <div
              className={`flex w-full flex-col items-center justify-end rounded-t-2xl pb-1.5 text-xs font-semibold transition-all ${cls}`}
              style={{ height: `${HEIGHT[i]}px` }}
            >
              {state === 'passed' && <span className="text-base leading-none text-sun">★</span>}
              <span>{t(`itemLevel.${r}`)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
