import { useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { Api, OfflineError, isReachable, noServer } from '../api'
import { ListenBar, type ListenHandle } from '../components/activity/ListenBar'
import { FocusCard, MaterialTiles, stepIcon } from '../components/activity/pieces'
import { RunActivity } from '../components/activity/RunActivity'
import { SCREEN_ICON, ShowClass, hasShowScreen, screenKind } from '../components/show/ShowClass'
import { Button, COHORT_STYLE, ErrorBox, Page, Spinner } from '../components/ui'
import { activityExamples, bankActivities, fillExamples } from '../lib/content'
import { adaptWithLmStudio, lmStudioModel } from '../lib/lmstudio'
import { fitsGroup, localActivities, makeLocalActivity, saveLocalActivity, todaysActivity } from '../lib/localActivity'
import { rateActivity } from '../lib/outbox'
import { sound } from '../lib/sound'
import { bookClips, keepRecording, saveRecordings, speechParts, stepText } from '../lib/speech'
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
        // The header says Offline: no wait on the network, the phone makes it.
        if (!navigator.onLine || !isReachable()) throw new OfflineError('offline')
        a = await Api.generateActivity(id, cohort, lang)
      } catch (e) {
        // No network (or the server failing for now): the phone puts the activity together itself, by the same
        // rules, from the bundled books.
        const earlier = history ?? [current, ...previous].filter((x): x is Activity => !!x)
        // The group's mistakes from the phone's copy of the class page, so the activity still works on them.
        const card = noServer(e) ? (await Api.dashboard(id, lang).catch(() => null))?.cohorts.find((c) => c.cohort === cohort) : undefined
        const group = card ? { children: card.students.length, pattern_counts: card.pattern_counts } : undefined
        const local = noServer(e) ? makeLocalActivity(cohort as Cohort, lang, earlier, group) : null
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
        if (noServer(e)) return [] as Activity[]
        throw e
      }),
      localActivities(id, cohort, lang),
    ])
      .then(([server, local]) => [...local, ...server].sort((x, y) => y.created_at.localeCompare(x.created_at)))
      .then((list) => {
        // Today's activity, if it fits the group's level (one made earlier under the old rules is replaced).
        const today = todaysActivity(list, cohort, lang)
        // Earlier ones made under the old rules (a poem for a Letter group, say) are not offered again.
        const earlier = list.filter((a) => a.id !== today?.id && fitsGroup(a, cohort, lang))
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
  // The recorded lines for this language, should the phone not have them yet (a look at the cache when it has).
  useEffect(() => void saveRecordings([lang]), [lang])

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
                  className="card flex min-w-0 items-center gap-3 p-3 text-left transition active:scale-[0.97]"
                >
                  <span className="text-2xl" aria-hidden>
                    {kind ? SCREEN_ICON[kind] : '▶'}
                  </span>
                  <span className="min-w-0 text-sm font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
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

/** Who made the activity, as a small label above it. */
function madeBy(a: Activity, t: TFunction): string {
  if (a.generated_by.startsWith('lmstudio:')) return `💻 ${t('activity.fromLmStudio', { model: a.generated_by.slice('lmstudio:'.length) })}`
  if (a.generated_by === 'phone') return `📱 ${t('activity.fromPhone')}`
  if (a.generated_by === 'bank') return `📘 ${t('activity.fromBank')}`
  return `✨ ${t('activity.adapted')}`
}

/**
 * One activity, made to be taken in at a glance: first what it is for (the group's own mistakes from their reading
 * checks), then a 🔊 to hear it all, the letters or words the children read, two big buttons (run it step by step,
 * show the class), the steps as one short line each with a picture, and everything else folded under "More details".
 */
function ActivityCard({ a, classId, cohort, lang, onRated }: { a: Activity; classId: string; cohort: Cohort; lang: string; onRated: (a: Activity) => void }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const p = a.plan
  const materials = pick(p.materials, ui) ?? []
  const homework = pick(p.homework, ui)
  const watchFor = pick(p.watch_for, ui)
  const misread = p.focus?.misread ?? []
  const [showing, setShowing] = useState(false)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<number[]>([])
  const [reading, setReading] = useState<string | null>(null) // the part being read aloud
  const listen = useRef<ListenHandle>(null)
  const parts = useMemo(() => speechParts(a, ui, lang, t), [a, ui, lang, t])
  const clips = useMemo(() => bookClips(a, ui), [a, ui])
  // Seen online, the activity's recording is kept on the phone, so it can be heard offline later.
  useEffect(() => void keepRecording(ui, parts), [parts, ui])
  const hear = (step: number) => listen.current?.playPart(parts.findIndex((x) => x.key === `step-${step}`))

  // An activity made on this phone is rated on the phone; the others on the server.
  const rate = async (n: number) => {
    if (!a.id.startsWith('local-')) return onRated(await rateActivity(a, n)) // offline: sent when the network is back
    const rated = { ...a, teacher_rating: n }
    await saveLocalActivity(classId, rated)
    onRated(rated)
  }
  const toggleDone = (i: number) => {
    sound.tap()
    setDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))
  }

  return (
    <article className={`space-y-3 rounded-2xl border-2 p-4 ${COHORT_STYLE[cohort]}`}>
      <div>
        <div className="text-xs text-mute">{madeBy(a, t)}</div>
        <h2 className="text-xl font-bold leading-tight">{pick(p.title, ui)}</h2>
      </div>

      <FocusCard focus={p.focus} cohort={cohort} lang={lang} why={pick(p.why, ui)} />
      <ListenBar key={`${a.id}-${ui}`} ref={listen} parts={parts} ui={ui} onPart={setReading} clips={clips} />

      {/* A Letter or Word group reads only these letters or words; the rhyme below is for the teacher to say. */}
      {p.material && p.material.items.length > 0 && <MaterialTiles material={p.material} misread={misread} lang={lang} />}

      {/* A Letter or Word group never reads the rhyme: it stays folded away, for the teacher to say aloud. */}
      {p.text?.read_aloud && (
        <details className="text-sm text-mute">
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
        <div className="rounded-2xl bg-white p-3">
          <div className="text-xs font-semibold uppercase text-mute">{t('activity.text')}</div>
          <div className="font-display text-lg text-ink">{p.text.title}</div>
          <div className="text-xs text-mute">
            {t('activity.by', { author: p.text.author })}
            {yearOf(p.text)}
          </div>
          <div className="reading-face mt-2 space-y-1.5 text-[1.375rem] leading-relaxed text-ink">
            {p.text.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
          {p.text.questions.length > 0 && (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-base">
              {p.text.questions.map((q, i) => (
                <li key={i}>
                  {q.q} <span className="text-mute">— {q.a}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Button onClick={() => setRunning(true)} className="w-full text-lg">
          ⏱ {t('activity.start')}
        </Button>
        {hasShowScreen(a.source_activity_id) && (
          <Button kind="secondary" onClick={() => setShowing(true)} className="w-full">
            🖐️ {t('show.button')}
          </Button>
        )}
      </div>
      {showing && <ShowClass activity={a} lang={lang} onClose={() => setShowing(false)} />}
      {running && (
        <RunActivity a={a} ui={ui} lang={lang} misread={misread} onClose={() => setRunning(false)} onSpeak={hear} onRate={(n) => void rate(n)} />
      )}

      {materials.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-mute">🧰 {t('activity.materials')}:</span>
          {materials.map((m) => (
            <span key={m} className="rounded-full bg-white px-2.5 py-1 text-ink">
              {m}
            </span>
          ))}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-mute">{t('activity.steps')}</h3>
          <span className="text-xs text-mute">{t('activity.doneOf', { done: done.length, total: p.steps.length })}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${(done.length / Math.max(p.steps.length, 1)) * 100}%` }} />
        </div>
        <ol className="mt-2 space-y-2">
          {p.steps.map((s, i) => {
            const isDone = done.includes(i)
            return (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-2xl bg-white p-3 transition ${reading === `step-${i}` ? 'shadow-lift ring-2 ring-brand' : ''}`}
              >
                <button
                  onClick={() => toggleDone(i)}
                  aria-pressed={isDone}
                  aria-label={t('activity.markDone', { n: i + 1 })}
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl transition active:scale-90 ${
                    isDone ? 'bg-leaf text-white' : 'bg-brand-soft'
                  }`}
                >
                  {isDone ? '✓' : (stepIcon(s) ?? <span className="text-lg font-bold text-brand">{i + 1}</span>)}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-mute">
                    <span className="min-w-0 truncate">
                      {t('activity.stepN', { n: i + 1 })}
                      {s.icon ? ` · ${t(`activity.icon.${s.icon}`)}` : ''}
                    </span>
                    <span className="ml-auto shrink-0 rounded-full bg-paper px-2 py-0.5">⏱ {t('activity.minutes', { n: s.minutes })}</span>
                  </div>
                  <p className={`mt-0.5 leading-snug ${isDone ? 'text-mute line-through decoration-leaf/60' : 'text-ink'}`}>{stepText(s, ui)}</p>
                </div>
                <button
                  onClick={() => hear(i)}
                  aria-label={t('activity.hearStep')}
                  className="shrink-0 rounded-full p-1.5 text-lg transition active:scale-90 active:bg-brand-soft"
                >
                  🔊
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      {/* Paragraph and Story groups take homework on the text home; a list of single words is not for them. */}
      {homework && (
        <div className="flex gap-3 rounded-2xl bg-white p-3">
          <span className="text-2xl" aria-hidden>
            🏠
          </span>
          <div>
            <div className="text-xs font-semibold uppercase text-mute">{t('activity.homework')}</div>
            <p className="mt-0.5 text-sm text-ink">{homework}</p>
          </div>
        </div>
      )}

      <details className="rounded-2xl bg-white p-3 text-sm">
        <summary className="cursor-pointer select-none font-semibold text-brand">ℹ️ {t('activity.moreDetails')}</summary>
        <div className="mt-2 space-y-3">
          {watchFor && (
            <div>
              <div className="text-xs font-semibold uppercase text-mute">👀 {t('activity.watchFor')}</div>
              <p>{watchFor}</p>
            </div>
          )}
          {p.practice_words.length > 0 && !p.material && !p.text && (
            <div>
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
          {/* A text activity credits the book its text comes from, then the NCERT curriculum goal it serves. */}
          {p.text && (
            <p className="text-xs text-mute">
              {t('activity.textFrom')}: {p.text.title}, {p.text.author}
              {yearOf(p.text)} ·{' '}
              {p.text.licence === 'public domain' ? t('activity.publicDomain') : p.text.licence} ·{' '}
              <a href={p.text.source.url} target="_blank" rel="noreferrer" className="underline">
                {p.text.source.name}
              </a>
            </p>
          )}
          {a.source && (
            <p className="text-xs text-mute">
              {p.text ? t('activity.curriculum') : t('activity.source')}:{' '}
              <a href={a.source.url} target="_blank" rel="noreferrer" className="underline">
                {a.source.name}
              </a>{' '}
              — {a.source[`note_${ui}`] || a.source.note}
            </p>
          )}
        </div>
      </details>

      <div className="border-t border-line pt-3">
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
