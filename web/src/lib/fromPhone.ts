/**
 * What the phone knows that the server may not yet: reading checks finished on the phone and not yet on the server's
 * pages. They count at once, so the app looks the same with or without network:
 *  - a child's page and the class page show the child's new level and group as soon as the check ends (`overlay`,
 *    applied to every read of those pages, from the server or from the phone, never stored: the server's own copy
 *    takes over once it has the check), by the server's own rules (lib/rescore.ts);
 *  - the letters and words a child read wrongly, from the teacher's marks (`misreadOf`), and a group's most common
 *    ones (`groupMisread`, also from the checks on the saved child pages), for the activity made on the phone.
 */
import { db, type QueuedCheckin } from '../db'
import { getItem, itemTokens } from './content'
import { aliases } from './idmap'
import { place, restate, wordCorrect } from './rescore'
import type { Checkin, Dashboard, StudentDetail, StudentSummary } from './types'

/** Checks finished on the phone that the server's pages may not show yet: waiting to be sent, or sent but not on the
 * child's saved page (whose copy is older than the sync). A check that did not place the child counts for nothing. */
async function finishedOnPhone(): Promise<QueuedCheckin[]> {
  const rows = await db.checkins.where('status').anyOf('queued', 'failed', 'synced').toArray().catch(() => [])
  return rows.filter((c) => !!c.provisionalLevel)
}

/** The phone's check as the server will list it: enough for the child's level and group. */
function asCheck(c: QueuedCheckin): Checkin {
  return {
    id: c.serverId ?? `phone:${c.localId}`,
    local_id: c.localId,
    student_id: c.studentId,
    language: c.language,
    status: 'scored',
    level_final: c.provisionalLevel ?? null,
    teacher_overrode: !!c.teacherLevel,
    started_at: new Date(c.startedAt).toISOString(),
    diagnosis: null,
    items: [],
  } as unknown as Checkin
}

/** The child's row again with the phone's checks among theirs (`listed`: the checks the server's page lists). */
function withPhoneChecks<T extends StudentSummary>(x: T, listed: Checkin[], phone: QueuedCheckin[], knownChecks = listed): T {
  const known = new Set(knownChecks.filter((c) => c.status === 'scored' || c.status === 'needs_review').map((c) => c.id))
  const extra = phone.filter((c) => !(c.serverId && known.has(c.serverId))).map(asCheck)
  if (!extra.length) return x
  const replaced = new Set(extra.map((c) => c.id))
  const all = [...extra, ...listed.filter((c) => !replaced.has(c.id))].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  let out = x
  for (const lang of new Set(extra.map((c) => c.language))) out = restate(out, all, lang)
  // The newest check has no diagnosis yet (it comes from the server): the child's last known mistakes stay.
  return { ...out, patterns: x.patterns }
}

async function savedPage(studentId: string): Promise<StudentDetail | undefined> {
  for (const key of await aliases(studentId)) {
    const row = await db.cache.get(`/students/${key}`).catch(() => undefined)
    if (row) return row.value as StudentDetail
  }
  return undefined
}

/** A page just read (`path`: its address), with the checks finished on the phone counted in. */
export async function overlay<T>(path: string, value: T): Promise<T> {
  const student = path.match(/^\/students\/([^/?]+)$/)
  const board = path.match(/^\/classes\/([^/?]+)\/dashboard/)
  if (!student && !board) return value
  const phone = await finishedOnPhone()
  if (!phone.length) return value
  if (student) {
    const s = value as unknown as StudentDetail
    const ids = new Set([...(await aliases(s.id)), s.id])
    const mine = phone.filter((c) => ids.has(c.studentId))
    return (mine.length ? withPhoneChecks(s, s.checkins_list ?? [], mine) : s) as unknown as T
  }
  const d = structuredClone(value as unknown as Dashboard)
  const classIds = new Set([...(await aliases(board![1])), d.class.id])
  const rows = [...d.cohorts.flatMap((c) => c.students), ...d.not_assessed]
  let changed = false
  for (const row of rows) {
    const ids = new Set([...(await aliases(row.id)), row.id])
    const mine = phone.filter((c) => ids.has(c.studentId) && classIds.has(c.classId))
    if (!mine.length) continue
    // Only this dashboard's own timestamp can show that it has caught up.
    const extra = mine.filter((c) => c.status !== 'synced' || c.language !== row.language || !row.last_checkin_at ||
      Date.parse(row.last_checkin_at) < c.startedAt)
    const history = (await savedPage(row.id))?.checkins_list ?? []
    const next = withPhoneChecks(row, history, extra, [])
    if (next !== row) {
      place(d, next)
      changed = true
    }
  }
  return (changed ? d : value) as T
}

// ---------------------------------------------------------------- what the child read wrongly

/** The letters and words the teacher marked wrong in a check on the phone, in reading order, each once. */
export function misreadOf(c: QueuedCheckin): string[] {
  const out: string[] = []
  for (const it of c.items) {
    if (it.skipped) continue
    const item = getItem(it.itemId)
    if (!item) continue
    itemTokens(item).forEach((w, i) => {
      if (it.marks[i] === false && !out.includes(w)) out.push(w)
    })
  }
  return out
}

/** The group's most common misread letters and words in one reading test (up to 12, as the server gives Claude):
 * from each child's latest check, on the phone or on their saved page, whichever is newer. */
export async function groupMisread(childIds: string[], lang: string): Promise<string[]> {
  const tally = new Map<string, number>()
  const phone = (await db.checkins.where('status').anyOf('queued', 'failed', 'synced').toArray().catch(() => []))
    .filter((c) => c.language === lang)
  for (const id of childIds) {
    const ids = new Set([...(await aliases(id)), id])
    const onPhone = phone.filter((c) => ids.has(c.studentId)).sort((a, b) => b.startedAt - a.startedAt)[0]
    const page = await savedPage(id)
    const server = page?.checkins_list.find(
      (c) => c.language === lang && (c.status === 'scored' || c.status === 'needs_review'),
    )
    let words: string[] = []
    // The same start time: the check was sent, and the server's copy has the teacher's corrections since.
    if (onPhone && (!server || onPhone.startedAt > Date.parse(server.started_at))) words = misreadOf(onPhone)
    else if (server)
      words = [...new Set(server.items.flatMap((r) => (r.source === 'skipped' ? [] : r.result.words.filter((w) => !wordCorrect(w)).map((w) => w.ref))))]
    for (const w of words) tally.set(w, (tally.get(w) ?? 0) + 1)
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w)
}
