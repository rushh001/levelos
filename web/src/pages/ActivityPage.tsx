import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { Api } from '../api'
import { SCREEN_ICON, ShowClass, hasShowScreen, screenKind } from '../components/show/ShowClass'
import { Button, COHORT_STYLE, ErrorBox, Page, Spinner } from '../components/ui'
import { activityExamples, bankActivities, fillExamples } from '../lib/content'
import { useReadingLang } from '../lib/readingLang'
import type { Activity, Cohort } from '../lib/types'
import { pick, useUiLang } from '../lib/uiLang'

/** Generates a 10-minute activity for one reading group (or shows the latest) with its source and a rating. */
export default function ActivityPage() {
  const { id = '', cohort = 'word' } = useParams()
  const [params] = useSearchParams()
  const [readingLang] = useReadingLang()
  const lang = params.get('lang') || readingLang // the reading test the group was formed in
  const { t } = useTranslation()
  const ui = useUiLang()
  const [current, setCurrent] = useState<Activity | null>(null)
  const [previous, setPrevious] = useState<Activity[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [library, setLibrary] = useState<string | null>(null) // a bank activity opened straight as a screen
  const started = useRef(false)
  // Every activity with a "Show the class" screen for this group, so a teacher is never more than two taps away.
  const shelf = bankActivities(cohort, lang).filter((a) => hasShowScreen(a.id) && a.id !== current?.source_activity_id)

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const a = await Api.generateActivity(id, cohort, lang)
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
    Api.activities(id, cohort, lang)
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
  }, [id, cohort, lang])

  return (
    <Page
      title={t(`cohort.${cohort}`)}
      tag={t('readingTest.tag', { language: t(`lang.${lang}`, { defaultValue: lang }) })}
      back={`/class/${id}`}
      regional={params.get('cl')}
    >
      <ErrorBox error={error} onRetry={() => void generate()} />
      {busy && <Spinner label={t('activity.generating')} />}
      {current && !busy && <ActivityCard a={current} cohort={cohort as Cohort} lang={lang} onRated={setCurrent} />}
      {!busy && (
        <Button kind="secondary" onClick={() => void generate()} className="mt-4 w-full">
          ↻ {t('activity.another')}
        </Button>
      )}
      {shelf.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg text-ink">{t('show.library')}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 stagger">
            {shelf.map((a) => {
              const kind = screenKind(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => setLibrary(a.id)}
                  className="card flex items-center gap-3 p-3 text-left transition active:scale-[0.97]"
                >
                  <span className="text-2xl" aria-hidden>
                    {kind ? SCREEN_ICON[kind] : '▶'}
                  </span>
                  <span className="min-w-0 text-sm font-semibold leading-tight text-ink">
                    {fillExamples(pick(a.title, ui) ?? a.id, activityExamples(a.id, lang, ui))}
                  </span>
                </button>
              )
            })}
          </div>
          {library && (
            <ShowClass
              activity={{
                source_activity_id: library,
                plan: { title: shelf.find((a) => a.id === library)?.title ?? {}, practice_words: current?.plan.practice_words ?? [] },
              }}
              lang={lang}
              onClose={() => setLibrary(null)}
            />
          )}
        </section>
      )}

      {previous.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold">{t('activity.previous')}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {previous.slice(0, 5).map((a) => (
              <li key={a.id}>
                <button onClick={() => setCurrent(a)} className="text-brand underline underline-offset-4">
                  {pick(a.plan.title, ui)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}

function ActivityCard({ a, cohort, lang, onRated }: { a: Activity; cohort: Cohort; lang: string; onRated: (a: Activity) => void }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const p = a.plan
  const materials = pick(p.materials, ui) ?? []
  const [showing, setShowing] = useState(false)
  const rate = async (n: number) => onRated(await Api.rateActivity(a.id, n))
  return (
    <article className={`rounded-2xl border-2 p-4 ${COHORT_STYLE[cohort]}`}>
      <div className="text-xs text-mute">{a.generated_by === 'bank' ? t('activity.fromBank') : t('activity.adapted')}</div>
      <h2 className="text-xl font-bold">{pick(p.title, ui)}</h2>
      {pick(p.why, ui) && <p className="mt-1 text-sm text-ink">{pick(p.why, ui)}</p>}

      {hasShowScreen(a.source_activity_id) && (
        <Button onClick={() => setShowing(true)} className="mt-3 w-full text-lg">
          ▶ {t('show.button')}
        </Button>
      )}
      {showing && <ShowClass activity={a} lang={lang} onClose={() => setShowing(false)} />}

      {materials.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-mute">{t('activity.materials')}</div>
          <p className="text-sm">{materials.join(' · ')}</p>
        </div>
      )}

      <div className="mt-3">
        <div className="text-xs font-semibold uppercase text-mute">{t('activity.steps')}</div>
        <ol className="mt-1 space-y-2">
          {p.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl bg-white p-3">
              <span className="font-bold text-mute">{i + 1}</span>
              <div>
                <p>{pick(s, ui)}</p>
                <p className="text-xs text-mute">{t('activity.minutes', { n: s.minutes })}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {p.practice_words.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-mute">{t('activity.practiceWords')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.practice_words.map((w) => (
              <span key={w} className="rounded-lg bg-paper px-2.5 py-1 text-lg">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {pick(p.watch_for, ui) && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-mute">{t('activity.watchFor')}</div>
          <p className="text-sm">{pick(p.watch_for, ui)}</p>
        </div>
      )}

      {a.source && (
        <p className="mt-3 text-xs text-mute">
          {t('activity.source')}:{' '}
          <a href={a.source.url} target="_blank" rel="noreferrer" className="underline">
            {a.source.name}
          </a>{' '}
          — {a.source[`note_${ui}`] || a.source.note}
        </p>
      )}

      <div className="mt-4 border-t border-line pt-3">
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
