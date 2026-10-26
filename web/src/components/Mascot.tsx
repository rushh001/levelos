/**
 * The app's parrot, drawn in SVG so it costs nothing offline. A parrot, because in India it is the childhood
 * companion that talks (never an owl, which is an insult). Moods: idle (blinks), speaking (the beak moves while an
 * instruction plays), happy (a bounce after a card).
 */
export type Mood = 'idle' | 'speaking' | 'happy' | 'still'

/** `still` is for decorative places (headers, the ladder): no animation at all, so nothing runs in the background. */
export function Mascot({ mood = 'idle', size = 72, className = '' }: { mood?: Mood; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 124"
      width={size}
      height={size * (124 / 120)}
      aria-hidden
      className={`${mood === 'speaking' ? 'talking' : ''} ${mood === 'happy' ? 'cheer' : mood === 'idle' ? 'bob' : mood === 'still' ? 'no-blink' : ''} ${className}`}
    >
      {/* tail feathers */}
      <path d="M40 92 L12 118 L34 88 Z" fill="#1f8fa0" />
      <path d="M46 96 L24 121 L42 93 Z" fill="#2b6fd6" />
      {/* body, belly, wing */}
      <ellipse cx="60" cy="80" rx="30" ry="30" fill="#36b06f" />
      <ellipse cx="66" cy="88" rx="18" ry="19" fill="#9ae3b1" />
      <ellipse cx="44" cy="82" rx="12" ry="22" transform="rotate(-18 44 82)" fill="#258a55" />
      {/* feet */}
      <path d="M54 108 l-3 9 M60 110 v9 M66 108 l3 9" stroke="#f0a24b" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      {/* head and crest */}
      <circle cx="62" cy="42" r="27" fill="#3fbf7a" />
      <path d="M56 16 q6 -13 15 -5 q-7 0 -10 8 z" fill="#f5b63a" />
      {/* eye */}
      <circle cx="70" cy="38" r="8" fill="#fff" />
      <circle cx="72" cy="39" r="4" fill="#1b1f3b" />
      <circle cx="73.6" cy="37.2" r="1.4" fill="#fff" />
      <circle cx="70" cy="38" r="8.6" fill="#3fbf7a" className="mascot-eyelid" />
      <circle cx="79" cy="49" r="3.5" fill="#ff9ab3" opacity="0.75" />
      {/* beak: the lower half swings while speaking */}
      <path d="M85 40 q19 3 15 16 q-6 1 -16 -5 z" fill="#f0713f" />
      <path className="mascot-beak-lower" d="M85 49 q11 2 13 8 q-9 1 -14 -3 z" fill="#d9532f" />
    </svg>
  )
}
