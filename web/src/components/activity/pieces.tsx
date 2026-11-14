import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Picture, pictureFor } from '../../lib/pictures'
import { patternKey } from '../../lib/readingLang'
import type { ActivityFocus, ActivityMaterial, ActivityStep, Cohort } from '../../lib/types'

/** What happens in a step, as a picture: the model (or the bank) names it, the app draws it. */
export const STEP_ICON: Record<string, string> = {
  listen: '👂',
  say: '🗣️',
  show: '🃏',
  point: '👉',
  clap: '👏',
  write: '✍️',
  read: '📖',
  find: '🔍',
  sort: '🗂️',
  ask: '💬',
  turns: '🔄',
  join: '🧩',
}

export const stepIcon = (s: ActivityStep) => (s.icon && STEP_ICON[s.icon]) || null

/**
 * "Made for this group": the group's most common mistakes from their reading checks (how many children make each;
 * ✓ where this activity works on it), the letters or words it uses that the children misread, and why it was chosen.
 * Folded to one line by default (the main mistake and how many children make it); tap to see it all.
 */
export function FocusCard({ focus, cohort, lang, why }: { focus: ActivityFocus | null | undefined; cohort: Cohort; lang: string; why?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const children = focus?.children ?? 0
  const patterns = focus?.patterns ?? []
  const top = patterns[0]
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-2xl border border-brand/15 bg-white p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-xl" aria-hidden>
          🎯
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-tight text-brand-deep">{t('activity.focusTitle')}</span>
          <span className="block text-xs leading-snug text-mute">
            {top ? (
              <>
                <span className="font-semibold text-coral-deep">{t(patternKey(top.pattern, lang))}</span> ·{' '}
                {t('activity.focusKids', { count: top.children })}
              </>
            ) : (
              t('activity.focusNone')
            )}
          </span>
        </span>
        <span className={`shrink-0 text-mute transition ${open ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </summary>
      <p className="mt-3 text-xs text-mute">
        👥 {children ? t('activity.focusChildren', { count: children }) : t(`cohort.${cohort}`)}
      </p>
      {patterns.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {patterns.map((p) => (
            <li key={p.pattern} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  p.targeted ? 'bg-leaf text-white' : 'bg-line text-mute'
                }`}
                aria-hidden
              >
                {p.targeted ? '✓' : '·'}
              </span>
              <span className="min-w-0 flex-1 leading-tight text-ink">{t(patternKey(p.pattern, lang))}</span>
              <span className="shrink-0 rounded-full bg-coral-soft px-2 py-0.5 text-xs font-semibold text-coral-deep">
                {t('activity.focusKids', { count: p.children })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {patterns.some((p) => p.targeted) && <p className="mt-1 text-xs text-mute">✓ {t('activity.focusWorksOn')}</p>}
      {(focus?.misread.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-mute">⭐ {t('activity.focusMisread')}</span>
          {focus!.misread.map((w) => (
            <span key={w} className="rounded-lg bg-coral-soft px-2.5 py-0.5 text-base font-semibold text-coral-deep">
              {w}
            </span>
          ))}
        </div>
      )}
      {why && (
        <p className="mt-2 flex gap-1.5 rounded-xl bg-sun-soft p-2 text-sm text-ink">
          <span aria-hidden>💡</span>
          <span>{why}</span>
        </p>
      )}
    </details>
  )
}

/** The letters or single words a Letter or Word group reads, big; ⭐ marks the ones misread in their check. */
export function MaterialTiles({ material, misread, lang, big = false }: { material: ActivityMaterial; misread: string[]; lang: string; big?: boolean }) {
  const { t } = useTranslation()
  const letters = material.kind === 'letters'
  return (
    <div className="rounded-2xl bg-white p-3">
      <div className="text-xs font-semibold uppercase text-mute">{letters ? t('activity.letters') : t('activity.words')}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {material.items.map((x) => {
          const fromCheck = misread.includes(x)
          const word = letters ? material.anchors?.[x] : x
          return (
            <span
              key={x}
              className={`relative flex min-w-[3.5rem] max-w-full flex-col items-center rounded-xl px-3 py-1.5 ${
                fromCheck ? 'bg-coral-soft ring-2 ring-coral/60' : 'bg-paper'
              }`}
            >
              {fromCheck && (
                <span className="absolute -right-1.5 -top-1.5 text-sm" aria-label={t('activity.fromCheck')}>
                  ⭐
                </span>
              )}
              {!letters && pictureFor(x, lang) && <Picture word={x} lang={lang} size={big ? 44 : 30} />}
              <span className={`reading-face leading-tight ${letters ? (big ? 'text-6xl' : 'text-4xl') : big ? 'text-3xl' : 'text-2xl'}`}>{x}</span>
              {/* A letter's card carries a word for its sound, with its picture when the app has one (ग → गाय 🐄). */}
              {letters && word && (
                <span className="flex items-center gap-1 text-xs text-mute">
                  {pictureFor(word, lang) && <Picture word={word} lang={lang} size={big ? 28 : 20} />}
                  {word}
                </span>
              )}
            </span>
          )
        })}
      </div>
      {material.items.some((x) => misread.includes(x)) && <p className="mt-2 text-xs text-mute">⭐ {t('activity.fromCheck')}</p>}
    </div>
  )
}
