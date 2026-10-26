import { useEffect, useRef, useState } from 'react'

/** A cue only the teacher should read (the letter to say, the word to find) on a screen the class is looking
 * at: hidden behind an eye until the teacher taps it, shown for a moment, then hidden again. */
export function PeekCue({ render }: { render: (secret: boolean) => string }) {
  const [shown, setShown] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])
  const peek = () => {
    setShown(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(false), 1800)
  }
  return (
    <button onClick={peek} className="rounded-full bg-white px-4 py-1.5 text-base text-mute shadow-card transition active:scale-95">
      {shown ? render(true) : `👁 ${render(false)}`}
    </button>
  )
}
