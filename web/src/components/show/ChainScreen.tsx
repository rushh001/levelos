import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changedClusters, clusters } from '../../lib/graphemes'
import { sound } from '../../lib/sound'
import { Button } from '../ui'
import type { ScreenProps } from './ShowClass'

/** Change one matra / one vowel: the chain's words one at a time, the changed syllable glowing. */
export function ChainScreen({ ex, celebrate, chain: given, title }: ScreenProps & { chain?: string; title?: string }) {
  const { t } = useTranslation()
  const chain = useMemo(
    () =>
      (given ?? ex.chain ?? '')
        .split('→')
        .map((s) => s.trim())
        .filter(Boolean),
    [given, ex.chain],
  )
  const [i, setI] = useState(0)
  if (chain.length === 0) return null
  const word = chain[i]
  const changed = i > 0 ? changedClusters(chain[i - 1], word) : clusters(word).map(() => false)
  const parts = clusters(word)
  const last = i === chain.length - 1

  const next = () => {
    if (last) return
    setI(i + 1)
    if (i + 1 === chain.length - 1) {
      sound.success()
      celebrate()
    } else sound.flip()
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-4">
      {title && <div className="text-sm font-semibold uppercase tracking-wide text-mute">{title}</div>}
      <div key={i} className="show-text rounded-4xl bg-white px-6 py-4 text-center font-semibold text-ink shadow-card pop">
        {parts.map((p, k) => (
          <span key={k} className={changed[k] ? 'rounded-2xl bg-sun-soft px-1 text-brand-deep ring-4 ring-sun/60' : ''}>
            {p}
          </span>
        ))}
      </div>
      <ol className="flex flex-wrap justify-center gap-2">
        {chain.map((w, k) => (
          <li
            key={k}
            className={`rounded-full px-3 py-1 text-lg transition ${
              k === i ? 'bg-brand text-white shadow-card' : k < i ? 'bg-leaf-soft text-leaf-deep' : 'bg-white text-mute shadow-card'
            }`}
          >
            {w}
          </li>
        ))}
      </ol>
      <div className="flex w-full max-w-sm gap-3">
        <Button kind="secondary" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="flex-1">
          ◀ {t('show.back')}
        </Button>
        {last ? (
          <Button onClick={() => setI(0)} className="flex-1">
            ↻ {t('show.again')}
          </Button>
        ) : (
          <Button onClick={next} className="flex-1 text-lg">
            {t('show.next')} ▶
          </Button>
        )}
      </div>
    </div>
  )
}
