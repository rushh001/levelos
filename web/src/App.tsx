import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

function Shell() {
  const { t, i18n } = useTranslation()
  const online = useOnline()

  const toggleLang = () => {
    const next = i18n.language === 'hi' ? 'en' : 'hi'
    i18n.changeLanguage(next)
    try {
      localStorage.setItem('levelos.uiLang', next)
    } catch {
      /* storage unavailable (private mode) — language still switches for this session */
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-blue-700">{t('appName')}</h1>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              online ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {online ? t('online') : t('offline')}
          </span>
          <button onClick={toggleLang} className="rounded-md border px-2 py-0.5 text-xs">
            {i18n.language === 'hi' ? 'EN' : 'हि'}
          </button>
        </div>
      </header>
      <main className="mt-8 flex-1">
        <p className="text-slate-600">{t('tagline')}</p>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<Shell />} />
    </Routes>
  )
}
