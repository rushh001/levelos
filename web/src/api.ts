import { db } from './db'
import type {
  Activity,
  Checkin,
  ClassSummary,
  Dashboard,
  Health,
  Level,
  StudentDetail,
  StudentSummary,
  Teacher,
  UploadResult,
} from './lib/types'

const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')
const TOKEN_KEY = 'levelos.token'
export const LOGOUT_EVENT = 'levelos:logout'

/** The request never reached the server (no network). Reads fall back to the phone's cache before this is thrown. */
export class OfflineError extends Error {}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: the session lasts until the tab closes */
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const t = getToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)

  const method = (init.method ?? 'GET').toUpperCase()
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, { ...init, headers })
  } catch {
    if (method === 'GET') {
      const cached = await db.cache.get(path).catch(() => undefined)
      if (cached) return cached.value as T
    }
    throw new OfflineError('offline')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    let message = text
    try {
      message = (JSON.parse(text) as { detail?: string }).detail ?? text
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && path !== '/auth/login') {
      setToken(null)
      window.dispatchEvent(new Event(LOGOUT_EVENT))
    }
    throw new ApiError(res.status, message)
  }
  const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  if (method === 'GET') {
    // Keep the last good copy of every page's data, so the app still opens offline.
    void db.cache.put({ key: path, value: data, updatedAt: Date.now() }).catch(() => undefined)
  }
  return data
}

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

function clipName(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'clip.m4a'
  if (mime.includes('ogg')) return 'clip.ogg'
  if (mime.includes('wav')) return 'clip.wav'
  return 'clip.webm'
}

export const Api = {
  health: () => api<Health>('/health'),
  login: (login: string, pin: string) => post<{ token: string; teacher: Teacher }>('/auth/login', { login, pin }),
  me: () => api<Teacher>('/me'),

  classes: () => api<ClassSummary[]>('/classes'),
  createClass: (body: { name: string; grade: number; language: string }) => post<ClassSummary>('/classes', body),
  dashboard: (classId: string, language?: string) =>
    api<Dashboard>(`/classes/${classId}/dashboard${language ? `?language=${language}` : ''}`),
  addStudent: (classId: string, body: { first_name: string; avatar: string }) =>
    post<StudentSummary>(`/classes/${classId}/students`, body),

  student: (id: string) => api<StudentDetail>(`/students/${id}`),
  patchStudent: (id: string, body: { cohort_override?: string; clear_cohort_override?: boolean; language?: string }) =>
    patch<StudentSummary>(`/students/${id}`, body),

  startCheckin: (studentId: string, language: string, localId?: string, startLevel?: string) =>
    post<Checkin>('/checkins', {
      student_id: studentId,
      language,
      local_id: localId ?? null,
      start_level: startLevel ?? null,
    }),
  checkin: (id: string) => api<Checkin>(`/checkins/${id}`),
  uploadItem: (id: string, itemId: string, blob: Blob, mime: string) => {
    const form = new FormData()
    form.append('item_id', itemId)
    form.append('audio', new File([blob], clipName(mime), { type: mime.split(';')[0] }))
    return api<UploadResult>(`/checkins/${id}/items`, { method: 'POST', body: form })
  },
  markItem: (id: string, itemId: string, marks: boolean[], durationMs?: number) =>
    post<UploadResult>(`/checkins/${id}/marks`, { item_id: itemId, marks, duration_ms: durationMs ?? null }),
  attachAudio: (id: string, itemResultId: string, blob: Blob, mime: string) => {
    const form = new FormData()
    form.append('audio', new File([blob], clipName(mime), { type: mime.split(';')[0] }))
    return api<Checkin>(`/checkins/${id}/items/${itemResultId}/audio`, { method: 'POST', body: form })
  },
  finish: (id: string) => post<Checkin>(`/checkins/${id}/finish`),
  review: (id: string, marks: { item_result_id: string; i: number; correct: boolean }[]) =>
    post<Checkin>(`/checkins/${id}/review`, { marks }),
  override: (id: string, level: Level | null) => post<Checkin>(`/checkins/${id}/override`, { level }),
  abandon: (id: string) => post<Checkin>(`/checkins/${id}/abandon`),
  deleteRecordings: (id: string) => api<Checkin>(`/checkins/${id}/audio`, { method: 'DELETE' }),

  generateActivity: (classId: string, cohort: string, language: string) =>
    post<Activity>(`/classes/${classId}/activities`, { cohort, language }),
  activities: (classId: string, cohort: string, language: string) =>
    api<Activity[]>(`/classes/${classId}/activities?cohort=${cohort}&language=${language}`),
  rateActivity: (id: string, rating: number) => post<Activity>(`/activities/${id}/rating`, { rating }),
}

const recordingUrls = new Map<string, string>()

/** A playable URL for one item's recording (fetched with the login token, cached for the session). */
export async function recordingUrl(checkinId: string, itemResultId: string): Promise<string> {
  const cached = recordingUrls.get(itemResultId)
  if (cached) return cached
  const t = getToken()
  let res: Response
  try {
    res = await fetch(`${BASE}/api/checkins/${checkinId}/items/${itemResultId}/audio`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    })
  } catch {
    throw new OfflineError('offline')
  }
  if (!res.ok) throw new ApiError(res.status, 'no recording')
  const url = URL.createObjectURL(await res.blob())
  recordingUrls.set(itemResultId, url)
  return url
}

export function forgetRecordings() {
  recordingUrls.forEach((url) => URL.revokeObjectURL(url))
  recordingUrls.clear()
}

