import { db } from './db'
import { pathAliases, realId, realPath } from './lib/idmap'
import type {
  Activity,
  Checkin,
  MeaningAnswer,
  ClassSummary,
  Dashboard,
  CardScore,
  Health,
  OfflinePack,
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

// ---------------------------------------------------------------- how good the network is
//
// The browser's online flag says only that the phone is on some network: a Wi-Fi with no internet counts as online,
// and a weak signal sends requests that are never answered. So the header follows what the server does:
//   offline: no network, or several requests in a row did not reach the server;
//   slow:    the server answers, but some requests fail or run past their time (a flaky or weak signal): pages open
//            from the phone's copy almost at once and refresh in the background, checks never wait on the AI;
//   online:  a few quick answers in a row.
// A ping every 30 seconds while the app is on screen (every 10 while the network is not good), and at once when the
// network comes or goes, finds out when it changes.

export type NetState = 'online' | 'slow' | 'offline'

const PROBE_MS = 30_000
const PROBE_WHEN_BAD_MS = 10_000
const SLOW_FOR_MS = 60_000 // a failure or a slow answer counts this long
const FAST_MS = 3_000 // an answer within this counts as quick
const GOOD_IN_A_ROW = 3 // a flaky network answers now and then: this many quick answers before it counts as good
const BAD_IN_A_ROW = 3 // this many failures in a row (and no answer between) count as no server

let reachable = navigator.onLine
let slowUntil = 0
let slowTimer: number | undefined
let goodInARow = 0
let badInARow = 0
const watchers = new Set<() => void>()

export function netState(): NetState {
  if (!navigator.onLine || !reachable) return 'offline'
  return Date.now() < slowUntil ? 'slow' : 'online'
}

let lastState = netState()
function changed() {
  const now = netState()
  if (now === lastState) return
  lastState = now
  watchers.forEach((w) => w())
}

/** The server answered. `ms`: how fast, for a page or a ping; null for a change or a recording, whose time is the
 * server's work (scoring a card takes seconds), not the network's. */
function answered(ms: number | null) {
  badInARow = 0
  reachable = true
  if (ms === null) {
    // says the server is there, nothing about how good the signal is
  } else if (ms < FAST_MS) {
    goodInARow += 1
    if (goodInARow >= GOOD_IN_A_ROW) slowUntil = 0
  } else {
    goodInARow = 0
    slowUntil = Date.now() + SLOW_FOR_MS
  }
  changed()
}

/** A request did not reach the server, or ran past its time. */
function missed() {
  goodInARow = 0
  badInARow += 1
  if (badInARow >= BAD_IN_A_ROW || !navigator.onLine) reachable = false
  slowUntil = Date.now() + SLOW_FOR_MS
  window.clearTimeout(slowTimer)
  slowTimer = window.setTimeout(changed, SLOW_FOR_MS + 50)
  changed()
}

/** Asks the server for a tiny answer: whether the network carries requests, and how well. */
export async function probeNetwork(): Promise<boolean> {
  if (!navigator.onLine) {
    reachable = false
    changed()
    return false
  }
  // While the network counts as weak, a few quick answers in a row to clear it.
  for (let i = 0; i < GOOD_IN_A_ROW; i++) {
    const ctl = new AbortController()
    const timer = window.setTimeout(() => ctl.abort(), 6_000)
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE}/api/ping`, { cache: 'no-store', signal: ctl.signal })
      if (!res.ok) throw new Error(String(res.status))
      answered(Date.now() - t0)
    } catch {
      missed()
      return false
    } finally {
      window.clearTimeout(timer)
    }
    if (netState() === 'online') return true
  }
  return netState() !== 'offline'
}

window.addEventListener('online', () => void probeNetwork())
window.addEventListener('offline', () => {
  reachable = false
  changed()
})
window.setInterval(() => {
  if (document.visibilityState !== 'visible') return
  if (netState() !== 'online' || Date.now() % PROBE_MS < PROBE_WHEN_BAD_MS) void probeNetwork()
}, PROBE_WHEN_BAD_MS)

/** For useSyncExternalStore: whether the server answers, and a way to hear when that (or the network state) changes. */
export const isReachable = () => netState() !== 'offline'
export function watchReachable(onChange: () => void): () => void {
  watchers.add(onChange)
  if (watchers.size === 1) void probeNetwork()
  return () => watchers.delete(onChange)
}

/** Fired when changes or checks kept on the phone have reached the server (detail: how many), so open pages show
 * the server's copy again, and the teacher is told. */
export const SYNCED_EVENT = 'levelos:synced'
/** Fired when the server's answer to a page read arrives after the page was shown from the phone's copy, and differs
 * from it (detail: the page's address): that page refreshes to it. */
export const FRESH_EVENT = 'levelos:fresh'
export const announceSynced = (count: number) => {
  if (count > 0) window.dispatchEvent(new CustomEvent(SYNCED_EVENT, { detail: count }))
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

export async function api<T>(givenPath: string, init: RequestInit = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
  const value = await read<T>(givenPath, init, opts)
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') return value
  // Checks finished on the phone count on a child's page and the class page at once, whether the page came from the
  // server or the phone, until the server's own copy has them (lib/fromPhone.ts).
  const { overlay } = await import('./lib/fromPhone')
  return overlay(await realPath(givenPath), value).catch((e: unknown) => {
    console.error('overlay failed', e)
    return value
  })
}

// Each page's reads in order, and the newest whose answer was saved on the phone: an answer is saved unless a newer
// one already was (an older answer arriving first is still saved; one arriving after a newer one is not).
const readGenerations = new Map<string, number>()
const savedGenerations = new Map<string, number>()

async function read<T>(givenPath: string, init: RequestInit, opts: { timeoutMs?: number }): Promise<T> {
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
    reachable = false
    changed()
    return fromPhone()
  }
  if (method !== 'GET' || path.startsWith('/auth/')) {
    return fromServer<T>(path, { ...init, headers }, method, fromPhone, opts.timeoutMs)
  }
  // Reads of the same page can overlap (a slow answer, a refresh after a sync): only the newest one may save its answer
  // on the phone or tell open pages to refresh, so an older answer arriving last never replaces a newer one.
  const generation = (readGenerations.get(path) ?? 0) + 1
  readGenerations.set(path, generation)
  const current = () => (savedGenerations.get(path) ?? 0) < generation && getToken() === t
  const saved = () => savedGenerations.set(path, generation)
  const copy = await fromPhone().then(
    (v) => ({ v }),
    () => null,
  )
  const { flushOutbox, outboxCount, changesSent } = await import('./lib/outbox')
  let shownCopy = false
  const refresh = async (flushWaitMs?: number): Promise<T> => {
    // Changes made on the phone go first, so a fresh read has them; a page never saved waits only a moment for them.
    await (flushWaitMs === undefined ? flushOutbox() : Promise.race([flushOutbox(), sleep(flushWaitMs)]))
    // Changes still waiting: the phone's copy has them and the server's answer would not.
    if (copy && (await outboxCount())) return copy.v
    const sent = changesSent()
    const canSave = async () => current() && !(await outboxCount()) && changesSent() === sent
    const value = await fromServer<T>(path, { ...init, headers }, method, fromPhone, opts.timeoutMs, canSave, current, saved)
    // The page was shown from the phone's copy: if the server's answer differs, open pages refresh to it.
    if (shownCopy && savedGenerations.get(path) === generation && JSON.stringify(value) !== JSON.stringify(copy?.v)) {
      window.dispatchEvent(new CustomEvent(FRESH_EVENT, { detail: path }))
    }
    return value
  }
  if (!copy) return refresh(3_000)
  const server = refresh()
  server.catch(() => undefined)
  // A weak network, or changes waiting: the phone's copy at once (nothing waits on the network). Online: the server's
  // answer if it comes within a moment, so a page opened online is fresh; else the copy, refreshed when it comes.
  if (netState() === 'online' && !(await outboxCount())) {
    const first = await Promise.race([
      server.then(
        (v) => ({ v }),
        () => null,
      ),
      sleep(READ_WAIT_MS),
    ])
    if (first) return first.v
  }
  shownCopy = true
  return copy.v
}

const sleep = (ms: number) => new Promise<null>((r) => window.setTimeout(() => r(null), ms))

async function fromServer<T>(
  path: string,
  init: RequestInit,
  method: string,
  fromPhone: () => Promise<T>,
  timeoutMs?: number,
  canSave: () => Promise<boolean> = async () => true,
  current: () => boolean = () => true,
  saved: () => void = () => undefined,
): Promise<T> {
  // A request that hangs (a weak signal, a server not answering) is given up after a while, as with no network.
  const ctl = new AbortController()
  const outer = init.signal
  const onOuter = () => ctl.abort()
  outer?.addEventListener('abort', onOuter)
  const ms =
    timeoutMs ??
    (method === 'GET' ? (netState() === 'online' ? READ_MS : READ_WHEN_DOWN_MS) : init.body instanceof FormData ? UPLOAD_MS : WRITE_MS)
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, ms)
  const t0 = Date.now()
  let res: Response
  let data: T
  try {
    try {
      res = await fetch(`${BASE}/api${path}`, { ...init, signal: ctl.signal })
    } catch (e) {
      if (outer?.aborted && !timedOut) throw e // the caller stopped waiting: not a network problem
      missed()
      return await fromPhone()
    }
    // The server is up but failing (starting up, restarting): a page opens from the phone's copy as with no network.
    if (res.status >= 500) missed()
    else answered(method === 'GET' ? Date.now() - t0 : null)
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
    } catch (e) {
      if (outer?.aborted && !timedOut) throw e
      missed()
      if (method === 'GET') return await fromPhone()
      throw new OfflineError('offline') // the answer was cut off on the way
    }
  } finally {
    window.clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
  if (method === 'GET') {
    // Keep the last good copy of every page's data, so the app still opens offline: unless a newer read of the page
    // started meanwhile, or a change was made on the phone (the answer is still returned to the caller).
    await db.transaction('rw', db.cache, async () => {
      if (!(await canSave()) || !current()) return
      await db.cache.put({ key: path, value: data, updatedAt: Date.now() })
      saved()
      if (/^\/students\/[^/?]+$/.test(path)) await refreshCheckCopies((data as StudentDetail).checkins_list)
    }).catch(() => undefined)
  } else if (path.startsWith('/checkins')) {
    // A check changed online (a card, a correction, the level): the phone's copy of its result follows.
    const c = ((data as { checkin?: Checkin } | undefined)?.checkin ?? data) as Checkin | undefined
    if (c?.id && Array.isArray(c.items)) void db.cache.put({ key: `/checkins/${c.id}`, value: c, updatedAt: Date.now() }).catch(() => undefined)
  }
  return data
}

const READ_MS = 30_000 // a page with no copy on the phone (the free server can take a while to wake)
const READ_WHEN_DOWN_MS = 6_000 // …while the network is weak or the server not answering
const READ_WAIT_MS = 1_500 // online, a page with a copy on the phone waits this long for the server's fresh answer
const WRITE_MS = 20_000 // past this a change is kept on the phone and sent later (it carries an ID: never made twice)
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
  createClass: (body: { name: string; grade: number; language: string; local_id?: string }) => post<ClassSummary>('/classes', body),
  /** An activity read aloud: the parts joined into one MP3 (base64) with the second each part starts at. */
  speech: (language: string, parts: string[]) =>
    post<{ mime: string; audio: string; starts: number[]; duration: number }>('/speech', { language, parts }),
  deleteClass: (classId: string) => api<{ ok: boolean }>(`/classes/${classId}`, { method: 'DELETE' }),
  dashboard: (classId: string, language?: string) =>
    api<Dashboard>(`/classes/${classId}/dashboard${language ? `?language=${language}` : ''}`),
  addStudent: (classId: string, body: { first_name: string; avatar: string; names?: Record<string, string>; local_id?: string }) =>
    post<StudentSummary>(`/classes/${classId}/students`, body),

  /** The class page in each reading test and every child's page, in one request (lib/saveOffline.ts files them). */
  offlinePack: (classId: string) => api<OfflinePack>(`/classes/${classId}/offline`),
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
  /** `hesitations`: long pauses the phone measured; `ai`: the AI's signed result the teacher confirmed; `oneMore`: the
   * one more card the teacher gave after the ladder ended on a fail. */
  markItem: (
    id: string,
    itemId: string,
    marks: boolean[],
    durationMs?: number,
    hesitations?: number,
    ai?: { scoreJson: string; sig: string },
    oneMore = false,
  ) =>
    post<UploadResult>(`/checkins/${id}/marks`, {
      item_id: itemId,
      marks,
      duration_ms: durationMs ?? null,
      hesitations: hesitations ?? null,
      ai_score: ai?.scoreJson ?? null,
      ai_sig: ai?.sig ?? null,
      one_more: oneMore,
    }),
  /** The AI marks one card of a check running on the phone; nothing is stored on the server. */
  scoreCard: (itemId: string, blob: Blob, mime: string, signal: AbortSignal, timeoutMs: number) => {
    const form = new FormData()
    form.append('item_id', itemId)
    form.append('audio', new File([blob], clipName(mime), { type: mime.split(';')[0] }))
    return api<CardScore>('/checkins/score', { method: 'POST', body: form, signal }, { timeoutMs })
  },
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

