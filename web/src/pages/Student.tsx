import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Api, OfflineError } from '../api'
import { db } from '../db'
import { hasBank } from '../lib/content'
import { nameIn, withName } from '../lib/names'
import { startOffline } from '../lib/offline'
import { patternKey, useReadingLang } from '../lib/readingLang'
import { Button, ErrorBox, LevelBadge, Page, ReadingTestSwitch, Spinner, formatDate } from '../components/ui'
import type { Checkin, Cohort } from '../lib/types'
import { pick, useUiLang } from '../lib/uiLang'
import { useAsync } from '../lib/useAsync'

const COHORTS: Cohort[] = ['letter', 'word', 'paragraph']

function latestDiagnosis(list: Checkin[], language: string) {
  return list.find(
    (c) => c.language === language && c.diagnosis && (c.status === 'scored' || c.status === 'needs_review'),
  )
}

function LangTag({ lang }: { lang: string }) {
  const { t } = useTranslation()
  return <span className="rounded-md bg-paper px-1.5 py-0.5 text-[11px] text-mute">{t(`lang.${lang}`, { defaultValue: lang })}</span>
}

export default function Student() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: s, error, loading, reload } = useAsync(() => Api.student(id), [id])
  const [lang, setLang] = useReadingLang(s?.languages)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<Error | null>(null)
  const uiLang = useUiLang()
  const local = useLiveQuery(() => db.checkins.where('studentId').equals(id).reverse().sortBy('startedAt'), [id])

  if (loading && !s) return <Page back><Spinner label={t('loading')} /></Page>
  if (!s) return <Page back><ErrorBox error={error} onRetry={reload} /></Page>

  const level = s.levels[lang]
  const langName = t(`lang.${lang}`, { defaultValue: lang })

  const start = async () => {
    setStarting(true)
    setStartError(null)
    const offline = async () => navigate(`/offline/${await startOffline(s, lang)}`)
    try {
      if (!navigator.onLine && hasBank(lang)) return await offline()
      const c = await Api.startCheckin(s.id, lang)
      navigate(`/checkin/${c.id}`)
    } catch (e) {
      if (e instanceof OfflineError && hasBank(lang)) await offline()
      else setStartError(e as Error)
    } finally {
      setStarting(false)
    }
  }

  const moveTo = async (value: string) => {
    await Api.patchStudent(
      s.id,
      value === 'auto' ? { clear_cohort_override: true, language: lang } : { cohort_override: value, language: lang },
    )
    await reload()
  }

  const last = latestDiagnosis(s.checkins_list, lang)
  const unfinished = s.checkins_list.find((c) => c.status === 'in_progress' && c.language === lang)

  return (
    <Page title={nameIn(s, s.first_name, uiLang)} back={`/class/${s.class_id}`}>
      <div className="flex items-center gap-4 card">
        <div className="text-5xl">{s.avatar}</div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {s.languages.map((l) => {
            const lv = s.levels[l]
            return (
              <div key={l} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${l === lang ? '' : 'opacity-60'}`}>
                <span className="w-16 shrink-0 text-xs font-medium text-mute">{t(`lang.${l}`, { defaultValue: l })}</span>
                <LevelBadge level={lv?.level ?? null} confirmed={lv?.level ? lv.level_confirmed : undefined} />
                {lv?.level && (
                  <span className="text-xs text-mute">
                    {lv.level_confirmed ? t('student.confirmed') : t('student.provisional')}
                  </span>
                )}
              </div>
            )
          })}
          {s.languages.some((l) => s.levels[l]?.level && !s.levels[l].level_confirmed) && (
            <p className="text-xs text-mute">{t('student.provisionalHelp')}</p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <ReadingTestSwitch languages={s.languages} value={lang} onChange={setLang} />
        {unfinished ? (
          <Button onClick={() => navigate(`/checkin/${unfinished.id}`)} className="w-full text-lg">
            {t('readingTest.start', { language: langName })} ({t('student.inProgress')})
          </Button>
        ) : (
          <Button onClick={start} disabled={starting} className="w-full py-4 text-lg">
            🎤 {t('readingTest.start', { language: langName })}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <ErrorBox error={startError} />
      </div>

      {last?.diagnosis && (
        <section className="mt-5 card">
          <h2 className="flex items-center gap-2 font-semibold">
            {t('result.diagnosis')} <LangTag lang={lang} />
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {last.diagnosis.error_patterns.map((p) => (
              <span key={p} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-sm font-medium text-brand-deep">
                {t(patternKey(p, lang))}
              </span>
            ))}
          </div>
          <p className="mt-2 text-ink">{withName(pick(last.diagnosis.summary, uiLang) ?? '', s, uiLang)}</p>
        </section>
      )}

      <section className="mt-5">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{t('readingTest.groupFor', { language: langName })}</span>
          <select
            value={level?.cohort_override ?? 'auto'}
            onChange={(e) => void moveTo(e.target.value)}
            className="select"
          >
            <option value="auto">
              {t('student.autoGroup')}
              {level?.cohort && !level.cohort_override ? ` (${t(`cohort.${level.cohort}`)})` : ''}
            </option>
            {COHORTS.map((c) => (
              <option key={c} value={c}>
                {t(`cohort.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-mute">
          {level?.cohort_override
            ? t('student.groupStart', { level: t(`level.${level.cohort_override}`) })
            : t('student.autoStart')}
        </p>
        {level?.cohort && (
          <Link
            to={`/class/${s.class_id}/activity/${level.cohort}?lang=${lang}`}
            className="mt-3 block rounded-2xl bg-white px-4 py-3 text-center font-semibold text-brand shadow-card transition active:scale-[0.98]"
          >
            ▶ {t('activity.button')} · {t(`cohort.${level.cohort}`)}
          </Link>
        )}
      </section>

      {local && local.some((c) => c.status !== 'synced') && (
        <section className="mt-5">
          <h2 className="font-semibold">{t('offlineCheck.onPhone')}</h2>
          <ul className="mt-2 divide-y rounded-3xl bg-sun-soft shadow-card">
            {local
              .filter((c) => c.status !== 'synced')
              .map((c) => (
                <li key={c.localId}>
                  <Link to={`/offline/${c.localId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm text-mute">
                      {formatDate(new Date(c.startedAt).toISOString(), uiLang)} <LangTag lang={c.language} />
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      {c.status === 'in_progress'
                        ? t('student.inProgress')
                        : c.status === 'failed'
                          ? t('offlineCheck.failedShort')
                          : t('offlineCheck.waiting')}
                      {c.provisionalLevel && <LevelBadge level={c.provisionalLevel} confirmed={false} />}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="mt-5">
        <h2 className="font-semibold">{t('student.history')}</h2>
        {s.checkins_list.length === 0 && <p className="mt-2 text-sm text-mute">{t('student.noHistory')}</p>}
        <ul className="mt-2 divide-y rounded-3xl bg-white shadow-card">
          {s.checkins_list.map((c) => (
            <li key={c.id}>
              <Link
                to={c.status === 'in_progress' ? `/checkin/${c.id}` : `/result/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-2 text-sm text-mute">
                  {formatDate(c.started_at, uiLang)} <LangTag lang={c.language} />
                </span>
                <span className="flex items-center gap-2">
                  {c.status === 'needs_review' && <span className="text-xs text-sun-deep">{t('student.awaiting')}</span>}
                  {c.status === 'in_progress' && <span className="text-xs text-mute">{t('student.inProgress')}</span>}
                  {c.level_final && <LevelBadge level={c.level_final} />}
                  <span className="text-mute/60">›</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}
