/**
 * Changes a teacher makes with no network, kept on the phone and sent when the network is back: a new class, a new
 * child, a child moved to another group, an activity rated, a class deleted, a teacher's corrections to a check's result.
 * Each is applied at once to the phone's copies of the
 * pages (the API cache), so the teacher sees it straight away; a class or child made offline gets a temporary ID
 * until the server gives it a real one (lib/idmap.ts), and the reading checks done offline for that child follow.
 * Online, these calls go straight to the server as before.
 */
import { Api, ApiError, OfflineError, announceSynced, api, currentTeacherId, noServer } from '../api'
import { db } from '../db'
import { isTempId, realId, realPath, remember } from './idmap'
import { applyOverride, applyReview, place, restate, type ReviewMark } from './rescore'
import type { Activity, Checkin, ClassSummary, Cohort, Dashboard, LangLevel, Level, StudentDetail, StudentSummary } from './types'

interface Pending {
  id: string
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  tempId?: string // the class or child this creates
  at: number
  owner?: string | null // the teacher who made the change: sent only while they are logged in
}

const OUTBOX = 'outbox'
const COHORTS: Cohort[] = ['letter', 'word', 'paragraph', 'story']
const newId = (kind: 'c' | 's') => `local-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function pending(): Promise<Pending[]> {
  return ((await db.cache.get(OUTBOX).catch(() => undefined))?.value as Pending[] | undefined) ?? []
}

async function save(list: Pending[]) {
  await db.cache.put({ key: OUTBOX, value: list, updatedAt: Date.now() })
}

async function queue(p: Omit<Pending, 'id' | 'at' | 'owner'>) {
  await save([...(await pending()), { ...p, id: newId('c'), at: Date.now(), owner: currentTeacherId() }])
}

/** A change (or a check) left by the teacher logged in now (one from before changes were marked counts as theirs). */
export const mine = (x: { owner?: string | null }) => !x.owner || x.owner === currentTeacherId()

/** How many of this teacher's changes are waiting to be sent. */
export async function outboxCount(): Promise<number> {
  return (await pending()).filter(mine).length
}

/** A change made offline and its effect on the phone's pages, saved together or not at all: closing the app (or
 * leaving the page) half-way never leaves a change sent but not shown, or shown but never sent. */
const together = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('rw', db.cache, db.checkins, fn)

async function edit<T>(key: string, fn: (value: T) => T | void) {
  const row = await db.cache.get(key).catch(() => undefined)
  if (!row) return
  const value = structuredClone(row.value) as T
  const out = fn(value)
  await db.cache.put({ key, value: out ?? value, updatedAt: Date.now() })
}

async function dashboardKeys(classId: string): Promise<string[]> {
  return (await db.cache.where('key').startsWith(`/classes/${classId}/dashboard`).primaryKeys()) as string[]
}

const cohortOf = (level: Level | null): Cohort | null =>
  level === null ? null : level === 'beginner' || level === 'letter' ? 'letter' : (level as Cohort)

const emptyLevel = (): LangLevel => ({
  provisional_level: null,
  confirmed_level: null,
  level: null,
  level_confirmed: false,
  cohort: null,
  cohort_override: null,
})

// ---------------------------------------------------------------- a child moved to another group

/** Moves the child to a group by hand in one reading test (`group` null: back to "group by level"). */
export async function changeGroup(s: StudentDetail, lang: string, group: Cohort | null): Promise<void> {
  const body = group ? { cohort_override: group, language: lang } : { clear_cohort_override: true, language: lang }
  try {
    await Api.patchStudent(s.id, body)
    return
  } catch (e) {
    if (!noServer(e)) throw e
  }
  const regroup = <T extends StudentSummary>(x: T, top: boolean): T => {
    const row = { ...(x.levels[lang] ?? emptyLevel()) }
    row.cohort_override = group
    row.cohort = group ?? cohortOf(row.level)
    x.levels = { ...x.levels, [lang]: row }
    if (top) Object.assign(x, { cohort_override: row.cohort_override, cohort: row.cohort })
    return x
  }
  await together(async () => {
    await queue({ method: 'PATCH', path: `/students/${s.id}`, body })
    await edit<StudentDetail>(`/students/${s.id}`, (d) => regroup(d, d.language === lang))
    for (const key of await dashboardKeys(s.class_id)) {
      await edit<Dashboard>(key, (d) => {
        const me = [...d.cohorts.flatMap((c) => c.students), ...d.not_assessed].find((x) => x.id === s.id)
        if (me) place(d, regroup(me, me.language === lang))
      })
    }
  })
}

// ---------------------------------------------------------------- a new child

export async function addChild(
  classId: string,
  body: { first_name: string; avatar: string; names?: Record<string, string> },
): Promise<void> {
  // The temporary ID goes with the first try too: on a weak network the server may add the child and the answer
  // never arrive; the retry from the outbox then finds that child instead of adding a second one.
  const tempId = newId('s')
  try {
    await Api.addStudent(classId, { ...body, local_id: tempId })
    return
  } catch (e) {
    if (!noServer(e)) throw e
  }
  await together(async () => {
    // The temporary ID goes along, so the server adds the child once even if this is sent twice (the app closed
    // mid-sync).
    await queue({ method: 'POST', path: `/classes/${classId}/students`, body: { ...body, local_id: tempId }, tempId })
    const keys = await dashboardKeys(classId)
    const cls = ((await db.cache.get(keys[0] ?? ''))?.value as Dashboard | undefined)?.class
    if (!cls) return
    const levels = Object.fromEntries(cls.languages.map((l) => [l, emptyLevel()]))
    const child = (lang: string): StudentSummary => ({
      id: tempId,
      first_name: body.first_name,
      names: body.names,
      avatar: body.avatar,
      grade: cls.grade,
      home_lang: null,
      assessment_language: cls.language,
      language: lang,
      languages: cls.languages,
      levels,
      checkins: 0,
      last_checkin_at: null,
      pending_review: false,
      review_checkin_id: null,
      patterns: [],
      ...emptyLevel(),
    })
    for (const key of keys) await edit<Dashboard>(key, (d) => void d.not_assessed.push(child(d.language)))
    const detail: StudentDetail = { ...child(cls.language), class_id: classId, checkins_list: [], level_history: [] }
    await db.cache.put({ key: `/students/${tempId}`, value: detail, updatedAt: Date.now() })
    await edit<ClassSummary[]>('/classes', (list) =>
      list.map((c) => (c.id === classId ? { ...c, students_count: c.students_count + 1 } : c)),
    )
  })
}

// ---------------------------------------------------------------- a new class

export async function createClass(body: { name: string; grade: number; language: string }): Promise<void> {
  const tempId = newId('c') // sent with the first try too, as for a child
  try {
    await Api.createClass({ ...body, local_id: tempId })
    return
  } catch (e) {
    if (!noServer(e)) throw e
  }
  const languages = body.language === 'en' ? ['en'] : [body.language, 'en']
  const cls: ClassSummary = { id: tempId, name: body.name, names: {}, grade: body.grade, language: body.language, languages, students_count: 0 }
  const board = (lang: string): Dashboard => ({
    class: cls,
    language: lang,
    cohorts: COHORTS.map((c) => ({ cohort: c, students: [], confirmed: 0, dominant_patterns: [], pattern_counts: {} })),
    not_assessed: [],
    pending_review: [],
  })
  const put = (key: string, value: unknown) => db.cache.put({ key, value, updatedAt: Date.now() })
  await together(async () => {
    await queue({ method: 'POST', path: '/classes', body: { ...body, local_id: tempId }, tempId }) // created once, as for a child
    await put(`/classes/${tempId}/dashboard`, board(body.language))
    for (const l of languages) await put(`/classes/${tempId}/dashboard?language=${l}`, board(l))
    const list = ((await db.cache.get('/classes'))?.value as ClassSummary[] | undefined) ?? []
    await put('/classes', [...list, cls])
  })
}

// ---------------------------------------------------------------- a class deleted

/** Deletes the class with its children and their checks: on the server, and the phone's copies (with any checks
 * still waiting to be sent for it). */
export async function deleteClass(classId: string): Promise<void> {
  let send = false
  try {
    await Api.deleteClass(classId)
  } catch (e) {
    if (!noServer(e)) throw e
    send = true
  }
  await together(async () => {
    if (send) await queue({ method: 'DELETE', path: `/classes/${classId}` })
    await edit<ClassSummary[]>('/classes', (list) => list.filter((c) => c.id !== classId))
    await db.cache.bulkDelete(await dashboardKeys(classId))
    await db.checkins.filter((c) => c.classId === classId).delete()
  })
}

// ---------------------------------------------------------------- an activity rated

export async function rateActivity(a: Activity, rating: number): Promise<Activity> {
  try {
    return await Api.rateActivity(a.id, rating)
  } catch (e) {
    if (!noServer(e)) throw e
  }
  await queue({ method: 'POST', path: `/activities/${a.id}/rating`, body: { rating } })
  return { ...a, teacher_rating: rating }
}

// ---------------------------------------------------------------- a teacher's corrections to a check's result

/** Words corrected or confirmed on a check's result. Offline: kept to send, and worked out on the phone by the
 * server's rules (lib/rescore.ts), so the result, the child's level and the class's groups change at once. */
export async function reviewCheck(c: Checkin, marks: ReviewMark[]): Promise<Checkin> {
  try {
    return await Api.review(c.id, marks)
  } catch (e) {
    if (!noServer(e)) throw e
  }
  return together(async () => {
    await queue({ method: 'POST', path: `/checkins/${c.id}/review`, body: { marks } })
    return keepCheck(applyReview(c, marks))
  })
}

/** The teacher sets the check's level (null: back to the checked level); offline, as above. */
export async function overrideCheck(c: Checkin, level: Level | null): Promise<Checkin> {
  try {
    return await Api.override(c.id, level)
  } catch (e) {
    if (!noServer(e)) throw e
  }
  return together(async () => {
    await queue({ method: 'POST', path: `/checkins/${c.id}/override`, body: { level } })
    return keepCheck(applyOverride(c, level))
  })
}

/** The check's recordings deleted; offline, the result shows none at once and the server deletes them later. */
export async function deleteCheckRecordings(c: Checkin): Promise<Checkin> {
  try {
    return await Api.deleteRecordings(c.id)
  } catch (e) {
    if (!noServer(e)) throw e
  }
  return together(async () => {
    await queue({ method: 'DELETE', path: `/checkins/${c.id}/audio` })
    return keepCheck({ ...c, items: c.items.map((r) => ({ ...r, has_audio: false })) })
  })
}

/** The phone's copies after a change to a check made offline: the check, the child's page (level, group, the check
 * waiting for confirmation), and the child's row on the class pages. */
async function keepCheck(c: Checkin): Promise<Checkin> {
  await db.cache.put({ key: `/checkins/${c.id}`, value: c, updatedAt: Date.now() })
  const key = `/students/${c.student_id}`
  await edit<StudentDetail>(key, (s) => {
    s.checkins_list = s.checkins_list.some((x) => x.id === c.id)
      ? s.checkins_list.map((x) => (x.id === c.id ? c : x))
      : [c, ...s.checkins_list]
    return restate(s, s.checkins_list, c.language)
  })
  const s = (await db.cache.get(key).catch(() => undefined))?.value as StudentDetail | undefined
  if (!s) return c
  for (const k of await dashboardKeys(s.class_id)) {
    await edit<Dashboard>(k, (d) => {
      const me = [...d.cohorts.flatMap((g) => g.students), ...d.not_assessed].find((x) => x.id === c.student_id)
      if (me) place(d, restate(me, s.checkins_list, c.language))
    })
  }
  return c
}

// ---------------------------------------------------------------- sending

let flushing: Promise<void> | null = null
let pausedUntil = 0 // after a server error, sending waits a little (every page read would otherwise try again)
const PAUSE_MS = 30_000

/** Sends the waiting changes in order; stops at the first one the network does not carry. A class or child the
 * server creates replaces its temporary ID everywhere: later changes, reading checks waiting on the phone, paths.
 * A caller that comes while a send is under way waits for it, so a page read after it sees the changes. Only the
 * logged-in teacher's changes go; another teacher's wait on the phone for them. */
export function flushOutbox(): Promise<void> {
  if (!navigator.onLine || Date.now() < pausedUntil) return Promise.resolve()
  flushing ??= send().finally(() => {
    flushing = null
  })
  return flushing
}

let sentInAll = 0

/** How many changes this page has sent so far: a server page read across a change being sent may predate it. */
export const changesSent = () => sentInAll

async function send(): Promise<void> {
  let sent = 0
  try {
    await sendAll(() => {
      sent += 1
      sentInAll += 1
    })
  } finally {
    announceSynced(sent) // open pages show the server's copy; the teacher is told
  }
}

async function sendAll(onSent: () => void): Promise<void> {
  for (;;) {
    const p = (await pending()).find(mine)
    if (!p) return
    const path = await realPath(p.path)
    let created: { id?: string } | undefined
    try {
      const body = p.body === undefined ? undefined : JSON.stringify(p.body)
      created = await api<{ id?: string }>(path, { method: p.method, body })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // logged out: sent after the next login
      // No network, or a server failing (starting up, restarting): kept, and sent again a little later. Never let go
      // for that: a class or child made offline, and everything after it, would be lost.
      if (noServer(e)) {
        if (!(e instanceof OfflineError)) pausedUntil = Date.now() + PAUSE_MS
        return
      }
      // The server refused this change (e.g. the child was removed): it is dropped so the rest can go. Checks done
      // offline for a child it would have created cannot be sent: shown as not sent on the child's page.
      if (p.tempId?.startsWith('local-s-')) {
        await db.checkins.where('studentId').equals(p.tempId).modify((c) => {
          if (c.status === 'queued') Object.assign(c, { status: 'failed', error: (e as Error).message })
        })
      }
    }
    if (p.tempId && created?.id) {
      await remember(p.tempId, created.id)
      const field = p.tempId.startsWith('local-s-') ? 'studentId' : 'classId'
      const serverId = created.id
      await db.checkins.toCollection().modify((c) => {
        if (c[field] === p.tempId) c[field] = serverId
      })
    }
    await save((await pending()).filter((x) => x.id !== p.id))
    onSent()
  }
}

/** A reading check done offline for a child the server does not know yet waits until the child is created. The
 * check takes the child's server ID as soon as there is one (it may have been started on a page opened before). */
export async function waitsForChild(c: { localId: string; studentId: string; classId: string }): Promise<boolean> {
  const [studentId, classId] = [await realId(c.studentId), await realId(c.classId)]
  if (studentId !== c.studentId || classId !== c.classId) await db.checkins.update(c.localId, { studentId, classId })
  c.studentId = studentId
  return isTempId(studentId)
}
