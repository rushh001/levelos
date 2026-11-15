import { db } from './db'
import { pathAliases, realId, realPath } from './lib/idmap'
import type {
  Activity,
  Checkin,
  MeaningAnswer,
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

/** Wakes the free API server (it sleeps when idle) while the first screen is read; nothing waits for the answer. */
export function wakeServer(): void {
  if (navigator.onLine) fetch(`${BASE}/api/ping`).catch(() => {})
}

// ---------------------------------------------------------------- can the server be reached?
//
// The browser's online flag says only that the phone is on some network: a Wi-Fi with no internet counts as online.
// So the status in the header follows what the server says: every request that reaches it (or fails to), a quick
// ping every 30 seconds while the app is on screen, and at once when the network comes or goes.

const PROBE_MS = 30_000
let reachable = navigator.onLine
const watchers = new Set<() => void>()

function setReachable(ok: boolean) {
  const now = ok && navigator.onLine
  if (now === reachable) return
  reachable = now
  watchers.forEach((w) => w())
}

async function probe() {
  if (!navigator.onLine) return setReachable(false)
  try {
    setReachable((await fetch(`${BASE}/api/ping`, { cache: 'no-store' })).ok)
  } catch {
    setReachable(false)
  }
}

window.addEventListener('online', () => void probe())
window.addEventListener('offline', () => setReachable(false))
window.setInterval(() => document.visibilityState === 'visible' && void probe(), PROBE_MS)

/** For useSyncExternalStore: whether the server answers, and a way to hear when that changes. */
export const isReachable = () => reachable
export function watchReachable(onChange: () => void): () => void {
  watchers.add(onChange)
  if (watchers.size === 1) void probe()
  return () => watchers.delete(onChange)
}

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

export async function api<T>(givenPath: string, init: RequestInit = {}): Promise<T> {
  // A class or child made offline keeps working under its temporary ID once the server has given it a real one.
  const path = await realPath(givenPath)
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const t = getToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)

  const method = (init.method ?? 'GET').toUpperCase()
  const fromPhone = async (): Promise<T> => {
    if (method === 'GET') {
      // The page under any name it was saved by: a class or child made offline was saved under its temporary ID.
      const names = await pathAliases(path)
      for (const key of names) {
        const cached = await db.cache.get(key).catch(() => undefined)
        if (cached) return cached.value as T
      }
      // A check's result never opened: the child's page lists every check in full.
      const check = path.match(/^\/checkins\/([^/?]+)$/)
      const listed = check ? await checkOnChildPage(check[1]) : undefined
      if (listed) return listed as T
      // A class page asked for in a reading test the class does not have (the test chosen in another class): the
      // class's own page, as the server would answer.
      for (const key of names) {
        const board = key.match(/^\/classes\/[^/?]+\/dashboard/)
        const any = board ? await db.cache.where('key').startsWith(board[0]).first().catch(() => undefined) : undefined
        if (any) return any.value as T
      }
    }
    throw new OfflineError(method === 'GET' ? 'not-saved' : 'offline') // a page never opened with network
  }
  // No network: read the phone's copy straight away (a change made offline is in it), write nothing.
  if (!navigator.onLine) {
    setReachable(false)
    return fromPhone()
  }
  // Back online: changes made offline go to the server before anything is read again, so a fresh read has them.
  if (method === 'GET' && !path.startsWith('/auth/')) {
    const { flushOutbox } = await import('./lib/outbox')
    await flushOutbox()
  }
  // A request that hangs (a weak signal, a server not answering) is given up after a while, as with no network.
  const ctl = new AbortController()
  const ms = method === 'GET' ? (reachable ? READ_MS : READ_WHEN_DOWN_MS) : init.body instanceof FormData ? UPLOAD_MS : WRITE_MS
  const timer = window.setTimeout(() => ctl.abort(), ms)
  let res: Response
  let data: T
  try {
    try {
      res = await fetch(`${BASE}/api${path}`, { ...init, headers, signal: ctl.signal })
      setReachable(true)
    } catch {
      setReachable(false)
      return await fromPhone()
    }
    // The server is up but failing (starting up, restarting): a page opens from the phone's copy as with no network.
    if (res.status >= 500 && method === 'GET') {
      const copy = await fromPhone().catch(() => undefined)
      if (copy !== undefined) return copy
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
    try {
      data = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
    } catch {
      setReachable(false)
      if (method === 'GET') return await fromPhone()
      throw new OfflineError('offline') // the answer was cut off on the way
    }
  } finally {
    window.clearTimeout(timer)
  }
  if (method === 'GET') {
    // Keep the last good copy of every page's data, so the app still opens offline.
    void db.cache.put({ key: path, value: data, updatedAt: Date.now() }).catch(() => undefined)
    if (/^\/students\/[^/?]+$/.test(path)) void refreshCheckCopies((data as StudentDetail).checkins_list)
  } else if (path.startsWith('/checkins')) {
    // A check changed online (a card, a correction, the level): the phone's copy of its result follows.
    const c = ((data as { checkin?: Checkin } | undefined)?.checkin ?? data) as Checkin | undefined
    if (c?.id && Array.isArray(c.items)) void db.cache.put({ key: `/checkins/${c.id}`, value: c, updatedAt: Date.now() }).catch(() => undefined)
  }
  return data
}

const READ_MS = 30_000 // a page (the free server can take a while to wake)
const READ_WHEN_DOWN_MS = 6_000 // a page while the server is not answering: the phone's copy sooner
const WRITE_MS = 60_000
const UPLOAD_MS = 120_000 // a recording, scored by the speech services before the answer comes

/** A check as listed on a saved child's page (which lists every check in full). */
async function checkOnChildPage(id: string): Promise<Checkin | undefined> {
  let found: Checkin | undefined
  await db.cache
    .where('key')
    .startsWith('/students/')
    .until(() => !!found)
    .each((row) => {
      found ??= (row.value as StudentDetail | undefined)?.checkins_list?.find((x) => x.id === id)
    })
    .catch(() => undefined)
  return found
}

/** A child's page just read: the saved copies of their checks' results that are on the phone are brought up to date. */
async function refreshCheckCopies(checks: Checkin[] | undefined) {
  if (!checks?.length) return
  const keys = checks.map((c) => `/checkins/${c.id}`)
  const rows = await db.cache.bulkGet(keys).catch(() => [])
  const now = Date.now()
  const fresh = checks.flatMap((c, k) => (rows[k] ? [{ key: keys[k], value: c, updatedAt: now }] : []))
  if (fresh.length) await db.cache.bulkPut(fresh).catch(() => undefined)
}

/** The teacher logged in on this phone (their ID), so what one teacher left waiting is never sent as another's. */
export function currentTeacherId(): string | null {
  try {
    return (JSON.parse(localStorage.getItem('levelos.teacher') ?? 'null') as { id?: string } | null)?.id ?? null
  } catch {
    return null
  }
}

/** A failure that means "no server right now": no network, or a server that is failing (starting up, restarting),
 * not one that refused the request. The app then does it on the phone. */
export function noServer(e: unknown): boolean {
  return e instanceof OfflineError || (e instanceof ApiError && (e.status >= 500 || e.status === 408 || e.status === 429))
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
  signup: (name: string, email: string, pin: string, uiLang: string) =>
    post<{ token: string; teacher: Teacher; login: string }>('/auth/signup', { name, email, pin, ui_lang: uiLang }),
  me: () => api<Teacher>('/me'),

  classes: () => api<ClassSummary[]>('/classes'),
  createClass: (body: { name: string; grade: number; language: string }) => post<ClassSummary>('/classes', body),
  /** An activity read aloud: the parts joined into one MP3 (base64) with the second each part starts at. */
  speech: (language: string, parts: string[]) =>
    post<{ mime: string; audio: string; starts: number[]; duration: number }>('/speech', { language, parts }),
  deleteClass: (classId: string) => api<{ ok: boolean }>(`/classes/${classId}`, { method: 'DELETE' }),
  dashboard: (classId: string, language?: string) =>
    api<Dashboard>(`/classes/${classId}/dashboard${language ? `?language=${language}` : ''}`),
  addStudent: (classId: string, body: { first_name: string; avatar: string; names?: Record<string, string> }) =>
    post<StudentSummary>(`/classes/${classId}/students`, body),

  student: (id: string) => api<StudentDetail>(`/students/${id}`),
  patchStudent: (id: string, body: { cohort_override?: string; clear_cohort_override?: boolean; language?: string }) =>
    patch<StudentSummary>(`/students/${id}`, body),

  /** `startedAt`: when a check done offline began on the phone (it is sent later). */
  startCheckin: async (studentId: string, language: string, localId?: string, startLevel?: string, fixedLevel = false, startedAt?: number) =>
    post<Checkin>('/checkins', {
      student_id: await realId(studentId), // a child made offline, on a page opened before the sync
      language,
      local_id: localId ?? null,
      start_level: startLevel ?? null,
      fixed_level: fixedLevel,
      started_at: startedAt ? new Date(startedAt).toISOString() : null,
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
  skipItem: (id: string, itemId: string) =>
    post<UploadResult>(`/checkins/${id}/skip`, { item_id: itemId }),
  attachAudio: (id: string, itemResultId: string, blob: Blob, mime: string) => {
    const form = new FormData()
    form.append('audio', new File([blob], clipName(mime), { type: mime.split(';')[0] }))
    return api<Checkin>(`/checkins/${id}/items/${itemResultId}/audio`, { method: 'POST', body: form })
  },
  finish: (id: string) => post<Checkin>(`/checkins/${id}/finish`),
  review: (id: string, marks: { item_result_id: string; i: number; correct: boolean }[]) =>
    post<Checkin>(`/checkins/${id}/review`, { marks }),
  override: (id: string, level: Level | null) => post<Checkin>(`/checkins/${id}/override`, { level }),
  meaning: (id: string, itemResultId: string, answers: MeaningAnswer[]) =>
    post<Checkin>(`/checkins/${id}/items/${itemResultId}/meaning`, { answers }),
  abandon: (id: string) => post<Checkin>(`/checkins/${id}/abandon`),
  deleteRecordings: (id: string) => api<Checkin>(`/checkins/${id}/audio`, { method: 'DELETE' }),

  /** A new activity for the group, also put at the top of the phone's copy of the group's list, so it is still
   * today's activity (with its recording) when the network goes. */
  generateActivity: async (classId: string, cohort: string, language: string) => {
    const a = await post<Activity>(`/classes/${classId}/activities`, { cohort, language })
    const key = await realPath(`/classes/${classId}/activities?cohort=${cohort}&language=${language}`) // as the list is read
    const list = ((await db.cache.get(key).catch(() => undefined))?.value as Activity[] | undefined) ?? []
    await db.cache.put({ key, value: [a, ...list.filter((x) => x.id !== a.id)], updatedAt: Date.now() }).catch(() => undefined)
    return a
  },
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

