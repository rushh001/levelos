import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { Api } from '../api'
import { Button, ErrorBox, Page, Spinner } from '../components/ui'
import { bankLanguages, isBeta } from '../lib/content'
import { nameIn } from '../lib/names'
import { regionalFor, useUiLang } from '../lib/uiLang'
import { useAsync } from '../lib/useAsync'

/** The teacher's classes. Opening the app with one class goes straight to it; `list` (back from a class) stays here. */
export default function Classes({ list }: { list?: boolean }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const { data, error, loading, reload } = useAsync(() => Api.classes())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState(2)
  const [language, setLanguage] = useState(() => regionalFor(ui === 'en' ? null : ui)) // a new class reads in the app's regional language

  if (loading && !data) return <Page><Spinner label={t('loading')} /></Page>
  if (data && data.length === 1 && !creating && !list) return <Navigate to={`/class/${data[0].id}`} replace />

  const create = async (e: FormEvent) => {
    e.preventDefault()
    await Api.createClass({ name, grade, language })
    setCreating(false)
    setName('')
    await reload()
  }

  return (
    <Page title={t('classes.title')}>
      <ErrorBox error={error} onRetry={reload} />
      {data?.length === 0 && <p className="text-slate-600">{t('classes.empty')}</p>}
      <ul className="space-y-3">
        {data?.map((c) => (
          <li key={c.id}>
            <Link to={`/class/${c.id}`} className="block rounded-2xl bg-white p-4 shadow-sm">
              <div className="text-lg font-semibold">{nameIn(c, c.name, ui)}</div>
              <div className="text-sm text-slate-600">{t('classes.students', { count: c.students_count })}</div>
            </Link>
          </li>
        ))}
      </ul>
      {creating ? (
        <form onSubmit={create} className="mt-6 space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('classes.name')}
            className="w-full rounded-lg border px-3 py-3"
            required
          />
          <label className="flex items-center justify-between gap-3">
            <span>{t('classes.grade')}</span>
            <select value={grade} onChange={(e) => setGrade(Number(e.target.value))} className="rounded-lg border px-3 py-2">
              {[1, 2, 3, 4, 5].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>{t('classes.language')}</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border px-3 py-2">
              {bankLanguages().map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`, { defaultValue: l })}
                  {isBeta(l) ? ` (${t('classes.beta')})` : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-slate-500">{t('classes.languageHint')}</p>
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
