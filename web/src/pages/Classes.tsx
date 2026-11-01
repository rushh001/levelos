import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { Api } from '../api'
import { Button, ErrorBox, Page, Spinner } from '../components/ui'
import { bankLanguages, isBeta } from '../lib/content'
import { nameIn } from '../lib/names'
import { createClass, deleteClass } from '../lib/outbox'
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
  const [confirming, setConfirming] = useState<string | null>(null) // the class whose delete is being confirmed
  const [deleted, setDeleted] = useState(false) // after a delete, stay on the list
  const [deleteError, setDeleteError] = useState<Error | null>(null)

  if (loading && !data) return <Page><Spinner label={t('loading')} /></Page>
  if (data && data.length === 1 && !creating && !list && !deleted) return <Navigate to={`/class/${data[0].id}`} replace />

  const create = async (e: FormEvent) => {
    e.preventDefault()
    await createClass({ name, grade, language }) // offline too: sent when the network is back
    setCreating(false)
    setName('')
    await reload()
  }

  const remove = async (classId: string) => {
    setDeleteError(null)
    try {
      await deleteClass(classId) // offline too: sent when the network is back
      setConfirming(null)
      setDeleted(true)
      await reload()
    } catch (e) {
      setDeleteError(e as Error)
    }
  }

  return (
    <Page title={t('classes.title')}>
      <ErrorBox error={error} onRetry={reload} />
      <ErrorBox error={deleteError} />
      {data?.length === 0 && <p className="text-mute">{t('classes.empty')}</p>}
      <ul className="space-y-3 stagger">
        {data?.map((c) => (
          <li key={c.id}>
            <div className="card flex items-center gap-2">
              <Link to={`/class/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 transition active:scale-[0.98]">
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
              {!c.shared_demo && (
                <button
                  type="button"
                  onClick={() => setConfirming(confirming === c.id ? null : c.id)}
                  aria-expanded={confirming === c.id}
                  aria-label={t('classes.deleteLabel', { name: nameIn(c, c.name, ui) })}
                  className="flex shrink-0 flex-col items-center rounded-xl px-2 py-1 text-xs text-coral-deep active:bg-coral-soft"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                  </svg>
                  {t('classes.delete')}
                </button>
              )}
            </div>
            {confirming === c.id && (
              <div role="alertdialog" className="card mt-2 space-y-3 border border-coral/40 pop">
                <p className="text-sm text-ink">{t('classes.deleteConfirm', { name: nameIn(c, c.name, ui) })}</p>
                <div className="flex gap-2">
                  <Button kind="danger" onClick={() => remove(c.id)}>
                    {t('classes.deleteYes')}
                  </Button>
                  <Button kind="secondary" onClick={() => setConfirming(null)}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            )}
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
