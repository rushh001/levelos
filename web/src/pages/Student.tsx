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
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t(`lang.${lang}`, { defaultValue: lang })}</span>
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
    <Page title={nameIn(s, s.first_name, uiLang)} back={`/class/${s.class_id}`} regional={s.assessment_language}>
      <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-5xl">{s.avatar}</div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {s.languages.map((l) => {
            const lv = s.levels[l]
            return (
              <div key={l} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${l === lang ? '' : 'opacity-60'}`}>
                <span className="w-16 shrink-0 text-xs font-medium text-slate-600">{t(`lang.${l}`, { defaultValue: l })}</span>
                <LevelBadge level={lv?.level ?? null} confirmed={lv?.level ? lv.level_confirmed : undefined} />
                {lv?.level && (
                  <span className="text-xs text-slate-500">
                    {lv.level_confirmed ? t('student.confirmed') : t('student.provisional')}
                  </span>
                )}
              </div>
            )
          })}
          {s.languages.some((l) => s.levels[l]?.level && !s.levels[l].level_confirmed) && (
            <p className="text-xs text-slate-500">{t('student.provisionalHelp')}</p>
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
        <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold">
            {t('result.diagnosis')} <LangTag lang={lang} />
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {last.diagnosis.error_patterns.map((p) => (
              <span key={p} className="rounded-full bg-violet-100 px-2 py-0.5 text-sm text-violet-900">
                {t(patternKey(p, lang))}
              </span>
            ))}
          </div>
          <p className="mt-2 text-slate-800">{withName(pick(last.diagnosis.summary, uiLang) ?? '', s, uiLang)}</p>
        </section>
      )}

      <section className="mt-5">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{t('readingTest.groupFor', { language: langName })}</span>
          <select
            value={level?.cohort_override ?? 'auto'}
            onChange={(e) => void moveTo(e.target.value)}
            className="rounded-lg border bg-white px-3 py-2"
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
        <p className="mt-1 text-xs text-slate-500">
          {level?.cohort_override
            ? t('student.groupStart', { level: t(`level.${level.cohort_override}`) })
            : t('student.autoStart')}
        </p>
      </section>

      {local && local.some((c) => c.status !== 'synced') && (
        <section className="mt-5">
          <h2 className="font-semibold">{t('offlineCheck.onPhone')}</h2>
          <ul className="mt-2 divide-y rounded-2xl bg-amber-50 shadow-sm">
            {local
              .filter((c) => c.status !== 'synced')
              .map((c) => (
                <li key={c.localId}>
                  <Link to={`/offline/${c.localId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm text-slate-600">
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
        {s.checkins_list.length === 0 && <p className="mt-2 text-sm text-slate-500">{t('student.noHistory')}</p>}
        <ul className="mt-2 divide-y rounded-2xl bg-white shadow-sm">
          {s.checkins_list.map((c) => (
            <li key={c.id}>
              <Link
                to={c.status === 'in_progress' ? `/checkin/${c.id}` : `/result/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  {formatDate(c.started_at, uiLang)} <LangTag lang={c.language} />
                </span>
                <span className="flex items-center gap-2">
                  {c.status === 'needs_review' && <span className="text-xs text-amber-700">{t('student.awaiting')}</span>}
                  {c.status === 'in_progress' && <span className="text-xs text-slate-500">{t('student.inProgress')}</span>}
                  {c.level_final && <LevelBadge level={c.level_final} />}
                  <span className="text-slate-400">›</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}
