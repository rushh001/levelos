import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Api, OfflineError } from '../api'
import { db } from '../db'
import { hasBank } from '../lib/content'
import { startOffline } from '../lib/offline'
import { Button, ErrorBox, LevelBadge, Page, Spinner, formatDate } from '../components/ui'
import type { Checkin, Cohort } from '../lib/types'
import { useAsync } from '../lib/useAsync'

const COHORTS: Cohort[] = ['letter', 'word', 'paragraph']

function latestDiagnosis(list: Checkin[]) {
  return list.find((c) => c.diagnosis && (c.status === 'scored' || c.status === 'needs_review'))
}

export default function Student() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { data: s, error, loading, reload } = useAsync(() => Api.student(id), [id])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<Error | null>(null)
  const lang = i18n.language === 'hi' ? 'hi' : 'en'
  const local = useLiveQuery(() => db.checkins.where('studentId').equals(id).reverse().sortBy('startedAt'), [id])

  if (loading && !s) return <Page back><Spinner label={t('loading')} /></Page>
  if (!s) return <Page back><ErrorBox error={error} onRetry={reload} /></Page>

  const start = async () => {
    setStarting(true)
    setStartError(null)
    const offline = async () => navigate(`/offline/${await startOffline(s)}`)
    try {
      if (!navigator.onLine && hasBank(s.assessment_language)) return await offline()
      const c = await Api.startCheckin(s.id)
      navigate(`/checkin/${c.id}`)
    } catch (e) {
      if (e instanceof OfflineError && hasBank(s.assessment_language)) await offline()
      else setStartError(e as Error)
    } finally {
      setStarting(false)
    }
  }

  const moveTo = async (value: string) => {
    await Api.patchStudent(s.id, value === 'auto' ? { clear_cohort_override: true } : { cohort_override: value })
    await reload()
  }

  const last = latestDiagnosis(s.checkins_list)
  const unfinished = s.checkins_list.find((c) => c.status === 'in_progress')

  return (
    <Page title={s.first_name} back={`/class/${s.class_id}`}>
      <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-5xl">{s.avatar}</div>
        <div>
          <LevelBadge level={s.level} confirmed={s.level ? s.level_confirmed : undefined} large />
          <p className="mt-1 text-xs text-slate-500">
            {s.level ? (s.level_confirmed ? t('student.confirmed') : `${t('student.provisional')} — ${t('student.provisionalHelp')}`) : ''}
          </p>
        </div>
      </div>

      {unfinished ? (
        <Button onClick={() => navigate(`/checkin/${unfinished.id}`)} className="mt-4 w-full text-lg">
          {t('student.startCheckin')} ({t('student.inProgress')})
        </Button>
      ) : (
        <Button onClick={start} disabled={starting} className="mt-4 w-full py-4 text-lg">
          🎤 {t('student.startCheckin')}
        </Button>
      )}
      <div className="mt-2">
        <ErrorBox error={startError} />
      </div>

      {last?.diagnosis && (
        <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">{t('result.diagnosis')}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {last.diagnosis.error_patterns.map((p) => (
              <span key={p} className="rounded-full bg-violet-100 px-2 py-0.5 text-sm text-violet-900">
                {t(`pattern.${p}`)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-slate-800">{last.diagnosis.summary[lang] ?? last.diagnosis.summary.en}</p>
        </section>
      )}

      <section className="mt-5">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{t('student.group')}</span>
          <select
            value={s.cohort_override ?? 'auto'}
            onChange={(e) => void moveTo(e.target.value)}
            className="rounded-lg border bg-white px-3 py-2"
          >
            <option value="auto">
              {t('student.autoGroup')}
              {s.cohort && !s.cohort_override ? ` (${t(`cohort.${s.cohort}`)})` : ''}
            </option>
            {COHORTS.map((c) => (
              <option key={c} value={c}>
                {t(`cohort.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-slate-500">
          {s.cohort_override
            ? t('student.groupStart', { level: t(`level.${s.cohort_override}`) })
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
                    <span className="text-sm text-slate-600">{formatDate(new Date(c.startedAt).toISOString(), i18n.language)}</span>
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
                <span className="text-sm text-slate-600">{formatDate(c.started_at, i18n.language)}</span>
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
