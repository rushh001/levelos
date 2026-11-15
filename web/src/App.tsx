import { useEffect, useRef, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { netState, probeNetwork, watchReachable } from './api'
import { NetToast, Page, Spinner } from './components/ui'
import { db } from './db'
import { mine, outboxCount } from './lib/outbox'
import { AuthProvider, useAuth } from './lib/auth'
import { syncAll } from './lib/offline'
import ActivityPage from './pages/ActivityPage'
import Checkin from './pages/Checkin'
import ClassDashboard from './pages/ClassDashboard'
import Classes from './pages/Classes'
import Login from './pages/Login'
import Signup from './pages/Signup'
import PhoneCheck from './pages/PhoneCheck'
import Result from './pages/Result'
import Student from './pages/Student'

function RequireTeacher({ children }: { children: ReactNode }) {
  const { teacher, ready } = useAuth()
  const { t } = useTranslation()
  if (!teacher && !ready) return <Page><Spinner label={t('loading')} /></Page>
  if (!teacher) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Sends what was kept on the phone (checks, recordings, new children, corrections…) whenever the network is back,
 * on start and every minute. A weak or flaky network gives no "online" event when it recovers, so while something
 * waits to be sent, a tiny request every 10 seconds finds out when the network carries it again. */
function SyncRunner() {
  const { teacher } = useAuth()
  const last = useRef(netState())
  useEffect(() => {
    if (!teacher) return
    // What waits on the phone (checks, recordings, changes, saved pages) is kept even when the phone runs low on
    // space: the browser may otherwise clear it.
    void navigator.storage?.persist?.().catch(() => undefined)
    const run = () => void syncAll()
    const waiting = async () =>
      (await outboxCount()) + (await db.checkins.where('status').equals('queued').filter(mine).count())
    const watch = async () => {
      if (!navigator.onLine || document.visibilityState !== 'visible' || !(await waiting())) return
      if (await probeNetwork()) run()
    }
    run()
    const stopWatching = watchReachable(() => {
      const now = netState()
      if (now !== 'offline' && last.current === 'offline') run() // the server answers again
      if (now === 'online' && last.current !== 'online') run()
      last.current = now
    })
    window.addEventListener('online', run)
    const minute = window.setInterval(run, 60_000)
    const probe = window.setInterval(() => void watch(), 10_000)
    return () => {
      stopWatching()
      window.removeEventListener('online', run)
      window.clearInterval(minute)
      window.clearInterval(probe)
    }
  }, [teacher])
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <SyncRunner />
      <NetToast />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={<RequireTeacher><Classes /></RequireTeacher>} />
        <Route path="/classes" element={<RequireTeacher><Classes list /></RequireTeacher>} />
        <Route path="/class/:id" element={<RequireTeacher><ClassDashboard /></RequireTeacher>} />
        <Route path="/class/:id/activity/:cohort" element={<RequireTeacher><ActivityPage /></RequireTeacher>} />
        <Route path="/student/:id" element={<RequireTeacher><Student /></RequireTeacher>} />
        <Route path="/checkin/:id" element={<RequireTeacher><Checkin /></RequireTeacher>} />
        <Route path="/check/:localId" element={<RequireTeacher><PhoneCheck /></RequireTeacher>} />
        {/* the address checks on the phone had before every check ran there */}
        <Route path="/offline/:localId" element={<RequireTeacher><PhoneCheck /></RequireTeacher>} />
        <Route path="/result/:id" element={<RequireTeacher><Result /></RequireTeacher>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
