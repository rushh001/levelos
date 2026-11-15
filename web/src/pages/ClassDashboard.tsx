import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Api } from '../api'
import { Button, COHORT_STYLE, ChildChip, CohortIcon, ErrorBox, Page, ReadingTestSwitch, Spinner } from '../components/ui'
import { nameIn } from '../lib/names'
import { addChild } from '../lib/outbox'
import { ReadyLine } from '../components/OfflineReady'
import { saveClassPagesNow, useSaveForOffline } from '../lib/saveOffline'
import { patternKey, useReadingLang } from '../lib/readingLang'
import { useUiLang } from '../lib/uiLang'
import { useAsync } from '../lib/useAsync'

const AVATARS = ['🙂', '🦁', '🐰', '🐯', '🦋', '🌻', '🐘', '🐢', '🐦', '🐬', '🌈', '🐼', '🦅', '🌙', '🐆', '🌸', '⭐', '🐝']

export default function ClassDashboard() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const ui = useUiLang()
  const [lang, setLang] = useReadingLang()
  const { data, error, loading, reload } = useAsync(() => Api.dashboard(id, lang), [id, lang], { refreshOnSync: true })
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false) // a double tap adds the child once
  const [addError, setAddError] = useState<Error | null>(null)
  const [name, setName] = useState('')
  const [otherName, setOtherName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])
  useSaveForOffline(id, data) // every child, both reading tests and the groups' activities, for use with no network

  // The name's second spelling: in the class's language when the app is in English, else in English.
  const other = ui === 'en' ? (data?.class.language ?? 'hi') : 'en'
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const first = name.trim()
    const second = otherName.trim()
    setSaving(true)
    setAddError(null)
    try {
      await addChild(id, { first_name: first, avatar, names: second ? { [ui]: first, [other]: second } : undefined }) // offline too
      setName('')
      setOtherName('')
      setAdding(false)
      await reload()
      void saveClassPagesNow(id) // the new child opens with no network too, right away
    } catch (err) {
      setAddError(err as Error)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <Page back="/classes"><Spinner label={t('loading')} /></Page>

  // Children with a reading check waiting for the teacher's confirmation: one tap opens that check.
  const waiting = data
    ? [...data.cohorts.flatMap((c) => c.students), ...data.not_assessed].filter((s) => s.review_checkin_id)
    : []

  return (
    <Page title={data ? nameIn(data.class, data.class.name, ui) : undefined} back="/classes" wide>
      <ErrorBox error={error} onRetry={reload} />
      {waiting.length > 0 && (
        <div className="mb-4 rounded-2xl bg-sun-soft p-3 text-sm text-sun-deep">
          <p>{t('dashboard.pendingReview', { count: waiting.length })}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {waiting.map((s) => (
              <ChildChip key={s.id} s={s} to={`/result/${s.review_checkin_id}`} />
            ))}
          </div>
        </div>
      )}
      {data && (
        <>
          <div className="mb-3">
            <ReadingTestSwitch languages={data.class.languages} value={data.language} onChange={setLang} />
          </div>
          <h2 className="font-display text-xl text-ink">
            {t('dashboard.groups')}
            {data.class.languages.length > 1 && (
              <span className="font-normal text-mute"> · {t(`lang.${data.language}`, { defaultValue: data.language })}</span>
            )}
          </h2>
          <p className="mb-1 text-xs text-mute">{t('dashboard.groupsHint')}</p>
          <ReadyLine classId={id} />
          <div className="grid gap-3 md:grid-cols-3 stagger">
            {data.cohorts.map((c) => (
              <section key={c.cohort} className={`rounded-3xl border-2 p-3 shadow-card ${COHORT_STYLE[c.cohort]}`}>
                <div className="flex items-center gap-2">
                  <CohortIcon cohort={c.cohort} lang={data.language} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg leading-tight text-ink">{t(`cohort.${c.cohort}`)}</h3>
                    <span className="text-xs text-mute">{t(`cohort.${c.cohort}Hint`)}</span>
                  </div>
                </div>
                <p className="text-xs text-mute">
                  {t('dashboard.children', { count: c.students.length })} · {t('dashboard.confirmedCount', { count: c.confirmed })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.students.length === 0 && <span className="text-sm text-mute">{t('dashboard.noChildren')}</span>}
                  {c.students.map((s) => (
                    <ChildChip key={s.id} s={s} to={`/student/${s.id}`} />
                  ))}
                </div>
                {c.dominant_patterns.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-mute">{t('dashboard.topPatterns')}</div>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {c.dominant_patterns.map((p) => (
                        <li key={p}>
                          • {t(patternKey(p, data.language))} <span className="text-mute">({c.pattern_counts[p]})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.students.length > 0 && (
                  <Link
                    to={`/class/${id}/activity/${c.cohort}?lang=${data.language}`}
                    className="mt-3 block rounded-xl bg-white px-3 py-2 text-center text-sm font-semibold text-brand shadow-card"
                  >
                    ▶ {t('activity.button')}
                  </Link>
                )}
              </section>
            ))}
          </div>

          <h2 className="mt-6 font-display text-xl text-ink">{t('dashboard.notAssessed')}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.not_assessed.length === 0 && <span className="text-sm text-mute">—</span>}
            {data.not_assessed.map((s) => (
              <ChildChip key={s.id} s={s} to={`/student/${s.id}`} />
            ))}
          </div>

          {adding ? (
            <form onSubmit={add} className="mt-6 space-y-3 card">
              <ErrorBox error={addError} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('dashboard.childName')}
                maxLength={80}
                className="field"
                required
              />
              <input
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                placeholder={t('dashboard.otherName', { language: t(`lang.${other}`) })}
                maxLength={80}
                className="field py-2 text-base"
              />
              <div>
                <div className="text-sm text-mute">{t('dashboard.avatar')}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {AVATARS.map((a) => (
                    <button
                      type="button"
                      key={a}
                      onClick={() => setAvatar(a)}
                      className={`rounded-lg p-1.5 text-2xl ${avatar === a ? 'bg-brand-soft ring-2 ring-brand' : ''}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>{t('dashboard.add')}</Button>
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
