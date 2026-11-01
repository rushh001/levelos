import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { Api } from '../api'
import { Button, ErrorBox, Page, Spinner } from '../components/ui'
import { bankLanguages, isBeta } from '../lib/content'
import { nameIn } from '../lib/names'
import { createClass } from '../lib/outbox'
import { useUiLang } from '../lib/uiLang'
import { useAsync } from '../lib/useAsync'

/** The teacher's classes. Opening the app with one class goes straight to it; `list` (back from a class) stays here. */
export default function Classes({ list }: { list?: boolean }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const { data, error, loading, reload } = useAsync(() => Api.classes())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState(2)
  const [language, setLanguage] = useState(() => (ui === 'en' ? 'hi' : ui)) // a new class reads in the interface's language, else Hindi

  if (loading && !data) return <Page><Spinner label={t('loading')} /></Page>
  if (data && data.length === 1 && !creating && !list) return <Navigate to={`/class/${data[0].id}`} replace />

  const create = async (e: FormEvent) => {
    e.preventDefault()
    await createClass({ name, grade, language }) // offline too: sent when the network is back
    setCreating(false)
    setName('')
    await reload()
  }

  return (
    <Page title={t('classes.title')}>
      <ErrorBox error={error} onRetry={reload} />
      {data?.length === 0 && <p className="text-mute">{t('classes.empty')}</p>}
      <ul className="space-y-3 stagger">
        {data?.map((c) => (
          <li key={c.id}>
            <Link to={`/class/${c.id}`} className="card flex items-center gap-3 transition active:scale-[0.98]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft font-display text-lg text-brand-deep">
                {c.grade}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-lg text-ink">{nameIn(c, c.name, ui)}</span>
                <span className="block text-sm text-mute">
                  {t('classes.students', { count: c.students_count })} · {t(`lang.${c.language}`, { defaultValue: c.language })}
                  {isBeta(c.language) ? ` (${t('classes.beta')})` : ''}
                </span>
              </span>
              <span className="text-mute/60">›</span>
            </Link>
          </li>
        ))}
      </ul>
      {creating ? (
        <form onSubmit={create} className="mt-6 space-y-3 card">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('classes.name')}
            className="field"
            required
          />
          <label className="flex items-center justify-between gap-3">
            <span>{t('classes.grade')}</span>
            <select value={grade} onChange={(e) => setGrade(Number(e.target.value))} className="select">
              {[1, 2, 3, 4, 5].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>{t('classes.language')}</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="select">
              {bankLanguages().map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`, { defaultValue: l })}
                  {isBeta(l) ? ` (${t('classes.beta')})` : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-mute">{t('classes.languageHint')}</p>
          <div className="flex gap-2">
            <Button type="submit">{t('save')}</Button>
            <Button kind="secondary" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <Button kind="secondary" onClick={() => setCreating(true)} className="mt-6 w-full">
          + {t('classes.create')}
        </Button>
      )}
    </Page>
  )
}
