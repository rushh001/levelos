/**
 * Changes a teacher makes with no network, kept on the phone and sent when the network is back: a new class, a new
 * child, a child moved to another group, an activity rated. Each is applied at once to the phone's copies of the
 * pages (the API cache), so the teacher sees it straight away; a class or child made offline gets a temporary ID
 * until the server gives it a real one (lib/idmap.ts), and the reading checks done offline for that child follow.
 * Online, these calls go straight to the server as before.
 */
import { Api, ApiError, OfflineError, api } from '../api'
import { db } from '../db'
import { isTempId, realPath, remember } from './idmap'
import type { Activity, ClassSummary, Cohort, Dashboard, LangLevel, Level, StudentDetail, StudentSummary } from './types'

interface Pending {
  id: string
  method: 'POST' | 'PATCH'
  path: string
  body: unknown
  tempId?: string // the class or child this creates
  at: number
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

async function queue(p: Omit<Pending, 'id' | 'at'>) {
  await save([...(await pending()), { ...p, id: newId('c'), at: Date.now() }])
}

/** How many changes are waiting to be sent. */
export async function outboxCount(): Promise<number> {
  return (await pending()).length
}

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
    if (!(e instanceof OfflineError)) throw e
  }
  await queue({ method: 'PATCH', path: `/students/${s.id}`, body })
  const regroup = <T extends StudentSummary>(x: T, top: boolean): T => {
    const row = { ...(x.levels[lang] ?? emptyLevel()) }
    row.cohort_override = group
    row.cohort = group ?? cohortOf(row.level)
    x.levels = { ...x.levels, [lang]: row }
    if (top) Object.assign(x, { cohort_override: row.cohort_override, cohort: row.cohort })
    return x
  }
  await edit<StudentDetail>(`/students/${s.id}`, (d) => regroup(d, d.language === lang))
  for (const key of await dashboardKeys(s.class_id)) {
    await edit<Dashboard>(key, (d) => {
      const all = [...d.cohorts.flatMap((c) => c.students), ...d.not_assessed]
      const me = all.find((x) => x.id === s.id)
      if (!me) return
      regroup(me, d.language === lang)
      if (d.language !== lang) return
      for (const c of d.cohorts) c.students = c.students.filter((x) => x.id !== s.id)
      d.not_assessed = d.not_assessed.filter((x) => x.id !== s.id)
      const card = d.cohorts.find((c) => c.cohort === me.cohort)
      if (card) card.students.push(me)
      else d.not_assessed.push(me)
    })
  }
}

// ---------------------------------------------------------------- a new child

export async function addChild(
  classId: string,
  body: { first_name: string; avatar: string; names?: Record<string, string> },
): Promise<void> {
  try {
    await Api.addStudent(classId, body)
    return
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e
  }
  const tempId = newId('s')
  await queue({ method: 'POST', path: `/classes/${classId}/students`, body, tempId })
  const keys = await dashboardKeys(classId)
  const cls = ((await db.cache.get(keys[0] ?? '').catch(() => undefined))?.value as Dashboard | undefined)?.class
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
  await edit<ClassSummary[]>('/classes', (list) => list.map((c) => (c.id === classId ? { ...c, students_count: c.students_count + 1 } : c)))
}

// ---------------------------------------------------------------- a new class

export async function createClass(body: { name: string; grade: number; language: string }): Promise<void> {
  try {
    await Api.createClass(body)
    return
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e
  }
  const tempId = newId('c')
  await queue({ method: 'POST', path: '/classes', body, tempId })
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
  await put(`/classes/${tempId}/dashboard`, board(body.language))
  for (const l of languages) await put(`/classes/${tempId}/dashboard?language=${l}`, board(l))
  const list = ((await db.cache.get('/classes').catch(() => undefined))?.value as ClassSummary[] | undefined) ?? []
  await put('/classes', [...list, cls])
}

// ---------------------------------------------------------------- an activity rated

export async function rateActivity(a: Activity, rating: number): Promise<Activity> {
  try {
    return await Api.rateActivity(a.id, rating)
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e
  }
  await queue({ method: 'POST', path: `/activities/${a.id}/rating`, body: { rating } })
  return { ...a, teacher_rating: rating }
}

// ---------------------------------------------------------------- sending

let flushing = false

/** Sends the waiting changes in order; stops at the first one the network does not carry. A class or child the
 * server creates replaces its temporary ID everywhere: later changes, reading checks waiting on the phone, paths. */
export async function flushOutbox(): Promise<void> {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    for (;;) {
      const [p] = await pending()
      if (!p) return
      const path = await realPath(p.path)
      let created: { id?: string } | undefined
      try {
        created = await api<{ id?: string }>(path, { method: p.method, body: JSON.stringify(p.body) })
      } catch (e) {
        if (e instanceof OfflineError || (e instanceof ApiError && e.status === 401)) return
        // the server refused this change (e.g. the child was removed): drop it so the rest can go
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
    }
  } finally {
    flushing = false
  }
}

/** A reading check done offline for a child the server does not know yet waits until the child is created. */
export const waitsForChild = (studentId: string) => isTempId(studentId)
