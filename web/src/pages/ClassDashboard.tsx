import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Api } from '../api'
import { Button, COHORT_STYLE, ChildChip, ErrorBox, Page, ReadingTestSwitch, Spinner } from '../components/ui'
import { patternKey, useReadingLang } from '../lib/readingLang'
import { useAsync } from '../lib/useAsync'

const WARM_EVERY_MS = 10 * 60_000
const warmedAt = new Map<string, number>() // class id -> when its children's pages were last cached

const AVATARS = ['🙂', '🦁', '🐰', '🐯', '🦋', '🌻', '🐘', '🐢', '🐦', '🐬', '🌈', '🐼', '🦅', '🌙', '🐆', '🌸', '⭐', '🐝']

export default function ClassDashboard() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const [lang, setLang] = useReadingLang()
  const { data, error, loading, reload } = useAsync(() => Api.dashboard(id, lang), [id, lang])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])

  // Load every child's page (and the groups in the class's other reading test) while online, so any child can be
  // opened and checked offline later. At most once per class every 10 minutes: on the free API server, refetching
  // 30 pages on every dashboard visit adds up.
  useEffect(() => {
    if (!data || !navigator.onLine || Date.now() - (warmedAt.get(id) ?? 0) < WARM_EVERY_MS) return
    warmedAt.set(id, Date.now())
    const ids = data.cohorts.flatMap((c) => c.students.map((s) => s.id)).concat(data.not_assessed.map((s) => s.id))
    const others = data.class.languages.filter((l) => l !== data.language)
    void (async () => {
      for (const l of others) await Api.dashboard(id, l).catch(() => undefined)
      for (const sid of ids) await Api.student(sid).catch(() => undefined)
    })()
  }, [data])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    await Api.addStudent(id, { first_name: name.trim(), avatar })
    setName('')
    setAdding(false)
    await reload()
  }

  if (loading && !data) return <Page back="/"><Spinner label={t('loading')} /></Page>

  return (
    <Page title={data?.class.name} back="/" wide>
      <ErrorBox error={error} onRetry={reload} />
      {data && data.pending_review.length > 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {t('dashboard.pendingReview', { count: data.pending_review.length })}
        </div>
      )}
      {data && (
        <>
          <div className="mb-3">
            <ReadingTestSwitch languages={data.class.languages} value={data.language} onChange={setLang} />
          </div>
          <h2 className="text-lg font-semibold">
            {t('dashboard.groups')}
            {data.class.languages.length > 1 && (
              <span className="font-normal text-slate-500"> · {t(`lang.${data.language}`, { defaultValue: data.language })}</span>
            )}
          </h2>
          <p className="mb-3 text-xs text-slate-500">{t('dashboard.groupsHint')}</p>
          <div className="grid gap-3 md:grid-cols-3">
            {data.cohorts.map((c) => (
              <section key={c.cohort} className={`rounded-2xl border-2 p-3 ${COHORT_STYLE[c.cohort]}`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="font-bold">{t(`cohort.${c.cohort}`)}</h3>
                  <span className="text-xs text-slate-600">{t(`cohort.${c.cohort}Hint`)}</span>
                </div>
                <p className="text-xs text-slate-600">
                  {t('dashboard.children', { count: c.students.length })} · {t('dashboard.confirmedCount', { count: c.confirmed })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.students.length === 0 && <span className="text-sm text-slate-500">{t('dashboard.noChildren')}</span>}
                  {c.students.map((s) => (
                    <ChildChip key={s.id} s={s} to={`/student/${s.id}`} />
                  ))}
                </div>
                {c.dominant_patterns.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-slate-600">{t('dashboard.topPatterns')}</div>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {c.dominant_patterns.map((p) => (
                        <li key={p}>
                          • {t(patternKey(p, data.language))} <span className="text-slate-500">({c.pattern_counts[p]})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.students.length > 0 && (
                  <Link
                    to={`/class/${id}/activity/${c.cohort}?lang=${data.language}`}
                    className="mt-3 block rounded-xl bg-white px-3 py-2 text-center text-sm font-semibold text-blue-700 shadow-sm"
                  >
                    ▶ {t('activity.button')}
                  </Link>
                )}
              </section>
            ))}
          </div>

          <h2 className="mt-6 text-lg font-semibold">{t('dashboard.notAssessed')}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.not_assessed.length === 0 && <span className="text-sm text-slate-500">—</span>}
            {data.not_assessed.map((s) => (
              <ChildChip key={s.id} s={s} to={`/student/${s.id}`} />
            ))}
          </div>

          {adding ? (
            <form onSubmit={add} className="mt-6 space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('dashboard.childName')}
                maxLength={80}
                className="w-full rounded-lg border px-3 py-3 text-lg"
                required
              />
              <div>
                <div className="text-sm text-slate-600">{t('dashboard.avatar')}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {AVATARS.map((a) => (
                    <button
                      type="button"
                      key={a}
                      onClick={() => setAvatar(a)}
                      className={`rounded-lg p-1.5 text-2xl ${avatar === a ? 'bg-blue-100 ring-2 ring-blue-500' : ''}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit">{t('dashboard.add')}</Button>
                <Button kind="secondary" onClick={() => setAdding(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <Button kind="secondary" onClick={() => setAdding(true)} className="mt-6 w-full md:w-auto">
              + {t('dashboard.addChild')}
            </Button>
          )}
        </>
      )}
    </Page>
  )
}
