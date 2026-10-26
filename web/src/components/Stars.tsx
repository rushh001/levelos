import { useMemo } from 'react'

const COLORS = ['#f5b63a', '#4338ca', '#2f9e5b', '#e5484d', '#1f8fa0']

/** A burst of stars from the centre of its (relatively positioned) parent. Deterministic, so it looks the same on
 * every phone. */
export function Stars({ n = 18, seed = 0, spread = 90 }: { n?: number; seed?: number; spread?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const angle = (i / n) * Math.PI * 2 + (seed % 3) * 0.4
        const dist = spread + ((i * 37) % 70)
        return {
          dx: `${Math.cos(angle) * dist}px`,
          dy: `${Math.sin(angle) * dist - 30}px`,
          rot: `${((i * 53) % 180) - 90}deg`,
          color: COLORS[i % COLORS.length],
          delay: `${(i % 6) * 40}ms`,
          size: 14 + ((i * 7) % 12),
        }
      }),
    [n, seed, spread],
  )
  return (
    <>
      {stars.map((s, i) => (
        <svg
          key={i}
          className="star"
          width={s.size}
          height={s.size}
          viewBox="0 0 24 24"
          aria-hidden
          style={{ '--dx': s.dx, '--dy': s.dy, '--rot': s.rot, animationDelay: s.delay } as React.CSSProperties}
        >
          <path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7z" fill={s.color} />
        </svg>
      ))}
    </>
  )
}
