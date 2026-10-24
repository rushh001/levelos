import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { Api } from '../api'
import { Button, COHORT_STYLE, ErrorBox, Page, Spinner } from '../components/ui'
import type { Activity, Cohort } from '../lib/types'

/** Generates a 10-minute activity for one reading group (or shows the latest) with its source and a rating. */
export default function ActivityPage() {
  const { id = '', cohort = 'word' } = useParams()
  const { t } = useTranslation()
  const [current, setCurrent] = useState<Activity | null>(null)
  const [previous, setPrevious] = useState<Activity[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const started = useRef(false)

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const a = await Api.generateActivity(id, cohort)
      setCurrent(a)
      setPrevious((p) => p.filter((x) => x.id !== a.id))
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Show today's activity if there is one; otherwise prepare one.
    Api.activities(id, cohort)
      .then((list) => {
        const today = list.find((a) => new Date(a.created_at).toDateString() === new Date().toDateString())
        if (today) {
          setCurrent(today)
          setPrevious(list.filter((a) => a.id !== today.id))
        } else {
          setPrevious(list)
          void generate()
        }
      })
      .catch((e) => setError(e as Error))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cohort])

  return (
    <Page title={t(`cohort.${cohort}`)} back={`/class/${id}`}>
      <ErrorBox error={error} onRetry={() => void generate()} />
      {busy && <Spinner label={t('activity.generating')} />}
      {current && !busy && <ActivityCard a={current} cohort={cohort as Cohort} onRated={setCurrent} />}
      {!busy && (
        <Button kind="secondary" onClick={() => void generate()} className="mt-4 w-full">
          ↻ {t('activity.another')}
        </Button>
      )}
      {previous.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold">{t('activity.previous')}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {previous.slice(0, 5).map((a) => (
              <li key={a.id}>
                <button onClick={() => setCurrent(a)} className="text-blue-700 underline">
                  {a.plan.title.hi ?? a.plan.title.en}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}

function ActivityCard({ a, cohort, onRated }: { a: Activity; cohort: Cohort; onRated: (a: Activity) => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'hi' ? 'hi' : 'en'
  const p = a.plan
  const rate = async (n: number) => onRated(await Api.rateActivity(a.id, n))
  return (
    <article className={`rounded-2xl border-2 p-4 ${COHORT_STYLE[cohort]}`}>
      <div className="text-xs text-slate-600">{a.generated_by === 'bank' ? t('activity.fromBank') : t('activity.adapted')}</div>
      <h2 className="text-xl font-bold">{p.title[lang] ?? p.title.en}</h2>
      {(p.why[lang] || p.why.en) && <p className="mt-1 text-sm text-slate-700">{p.why[lang] || p.why.en}</p>}

      {(p.materials[lang] ?? p.materials.en ?? []).length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-slate-600">{t('activity.materials')}</div>
          <p className="text-sm">{(p.materials[lang] ?? p.materials.en ?? []).join(' · ')}</p>
        </div>
      )}

      <div className="mt-3">
        <div className="text-xs font-semibold uppercase text-slate-600">{t('activity.steps')}</div>
        <ol className="mt-1 space-y-2">
          {p.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl bg-white p-3">
              <span className="font-bold text-slate-500">{i + 1}</span>
              <div>
                <p>{s[lang] || s.en}</p>
                <p className="text-xs text-slate-500">{t('activity.minutes', { n: s.minutes })}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {p.practice_words.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-slate-600">{t('activity.practiceWords')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.practice_words.map((w) => (
              <span key={w} className="rounded-lg bg-white px-2 py-1 text-lg">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {(p.watch_for[lang] || p.watch_for.en) && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-slate-600">{t('activity.watchFor')}</div>
          <p className="text-sm">{p.watch_for[lang] || p.watch_for.en}</p>
        </div>
      )}

      {a.source && (
        <p className="mt-3 text-xs text-slate-600">
          {t('activity.source')}:{' '}
          <a href={a.source.url} target="_blank" rel="noreferrer" className="underline">
            {a.source.name}
          </a>{' '}
          — {a.source.note}
        </p>
      )}

      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="text-sm">{a.teacher_rating ? t('activity.rated') : t('activity.rate')}</div>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => void rate(n)}
              className={`text-2xl ${a.teacher_rating && n <= a.teacher_rating ? 'text-amber-500' : 'text-slate-300'}`}
              aria-label={`${n}`}
            >
              ★
            </button>
          ))}
        </div>
      </div>
    </article>
  )
}
