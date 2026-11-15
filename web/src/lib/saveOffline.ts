/**
 * Everything a class needs with no network, saved on the phone in the background: the recorded activity lines for its
 * languages (first: an activity made on the phone is read aloud from them, and most phones have no voice of their own
 * for Kannada, Tamil or Bengali), the class page in each reading test, every child's page (so any child can be
 * checked offline; it lists each of their checks in full, so any result opens too), each group's activities, and
 * today's activity of each group read aloud by the server's voice. A class is saved when "My classes" or its own page
 * opens online, at most every 10 minutes (on the free API server, refetching every page on every visit adds up);
 * when it was last saved is kept on the phone, so reopening the app does not save it all again.
 */
import { useEffect } from 'react'
import { Api, isReachable } from '../api'
import { db } from '../db'
import i18n from '../i18n'
import { todaysActivity } from './localActivity'
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

async function saveClass(classId: string, data: Dashboard) {
  if (busy.has(classId) || !navigator.onLine) return
  if (await savedLately(classId)) {
    // Saved a moment ago: only the class page in its other reading tests follows (a change made since, a check or a
    // group, shows there too), one request each.
    await Promise.all(data.class.languages.filter((l) => l !== data.language).map((l) => Api.dashboard(classId, l).catch(() => undefined)))
    return
  }
  busy.add(classId)
  try {
    const children = [...data.cohorts.flatMap((c) => c.students), ...data.not_assessed]
    const groups: [string, Cohort, Activity[]][] = []
    await inTurns([
      // the class page as it asks for itself: once per reading test, the language in the address
      ...data.class.languages.map((l) => () => Api.dashboard(classId, l)),
      ...children.map((s) => () => Api.student(s.id)),
      ...data.class.languages.flatMap((l) => COHORTS.map((c) => async () => groups.push([l, c, await Api.activities(classId, c, l)]))),
    ])
    await db.cache.put({ key: key(classId), value: Date.now(), updatedAt: Date.now() }).catch(() => undefined)
    await keepTodaysRecordings(groups)
  } finally {
    busy.delete(classId)
  }
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

/** A class page: that class saved for offline in the background, its recorded activity lines first. */
export function useSaveForOffline(classId: string, data: Dashboard | null | undefined) {
  useEffect(() => {
    if (!data || !navigator.onLine) return
    void saveRecordings(data.class.languages)
    void saveClass(classId, data)
  }, [classId, data])
}

/** "My classes": every class saved for offline in the background, not only the ones opened, so any class opens with
 * no network later; the recorded activity lines for their languages too. */
export function useSaveAllForOffline(classes: ClassSummary[] | null | undefined) {
  useEffect(() => {
    if (!classes?.length || !navigator.onLine) return
    const mine = [...classes].sort((x, y) => y.students_count - x.students_count).slice(0, MAX_CLASSES)
    void saveRecordings(mine.flatMap((c) => c.languages))
    void (async () => {
      for (const c of mine) {
        if (!navigator.onLine) return
        if (await savedLately(c.id)) continue
        const data = await Api.dashboard(c.id).catch(() => null)
        if (data) await saveClass(c.id, data)
      }
    })()
  }, [classes])
}
