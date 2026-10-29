/**
 * Check-ins run on the phone without network, and their sync.
 *
 * Offline, the teacher records each item (optional) and taps the letters/words the child got wrong; the ASER
 * ladder runs locally on those marks (lib/aser.ts) and gives a provisional level at once. On sync the server
 * replays the same ladder from the marks (same starting rung, same rules), then AI-scores each recording;
 * wherever the AI disagrees with a tap, that word becomes uncertain for the teacher to confirm.
 * Every step is idempotent (local_id, item count, per-clip flag), so an interrupted sync simply resumes.
 */
import { Api, ApiError, OfflineError } from '../api'
import { db, type QueuedCheckin } from '../db'
import i18n from '../i18n'
import { nextItemLevel, outcomeFromMarks, placedLevel, skippedOutcome, startLevel } from './aser'
import { pickItem } from './content'
import { nameIn } from './names'
import type { ItemLevel, ItemPublic, Level, StudentDetail } from './types'

export function newLocalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function startOffline(s: StudentDetail, language: string): Promise<string> {
  const localId = newLocalId()
  const level = s.levels[language]
  await db.checkins.put({
    localId,
    studentId: s.id,
    classId: s.class_id,
    studentName: nameIn(s, s.first_name, i18n.language),
    avatar: s.avatar,
    language,
    startLevel: startLevel(
      s.grade,
      level?.confirmed_level ?? level?.provisional_level ?? null,
      level?.cohort_override ?? null,
      Object.entries(s.levels)
        .filter(([l]) => l !== language)
        .map(([, lv]) => lv.confirmed_level ?? lv.provisional_level)
        .filter((lv): lv is NonNullable<typeof lv> => lv !== null),
    ),
    fixedLevel: !!level?.cohort_override,
    startedAt: Date.now(),
    items: [],
    status: 'in_progress',
  })
  return localId
}

export function outcomes(c: QueuedCheckin) {
  return c.items.map((it) =>
    it.skipped ? skippedOutcome(it.level) : outcomeFromMarks(it.level, it.marks, it.durationMs, c.language),
  )
}

export function nextItem(c: QueuedCheckin): ItemPublic | null {
  if (c.status !== 'in_progress') return null
  const level = nextItemLevel(outcomes(c), c.startLevel, !!c.fixedLevel)
  return level ? pickItem(c.language, level, c.items.map((i) => i.itemId)) : null
}

export async function addItem(
  localId: string,
  item: { id: string; level: ItemLevel },
  marks: boolean[],
  clip: { blob: Blob; mime: string; durationMs: number } | null,
) {
  const clipId = clip
    ? await db.clips.add({ checkinLocalId: localId, itemId: item.id, ...clip, recordedAt: Date.now() })
    : undefined
  await db.checkins
    .where('localId')
    .equals(localId)
    .modify((c) => {
      c.items.push({ itemId: item.id, level: item.level, marks, durationMs: clip?.durationMs ?? null, clipId })
    })
}

/** The teacher skips the card instead of having it read: it counts for nothing; the ladder moves to a card not tried. */
export async function addSkip(localId: string, item: { id: string; level: ItemLevel }) {
  await db.checkins
    .where('localId')
    .equals(localId)
    .modify((c) => {
      c.items.push({ itemId: item.id, level: item.level, marks: [], durationMs: null, skipped: true })
    })
}

/** The picture step's answers for the last item saved (a word card). */
export async function addMeaning(localId: string, meaning: { word: string; correct: boolean }[]) {
  await db.checkins
    .where('localId')
    .equals(localId)
    .modify((c) => {
      const last = c.items[c.items.length - 1]
      if (last) last.meaning = meaning
    })
}

/** Ends the local ladder: provisional level from the marks (null if the items do not place the child). */
export async function finishOffline(localId: string, teacherLevel?: Level): Promise<void> {
  const c = await db.checkins.get(localId)
  if (!c) return
  await db.checkins.update(localId, {
    status: 'queued',
    provisionalLevel: teacherLevel ?? placedLevel(outcomes(c)),
    teacherLevel: teacherLevel ?? null,
  })
}

export async function abandonOffline(localId: string) {
  await db.clips.where('checkinLocalId').equals(localId).delete()
  await db.checkins.delete(localId)
}

// ---------------------------------------------------------------- sync

let running = false

async function syncOne(c: QueuedCheckin) {
  let server = await Api.startCheckin(c.studentId, c.language, c.localId, c.startLevel, !!c.fixedLevel)
  if (server.status === 'in_progress') {
    for (let k = server.items.length; k < c.items.length; k++) {
      const it = c.items[k]
      server = (
        it.skipped
          ? await Api.skipItem(server.id, it.itemId)
          : await Api.markItem(server.id, it.itemId, it.marks, it.durationMs ?? undefined)
      ).checkin
    }
    server = c.teacherLevel ? await Api.override(server.id, c.teacherLevel) : await Api.finish(server.id)
  }
  // The picture step's answers, for any card the server does not have them for yet (a sync may have broken off
  // between a card's marks and its answers).
  for (let k = 0; k < Math.min(server.items.length, c.items.length); k++) {
    const it = c.items[k]
    if (it.meaning?.length && !server.items[k].meaning) server = await Api.meaning(server.id, server.items[k].id, it.meaning)
  }
  await db.checkins.update(c.localId, { serverId: server.id })
  for (let k = 0; k < c.items.length; k++) {
    const it = c.items[k]
    if (!it.clipId || it.audioUploaded) continue
    const clip = await db.clips.get(it.clipId)
    if (clip) await Api.attachAudio(server.id, server.items[k].id, clip.blob, clip.mime)
    await db.clips.delete(it.clipId)
    await db.checkins
      .where('localId')
      .equals(c.localId)
      .modify((row) => {
        row.items[k].audioUploaded = true
      })
  }
  await db.checkins.update(c.localId, { status: 'synced', error: undefined })
}

/** Push every finished offline check-in. Stops quietly at the first sign of no network. */
export async function syncAll(): Promise<number> {
  if (running || !navigator.onLine) return 0
  running = true
  let synced = 0
  try {
    const pending = await db.checkins.where('status').anyOf('queued', 'failed').sortBy('startedAt')
    for (const c of pending) {
      try {
        await syncOne(c)
        synced += 1
      } catch (e) {
        if (e instanceof OfflineError) break
        if (e instanceof ApiError && e.status === 401) break // logged out: retry after the next login
        await db.checkins.update(c.localId, {
          status: 'failed',
          error: (e as Error).message,
          attempts: (c.attempts ?? 0) + 1,
        })
      }
    }
    // Synced rows are only kept for a day, as a "sent" receipt on the child's page.
    const dayAgo = Date.now() - 24 * 3600 * 1000
    await db.checkins.where('status').equals('synced').filter((c) => c.startedAt < dayAgo).delete()
  } finally {
    running = false
  }
  return synced
}
