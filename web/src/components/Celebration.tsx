import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cheer } from '../lib/cheer'
import { sound } from '../lib/sound'
import { Mascot } from './Mascot'
import { Stars } from './Stars'

/** A second of stars, a fanfare and the parrot's bounce after every card, in the child's language. Tap to skip. */
export function Celebration({ lang, n, onDone, ms = 1500 }: { lang: string; n: number; onDone: () => void; ms?: number }) {
  // The callback lives in a ref, so a parent re-render never restarts the fanfare or the timer.
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    sound.fanfare()
    const timer = window.setTimeout(() => done.current(), ms)
    return () => window.clearTimeout(timer)
  }, [ms])

  // A portal: the page's enter animation would otherwise make the page, not the screen, the overlay's frame.
  return createPortal(
    <div
      role="status"
      onClick={() => done.current()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 pop"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="relative flex flex-col items-center gap-3">
        <Stars seed={n} />
        <Mascot mood="happy" size={120} />
        <div className="font-display text-5xl text-brand-deep" style={{ textWrap: 'balance' }}>
          {cheer(lang, n)}
        </div>
      </div>
    </div>,
    document.body,
  )
}
