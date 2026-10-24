import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Api, LOGOUT_EVENT, getToken, setToken } from '../api'
import type { Teacher } from './types'

interface AuthState {
  teacher: Teacher | null
  ready: boolean
  login: (login: string, pin: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)
const TEACHER_KEY = 'levelos.teacher'

function cachedTeacher(): Teacher | null {
  try {
    const raw = localStorage.getItem(TEACHER_KEY)
    return raw ? (JSON.parse(raw) as Teacher) : null
  } catch {
    return null
  }
}

function cacheTeacher(t: Teacher | null) {
  try {
    if (t) localStorage.setItem(TEACHER_KEY, JSON.stringify(t))
    else localStorage.removeItem(TEACHER_KEY)
  } catch {
    /* storage unavailable */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // The cached teacher lets the app open offline; the token is re-checked when the network allows.
  const [teacher, setTeacher] = useState<Teacher | null>(() => (getToken() ? cachedTeacher() : null))
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()

  const logout = useCallback(() => {
    setToken(null)
    cacheTeacher(null)
    setTeacher(null)
    navigate('/login')
  }, [navigate])

  useEffect(() => {
    if (!getToken()) {
      setReady(true)
      return
    }
    Api.me()
      .then((t) => {
        setTeacher(t)
        cacheTeacher(t)
      })
      .catch(() => {
        /* offline: keep the cached teacher; a 401 fires LOGOUT_EVENT */
      })
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    window.addEventListener(LOGOUT_EVENT, logout)
    return () => window.removeEventListener(LOGOUT_EVENT, logout)
  }, [logout])

  const login = useCallback(async (loginId: string, pin: string) => {
    const r = await Api.login(loginId.trim().toLowerCase(), pin)
    setToken(r.token)
    cacheTeacher(r.teacher)
    setTeacher(r.teacher)
  }, [])

  return <AuthContext.Provider value={{ teacher, ready, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
