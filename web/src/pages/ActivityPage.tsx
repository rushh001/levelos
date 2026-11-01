import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { Api, OfflineError } from '../api'
import { SCREEN_ICON, ShowClass, hasShowScreen, screenKind } from '../components/show/ShowClass'
import { Button, COHORT_STYLE, ErrorBox, Page, Spinner } from '../components/ui'
import { activityExamples, bankActivities, fillExamples, textFor } from '../lib/content'
import { adaptWithLmStudio, lmStudioModel } from '../lib/lmstudio'
import { localActivities, makeLocalActivity, saveLocalActivity } from '../lib/localActivity'
import { rateActivity } from '../lib/outbox'
import { useReadingLang, useUiFollows } from '../lib/readingLang'
import type { Activity, Cohort } from '../lib/types'
import { pick, useUiLang } from '../lib/uiLang'

/** Generates a 10-minute activity for one reading group (or shows the latest) with its source and a rating. */
export default function ActivityPage() {
  const { id = '', cohort = 'word' } = useParams()
  const [params] = useSearchParams()
  const [readingLang] = useReadingLang()
  const lang = params.get('lang') || readingLang // the reading test the group was formed in
  useUiFollows(lang)
  const { t } = useTranslation()
  const ui = useUiLang()
  const [current, setCurrent] = useState<Activity | null>(null)
  const [previous, setPrevious] = useState<Activity[]>([])
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null) // what the wait is for, when not the usual
  const [error, setError] = useState<Error | null>(null)
  const [library, setLibrary] = useState<string | null>(null) // a bank activity opened straight as a screen
  const started = useRef(false)
  // Every activity with a "Show the class" screen for this group, so a teacher is never more than two taps away.
  const shelf = bankActivities(cohort, lang).filter((a) => hasShowScreen(a.id) && a.id !== current?.source_activity_id)

  // `history`: the group's activities, newest first (the page's own list once it is loaded).
  const generate = async (history?: Activity[]) => {
    setBusy(true)
    setBusyLabel(null)
    setError(null)
    try {
      let a: Activity
      try {
        a = await Api.generateActivity(id, cohort, lang)
      } catch (e) {
        // No network: the phone puts the activity together itself, by the same rules, from the bundled books.
        const earlier = history ?? [current, ...previous].filter((x): x is Activity => !!x)
        const local = e instanceof OfflineError ? makeLocalActivity(cohort as Cohort, lang, earlier) : null
        if (!local) throw e
        a = local
        // On a computer running LM Studio, its local model adapts the wording; otherwise the phone-made one stays.
        const model = await lmStudioModel()
        if (model) {
          setBusyLabel(t('activity.generatingLmStudio'))
          a = (await adaptWithLmStudio(model, local, ui)) ?? local
        }
        await saveLocalActivity(id, a)
      }
      setCurrent(a)
      setPrevious((p) => [...(current ? [current] : []), ...p].filter((x) => x.id !== a.id))
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Show today's activity if there is one; otherwise prepare one. The list joins the server's activities (its
    // copy on the phone when offline) with those made on this phone without network.
    Promise.all([
      Api.activities(id, cohort, lang).catch((e) => {
        if (e instanceof OfflineError) return [] as Activity[]
        throw e
      }),
      localActivities(id, cohort, lang),
    ])
      .then(([server, local]) => [...local, ...server].sort((x, y) => y.created_at.localeCompare(x.created_at)))
      .then((list) => {
        // Today's activity, if it fits the group's level: letters or words for a Letter or Word group, a text for
        // the Paragraph group (one made earlier under the old rules is replaced).
        const books = !!textFor(lang, 'rhyme')
        const fits = (a: Activity) => (cohort === 'letter' || cohort === 'word' ? !!a.plan.material : !!a.plan.text)
        const today = list.find(
          (a) => new Date(a.created_at).toDateString() === new Date().toDateString() && (fits(a) || !books),
        )
        // Earlier ones made under the old rules (a poem for a Letter group, say) are not offered again.
        const earlier = list.filter((a) => a.id !== today?.id && (fits(a) || !books))
        if (today) {
          setCurrent(today)
          setPrevious(earlier)
        } else {
          setPrevious(earlier)
          void generate(earlier)
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
    >
      <ErrorBox error={error} onRetry={() => void generate()} />
      {busy && <Spinner label={busyLabel ?? t('activity.generating')} />}
      {current && !busy && <ActivityCard a={current} classId={id} cohort={cohort as Cohort} lang={lang} onRated={setCurrent} />}
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

/** " (1806)" after the author, unless the author line already names the year ("The Æsop for Children (1919)"). */
const yearOf = (t: { author: string; year?: number | null }) =>
  t.year && !t.author.includes(String(t.year)) ? ` (${t.year})` : ''

function ActivityCard({ a, classId, cohort, lang, onRated }: { a: Activity; classId: string; cohort: Cohort; lang: string; onRated: (a: Activity) => void }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const p = a.plan
  const materials = pick(p.materials, ui) ?? []
  const [showing, setShowing] = useState(false)
  // An activity made on this phone is rated on the phone; the others on the server.
  const rate = async (n: number) => {
    if (!a.id.startsWith('local-')) return onRated(await rateActivity(a, n)) // offline: sent when the network is back
    const rated = { ...a, teacher_rating: n }
    await saveLocalActivity(classId, rated)
    onRated(rated)
  }
  return (
    <article className={`rounded-2xl border-2 p-4 ${COHORT_STYLE[cohort]}`}>
      <div className="text-xs text-mute">{a.generated_by.startsWith('lmstudio:')
          ? t('activity.fromLmStudio', { model: a.generated_by.slice('lmstudio:'.length) })
          : a.generated_by === 'phone'
            ? t('activity.fromPhone')
            : a.generated_by === 'bank'
              ? t('activity.fromBank')
              : t('activity.adapted')}</div>
      <h2 className="text-xl font-bold">{pick(p.title, ui)}</h2>
      {pick(p.why, ui) && <p className="mt-1 text-sm text-ink">{pick(p.why, ui)}</p>}

      {/* A Letter or Word group reads only these letters or words; the rhyme below is for the teacher to say. */}
      {p.material && p.material.items.length > 0 && (
        <div className="mt-3 rounded-2xl bg-white p-3">
          <div className="text-xs font-semibold uppercase text-mute">
            {p.material.kind === 'letters' ? t('activity.letters') : t('activity.words')}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {p.material.items.map((x) => (
              <span key={x} className="flex min-w-[3.5rem] flex-col items-center rounded-xl bg-paper px-3 py-1.5">
                <span className={`reading-text font-display ${p.material?.kind === 'letters' ? 'text-4xl' : 'text-2xl'}`}>{x}</span>
                {p.material?.anchors?.[x] && <span className="text-xs text-mute">{p.material.anchors[x]}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* A Letter or Word group never reads the rhyme: it stays folded away, for the teacher to say aloud. */}
      {p.text?.read_aloud && (
        <details className="mt-2 text-sm text-mute">
          <summary className="cursor-pointer select-none font-semibold text-brand underline underline-offset-4">
            {t('activity.showRhyme', { title: p.text.title })}
          </summary>
          <div className="mt-1 rounded-2xl bg-white p-3">
            <div className="text-xs">{t('activity.readAloud')}</div>
            <div className="mt-1 space-y-0.5">
              {p.text.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          </div>
        </details>
      )}

      {p.text && !p.text.read_aloud && (
        <div className="mt-3 rounded-2xl bg-white p-3">
          <div className="text-xs font-semibold uppercase text-mute">{t('activity.text')}</div>
          <div className="font-display text-lg text-ink">{p.text.title}</div>
          <div className="text-xs text-mute">
            {t('activity.by', { author: p.text.author })}
            {yearOf(p.text)}
          </div>
          <div className="reading-text mt-2 space-y-0.5 text-lg">
            {p.text.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
          {p.text.questions.length > 0 && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
              {p.text.questions.map((q, i) => (
                <li key={i}>
                  {q.q} <span className="text-mute">— {q.a}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

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

      {/* Paragraph and Story groups take homework on the text home; a list of single words is not for them. */}
      {pick(p.homework, ui) && (
        <div className="mt-3 rounded-xl bg-white p-3">
          <div className="text-xs font-semibold uppercase text-mute">{t('activity.homework')}</div>
          <p className="mt-1 text-sm text-ink">{pick(p.homework, ui)}</p>
        </div>
      )}

      {p.practice_words.length > 0 && !p.material && !p.text && (
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

      {/* A text activity credits the book its text comes from, then the NCERT curriculum goal it serves. */}
      {p.text && (
        <p className="mt-3 text-xs text-mute">
          {t('activity.textFrom')}: {p.text.title}, {p.text.author}
          {yearOf(p.text)} ·{' '}
          {p.text.licence === 'public domain' ? t('activity.publicDomain') : p.text.licence} ·{' '}
          <a href={p.text.source.url} target="_blank" rel="noreferrer" className="underline">
            {p.text.source.name}
          </a>
        </p>
      )}
      {a.source && (
        <p className={`${p.text ? 'mt-1' : 'mt-3'} text-xs text-mute`}>
          {p.text ? t('activity.curriculum') : t('activity.source')}:{' '}
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
