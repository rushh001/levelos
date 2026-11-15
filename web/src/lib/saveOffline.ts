/**
 * Everything a class needs with no network, saved on the phone in the background: the class page in each reading
 * test and every child's page (so any child can be checked offline; it lists each of their checks in full, so any
 * result opens too), then at once the recorded activity lines for its languages (an activity made on the phone is read
 * aloud from them, and most phones have no voice of their own for Kannada, Tamil or Bengali), while each group's
 * activities and today's activity of each group read aloud by the server's voice follow. A class is saved when "My classes" or its own page
 * opens online, at most every 10 minutes (on the free API server, refetching every page on every visit adds up);
 * when it was last saved is kept on the phone, so reopening the app does not save it all again.
 */
import { useEffect } from 'react'
import { Api, ApiError, getToken, isReachable } from '../api'
import { db } from '../db'
import i18n from '../i18n'
import { todaysActivity } from './localActivity'
import { changesSent, outboxCount } from './outbox'
import { bookClips, keepRecording, saveRecordings, speechParts } from './speech'
import type { Activity, ClassSummary, Cohort, Dashboard } from './types'

const COHORTS: Cohort[] = ['letter', 'word', 'paragraph', 'story']
const AGAIN_AFTER_MS = 10 * 60_000
const MAX_CLASSES = 12 // a teacher's classes, the ones with the most children first; more are saved as they open
const AT_ONCE = 4 // pages fetched at the same time
const key = (classId: string) => `offline-saved/${classId}`
const busy = new Set<string>() // classes being saved right now

async function savedLately(classId: string): Promise<boolean> {
  const at = (await db.cache.get(key(classId)).catch(() => undefined))?.value as number | undefined
  return !!at && Date.now() - at < AGAIN_AFTER_MS
}

/** Runs the tasks, a few at a time. */
async function inTurns(tasks: (() => Promise<unknown>)[]) {
  let next = 0
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]().catch(() => undefined)
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
}

/** `pagesSaved`: called once the class's pages are on the phone, before its activities and their recordings (which
 * take a while), so what comes next (the recorded activity lines) can start then. */
async function saveClass(classId: string, data: Dashboard, pagesSaved: () => void = () => undefined) {
  if (busy.has(classId) || !navigator.onLine) return
  busy.add(classId) // at once: two calls in the same moment (a page and its refresh) would both save otherwise
  try {
    await saveClassOnce(classId, data, pagesSaved)
  } finally {
    busy.delete(classId)
  }
}

async function saveClassOnce(classId: string, data: Dashboard, pagesSaved: () => void) {
  // Changes still waiting to be sent are only in the phone's copies: the server's pages would wipe them.
  if (await outboxCount()) return
  if (await savedLately(classId)) {
    pagesSaved() // on the phone from a moment ago
    // Saved a moment ago: only the class page in its other reading tests follows (a change made since, a check or a
    // group, shows there too), one request each.
    await Promise.all(data.class.languages.filter((l) => l !== data.language).map((l) => Api.dashboard(classId, l).catch(() => undefined)))
    return
  }
  const children = [...data.cohorts.flatMap((c) => c.students), ...data.not_assessed]
  const groups: [string, Cohort, Activity[]][] = []
  // The class page and every child's page first, in one request: on a slow network the whole class arrives
  // together, before the signal goes, instead of one child at a time.
  const packed = await savePack(classId)
  if (packed === 'later') return // a change made meanwhile: saved once it is sent
  if (packed === 'none') {
    // A server without the pack: the class page as it asks for itself (once per reading test), each child.
    await inTurns([
      ...data.class.languages.map((l) => () => Api.dashboard(classId, l)),
      ...children.map((s) => () => Api.student(s.id)),
    ])
  }
  pagesSaved() // the pages are on the phone: the recorded lines need not wait for the groups' activities below
  await inTurns(data.class.languages.flatMap((l) => COHORTS.map((c) => async () => groups.push([l, c, await Api.activities(classId, c, l)]))))
  await db.cache.put({ key: key(classId), value: Date.now(), updatedAt: Date.now() }).catch(() => undefined)
  await keepTodaysRecordings(groups)
}

/** The class's pages from GET /classes/{id}/offline, each filed under the address the app reads it from. 'none': the
 * server has no pack (an older one), the pages are then read one by one; 'later': a change was made on the phone
 * meanwhile, so the server's pages would wipe it. */
// Each class's pack requests in order, and the newest one saved: a pack is saved unless a newer one already was (an
// older pack that arrives first is still saved; one that arrives after a newer one is not).
const packRequests = new Map<string, number>()
const packSaved = new Map<string, number>()

async function savePack(classId: string): Promise<'saved' | 'none' | 'later'> {
  const token = getToken()
  const request = (packRequests.get(classId) ?? 0) + 1
  packRequests.set(classId, request)
  // A change waiting, or sent while the pack was on its way: the pack may be from before it and would wipe it from
  // the phone's pages (a child added on a flaky network vanished so). Saved next time.
  if (await outboxCount()) return 'later'
  const sentBefore = changesSent()
  let pack
  try {
    pack = await Api.offlinePack(classId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return 'none'
    throw e
  }
  if ((await outboxCount()) || changesSent() !== sentBefore) return 'later'
  const now = Date.now()
  const rows = [
    ...Object.entries(pack.dashboards).map(([l, board]) => ({ key: `/classes/${classId}/dashboard?language=${l}`, value: board, updatedAt: now })),
    ...Object.entries(pack.students).map(([id, page]) => ({ key: `/students/${id}`, value: page, updatedAt: now })),
  ]
  const own = pack.dashboards[pack.default_language]
  if (own) rows.push({ key: `/classes/${classId}/dashboard`, value: own, updatedAt: now })
  return db.transaction('rw', db.cache, async () => {
    if (getToken() !== token || (packSaved.get(classId) ?? 0) > request || (await outboxCount()) || changesSent() !== sentBefore)
      return 'later' as const
    await db.cache.bulkPut(rows)
    packSaved.set(classId, request)
    return 'saved' as const
  })
}

/** The class's pages saved again now, in one request (a child was just added: their page is on the phone at once,
 * not at the next save). Does nothing offline or while changes wait to be sent (the phone's copies have them). */
export async function saveClassPagesNow(classId: string): Promise<void> {
  if (!navigator.onLine || classId.startsWith('local-')) return
  await savePack(classId).catch(() => undefined)
}

/** Today's activity of each group, read aloud by the server's voice and kept on the phone, so the activity the teacher
 * sees offline can be heard too. In the language of its reading test (the activity page is shown in it); one at a
 * time, as the voice service allows few requests a minute; an activity read from the recorded lines needs none. */
async function keepTodaysRecordings(groups: [string, Cohort, Activity[]][]) {
  for (const [lang, cohort, list] of groups) {
    if (!navigator.onLine || !isReachable()) return
    const a = todaysActivity(list, cohort, lang)
    if (!a || bookClips(a, lang)) continue
    await keepRecording(lang, speechParts(a, lang, lang, i18n.getFixedT(lang))).catch(() => undefined)
  }
}

/** Calls `start` once, however many times the returned function is called. */
function once(start: () => void): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    start()
  }
}

/** A class page: that class saved for offline in the background. */
export function useSaveForOffline(classId: string, data: Dashboard | null | undefined) {
  useEffect(() => {
    if (!data || !navigator.onLine) return
    // The pages first (without them a child cannot be opened offline at all), then at once the recorded activity
    // lines, while the groups' activities and their read-aloud recordings are still being saved (those take a while):
    // a teacher who goes offline soon after opening the class can still hear an activity made on the phone.
    const lines = once(() => void saveRecordings(data.class.languages))
    void saveClass(classId, data, lines)
      .catch(() => undefined)
      .finally(lines) // the pages could not be saved now (changes waiting, a save running): the lines all the same
  }, [classId, data])
}

/** "My classes": every class saved for offline in the background, not only the ones opened, so any class opens with
 * no network later; the recorded activity lines for their languages too. */
export function useSaveAllForOffline(classes: ClassSummary[] | null | undefined) {
  useEffect(() => {
    if (!classes?.length || !navigator.onLine) return
    const mine = [...classes].sort((x, y) => y.students_count - x.students_count).slice(0, MAX_CLASSES)
    // The recorded lines once the first class's pages are on the phone, not after every class's (twelve classes take
    // minutes, and a phone-made activity needs the lines to be heard offline in Kannada, Tamil or Bengali).
    const lines = once(() => void saveRecordings(mine.flatMap((c) => c.languages)))
    void (async () => {
      for (const c of mine) {
        if (!navigator.onLine) break
        if (await savedLately(c.id)) {
          lines() // its pages are on the phone already
          continue
        }
        const data = await Api.dashboard(c.id).catch(() => null)
        if (data) await saveClass(c.id, data, lines).catch(() => undefined)
      }
      lines() // none saved just now (a save already running, changes waiting): the lines all the same
    })()
  }, [classes])
}
