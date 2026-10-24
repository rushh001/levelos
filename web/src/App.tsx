import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Page, Spinner } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import { syncAll } from './lib/offline'
import ActivityPage from './pages/ActivityPage'
import Checkin from './pages/Checkin'
import ClassDashboard from './pages/ClassDashboard'
import Classes from './pages/Classes'
import Login from './pages/Login'
import OfflineCheckin from './pages/OfflineCheckin'
import Result from './pages/Result'
import Student from './pages/Student'

function RequireTeacher({ children }: { children: ReactNode }) {
  const { teacher, ready } = useAuth()
  const { t } = useTranslation()
  if (!teacher && !ready) return <Page><Spinner label={t('loading')} /></Page>
  if (!teacher) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Sends check-ins made offline whenever the network is back (and on start, and every minute). */
function SyncRunner() {
  const { teacher } = useAuth()
  useEffect(() => {
    if (!teacher) return
    const run = () => void syncAll()
    run()
    window.addEventListener('online', run)
    const timer = window.setInterval(run, 60_000)
    return () => {
      window.removeEventListener('online', run)
      window.clearInterval(timer)
    }
  }, [teacher])
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <SyncRunner />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireTeacher><Classes /></RequireTeacher>} />
        <Route path="/class/:id" element={<RequireTeacher><ClassDashboard /></RequireTeacher>} />
        <Route path="/class/:id/activity/:cohort" element={<RequireTeacher><ActivityPage /></RequireTeacher>} />
        <Route path="/student/:id" element={<RequireTeacher><Student /></RequireTeacher>} />
        <Route path="/checkin/:id" element={<RequireTeacher><Checkin /></RequireTeacher>} />
        <Route path="/offline/:localId" element={<RequireTeacher><OfflineCheckin /></RequireTeacher>} />
        <Route path="/result/:id" element={<RequireTeacher><Result /></RequireTeacher>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
