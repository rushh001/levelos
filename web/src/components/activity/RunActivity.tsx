import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { sound } from '../../lib/sound'
import { stepText } from '../../lib/speech'
import type { Activity } from '../../lib/types'
import { pick } from '../../lib/uiLang'
import { MaterialTiles, stepIcon } from './pieces'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * "Start the 10 minutes": the activity one step at a time, full screen, for a teacher standing in front of the
 * group: the step's picture and its one line in large type, a timer for its minutes, the letters or words the
 * children read, 🔊 to hear the step, and Next. At the end, the teacher rates it.
 */
export function RunActivity({
  a,
  ui,
  lang,
  misread,
  onClose,
  onSpeak,
  onRate,
}: {
  a: Activity
  ui: string
  lang: string
  misread: string[]
  onClose: () => void
  onSpeak: (step: number) => void
  onRate: (n: number) => void
}) {
  const { t } = useTranslation()
  const p = a.plan
  const steps = p.steps
  const [i, setI] = useState(0) // steps.length: finished
  const [left, setLeft] = useState((steps[0]?.minutes ?? 0) * 60)
  const [running, setRunning] = useState(false)
  const done = i >= steps.length
  const s = steps[i]

  useEffect(() => setLeft((steps[i]?.minutes ?? 0) * 60), [i, steps])
  useEffect(() => {
    if (!running || done) return
    const id = window.setInterval(() => {
      setLeft((x) => {
        if (x <= 1) {
          sound.success()
          setRunning(false)
          return 0
        }
        return x - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [running, done])

  const go = (to: number) => {
    sound.tap()
    if (to >= steps.length) {
      setRunning(false)
      sound.fanfare()
    }
    setI(Math.max(0, Math.min(steps.length, to)))
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-paper pop" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <header className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={onClose}
          aria-label={t('show.close')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg text-ink shadow-card transition active:scale-95"
        >
          ✕
        </button>
        <div className="min-w-0 flex-1 truncate font-display text-lg text-brand-deep">{pick(p.title, ui)}</div>
        <div className="flex shrink-0 gap-1.5" aria-label={t('activity.stepOf', { n: Math.min(i + 1, steps.length), total: steps.length })}>
          {steps.map((_, k) => (
            <span key={k} className={`h-2.5 w-2.5 rounded-full ${k < i ? 'bg-leaf' : k === i ? 'bg-brand' : 'bg-line'}`} />
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 pb-4">
        {!done && s ? (
          <div className="mx-auto max-w-md space-y-4 pt-2 text-center">
            <div className="text-sm font-semibold uppercase tracking-wide text-mute">
              {t('activity.stepOf', { n: i + 1, total: steps.length })}
            </div>
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-white text-5xl shadow-card" aria-hidden>
              {stepIcon(s) ?? i + 1}
            </div>
            {s.icon && <div className="text-sm font-semibold text-brand">{t(`activity.icon.${s.icon}`)}</div>}
            <p className="font-display text-2xl leading-snug text-ink">{stepText(s, ui)}</p>
            <button onClick={() => onSpeak(i)} className="mx-auto flex items-center gap-2 rounded-full bg-brand-soft px-4 py-2 font-semibold text-brand-deep active:scale-95">
              🔊 {t('activity.hearStep')}
            </button>

            <div className="flex items-center justify-center gap-3 rounded-2xl bg-white p-3 shadow-card">
              <span className={`font-display text-4xl tabular-nums ${left === 0 ? 'text-leaf-deep' : 'text-ink'}`}>⏱ {clock(left)}</span>
              <button
                onClick={() => setRunning((r) => !r)}
                className="rounded-full bg-brand px-4 py-2 font-semibold text-white shadow-lift active:scale-95"
              >
                {running ? `⏸ ${t('activity.pause')}` : `▶ ${t('activity.startTimer')}`}
              </button>
              <button onClick={() => setLeft((x) => x + 60)} className="rounded-full bg-paper px-3 py-2 text-sm text-mute active:scale-95">
                +1 {t('activity.min')}
              </button>
            </div>
            {left === 0 && <p className="text-sm font-semibold text-leaf-deep">{t('activity.timeUp')}</p>}

            {p.material && p.material.items.length > 0 && <MaterialTiles material={p.material} misread={misread} lang={lang} big />}
            {p.text && !p.text.read_aloud && (
              <div className="rounded-2xl bg-white p-3 text-left">
                <div className="font-display text-lg text-ink">{p.text.title}</div>
                <div className="reading-face mt-1 space-y-1.5 text-[1.625rem] leading-relaxed text-ink">
                  {p.text.lines.map((l, k) => (
                    <p key={k}>{l}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-4 pt-10 text-center">
            <div className="text-6xl" aria-hidden>
              🎉
            </div>
            <p className="font-display text-2xl text-ink">{t('activity.finished')}</p>
            <p className="text-mute">{a.teacher_rating ? t('activity.rated') : t('activity.rate')}</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onRate(n)}
                  className={`text-4xl ${a.teacher_rating && n <= a.teacher_rating ? 'text-amber-500' : 'text-slate-300'}`}
                  aria-label={`${n}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer
        className="flex gap-2 border-t border-line bg-white px-4 py-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        {done ? (
          <button onClick={onClose} className="flex-1 rounded-2xl bg-brand py-3 text-lg font-semibold text-white shadow-lift active:scale-[0.98]">
            {t('activity.close')}
          </button>
        ) : (
          <>
            <button
              onClick={() => go(i - 1)}
              disabled={i === 0}
              className="rounded-2xl border border-line px-4 py-3 font-semibold text-ink disabled:opacity-40"
            >
              ← {t('back')}
            </button>
            <button onClick={() => go(i + 1)} className="flex-1 rounded-2xl bg-brand py-3 text-lg font-semibold text-white shadow-lift active:scale-[0.98]">
              {i + 1 < steps.length ? `${t('next')} →` : `✓ ${t('activity.finish')}`}
            </button>
          </>
        )}
      </footer>
    </div>,
    document.body,
  )
}
