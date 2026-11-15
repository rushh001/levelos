/**
 * Check-ins run on the phone without network, and their sync.
 *
 * Offline, the teacher records each item (optional) and taps the letters/words the child got wrong; the ASER
 * ladder runs locally on those marks (lib/aser.ts) and gives a provisional level at once. On sync the server
 * replays the same ladder from the marks (same starting rung, same rules), then AI-scores each recording;
 * wherever the AI disagrees with a tap, that word becomes uncertain for the teacher to confirm.
 * Every step is idempotent (local_id, item count, per-clip flag), so an interrupted sync simply resumes.
 */
import { Api, ApiError, announceSynced, currentTeacherId, noServer } from '../api'
import { db, type OfflineItem, type QueuedCheckin } from '../db'
import type { ClipCheck } from './audioCheck'
import i18n from '../i18n'
import { itemPassed, nextItemLevel, oneMoreLevel, outcomeFromMarks, placedLevel, skippedOutcome, startLevel } from './aser'
import { flushOutbox, mine, waitsForChild } from './outbox'
import { getItem, pickItem } from './content'
import { nameIn } from './names'
import { wordCorrect } from './rescore'
import type { Checkin, ItemLevel, ItemPublic, Level, StudentDetail } from './types'

export function newLocalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** A card read on the server, as the phone keeps it: what the child got right (the teacher's taps, else the speech
 * services'), so the ladder goes on from it. */
function carried(r: Checkin['items'][number]): OfflineItem {
  if (r.source === 'skipped') return { itemId: r.item_id, level: r.item_level, marks: [], durationMs: null, skipped: true }
  return {
    itemId: r.item_id,
    level: r.item_level,
    marks: r.result.words.map(wordCorrect),
    durationMs: r.result.reading_ms || null,
    retry: r.result.retry || undefined,
    meaning: r.meaning?.length ? r.meaning : undefined,
  }
}

/** The cards of a check on the server the phone can go on from, so the server replays the same ladder when the
 * check is sent: each one up to the first that is not the card the ladder asks for at that point (the starting card
 * changed since: a group was chosen in between), or that would count differently from marks alone (a passage the
 * AI failed for its long pauses, which marks do not carry). The child reads from there again. */
function carriedItems(from: Checkin, language: string): OfflineItem[] {
  const out: OfflineItem[] = []
  for (const r of from.items) {
    const it = carried(r)
    const sofar = out.map((x) => (x.skipped ? skippedOutcome(x.level) : outcomeFromMarks(x.level, x.marks, x.durationMs, language)))
    if (nextItemLevel(sofar, from.start_level, !!from.fixed_level) !== it.level) break
    if (!it.skipped && itemPassed(outcomeFromMarks(it.level, it.marks, it.durationMs, language)) !== !!r.passed) break
    out.push(it)
  }
  return out
}

/** A reading check run on the phone. `from`: the unfinished check on the server it takes over (the network went in
 * the middle of it, or it was started online and is opened again with no network): it goes on from the cards
 * already read, from the same starting card, and the server's one is closed on sync. */
export async function startOffline(s: StudentDetail, language: string, from?: Checkin): Promise<string> {
  const localId = newLocalId()
  const level = s.levels[language]
  const items = from ? carriedItems(from, language) : []
  await db.checkins.put({
    localId,
    studentId: s.id,
    classId: s.class_id,
    studentName: nameIn(s, s.first_name, i18n.language),
    avatar: s.avatar,
    language,
    startLevel:
      from?.start_level ??
      startLevel(
        s.grade,
        level?.confirmed_level ?? level?.provisional_level ?? null,
        level?.cohort_override ?? null,
        Object.entries(s.levels)
          .filter(([l]) => l !== language)
          .map(([, lv]) => lv.confirmed_level ?? lv.provisional_level)
          .filter((lv): lv is NonNullable<typeof lv> => lv !== null),
      ),
    fixedLevel: from ? !!from.fixed_level : !!level?.cohort_override,
    replaces: from?.id,
    carried: items.length,
    owner: currentTeacherId(),
    startedAt: Date.now(),
    items,
    status: 'in_progress',
  })
  return localId
}

export function outcomes(c: QueuedCheckin) {
  return c.items.map((it) =>
    it.skipped
      ? skippedOutcome(it.level)
      : { ...outcomeFromMarks(it.level, it.marks, it.durationMs, c.language, it.hesitations ?? null), retry: !!it.retry },
  )
}

/** The level the teacher may give one more card at now (the ladder ended on a fail there), or null. */
export function oneMoreFor(c: QueuedCheckin): ItemLevel | null {
  return c.status === 'in_progress' ? oneMoreLevel(outcomes(c), c.startLevel, !!c.fixedLevel) : null
}

/** The teacher asks for one more card at the level the child just failed. */
export async function giveOneMore(localId: string) {
  await db.checkins
    .where('localId')
    .equals(localId)
    .modify((c) => {
      const level = oneMoreFor(c)
      if (level) c.oneMore = level
    })
}

/** The teacher changes their mind about the one more card: the check ends as the ladder had it. */
export async function noOneMore(localId: string) {
  await db.checkins.update(localId, { oneMore: undefined })
}

/** The next card, by the server's rule: seeded by the check and its position, so the check shows the same card if
 * the page is opened again and every check (every child) gets its own; never a card read in this check (a skipped
 * one was not read). */
export function nextItem(c: QueuedCheckin): ItemPublic | null {
  if (c.status !== 'in_progress') return null
  const level = c.oneMore && c.oneMore === oneMoreFor(c) ? c.oneMore : nextItemLevel(outcomes(c), c.startLevel, !!c.fixedLevel)
  if (!level) return null
  const read = c.items.filter((i) => !i.skipped).map((i) => i.itemId)
  const units = read.flatMap((id) => getItem(id)?.units ?? [])
  return pickItem(c.language, level, read, `${c.localId}:${c.items.length}`, units)
}

/** A card marked. `measured`: the phone's measure of the recording (reading time and long pauses, lib/audioCheck),
 * which the ladder uses here and the server on sync; without one, the clip's length. `ai`: the AI's signed result
 * the teacher saw and confirmed (or changed) before saving. */
export async function addItem(
  localId: string,
  item: { id: string; level: ItemLevel },
  marks: boolean[],
  clip: { blob: Blob; mime: string; durationMs: number } | null,
  measured: ClipCheck | null = null,
  ai: { scoreJson: string; sig: string } | null = null,
) {
  const clipId = clip
    ? await db.clips.add({ checkinLocalId: localId, itemId: item.id, ...clip, recordedAt: Date.now() })
    : undefined
  await db.checkins
    .where('localId')
    .equals(localId)
    .modify((c) => {
      const retry = c.oneMore === item.level
      c.oneMore = undefined
      c.items.push({
        itemId: item.id,
        level: item.level,
        retry: retry || undefined,
        marks,
        durationMs: clip ? (measured?.readingMs || clip.durationMs) : null,
        hesitations: clip && measured ? measured.hesitations : undefined,
        ai: ai ?? undefined,
        clipId,
      })
    })
}

/** A card's marks to the server, with the AI's signed result when the teacher confirmed one. If the server will not
 * take that result (made with another key, say), the marks go alone: the recording is then scored on upload. */
async function sendMarks(serverId: string, it: OfflineItem) {
  const send = (ai?: OfflineItem['ai']) =>
    Api.markItem(serverId, it.itemId, it.marks, it.durationMs ?? undefined, it.hesitations, ai, !!it.retry)
  if (!it.ai) return send()
  try {
    return await send(it.ai)
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) return send()
    throw e
  }
}

/** The teacher skips the card instead of having it read: it counts for nothing; the ladder moves to a card not tried. */
export async function addSkip(localId: string, item: { id: string; level: ItemLevel }) {
  await db.checkins
    .where('localId')
    .equals(localId)
    .modify((c) => {
      // Skipping the one more card: it is simply not given, and the check ends as the ladder had it.
      if (c.oneMore) c.oneMore = undefined
      else c.items.push({ itemId: item.id, level: item.level, marks: [], durationMs: null, skipped: true })
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

/** A check the server refused, sent again (the teacher asked). */
export async function retryOffline(localId: string) {
  await db.checkins.update(localId, { status: 'queued', attempts: 0, error: undefined })
  void syncAll()
}

export async function abandonOffline(localId: string) {
  await db.clips.where('checkinLocalId').equals(localId).delete()
  await db.checkins.delete(localId)
}

// ---------------------------------------------------------------- sync

let running = false

/** The check could not be sent as it is: tried again a few times, then left for the teacher to see. */
class NotSendable extends Error {}

async function syncOne(c: QueuedCheckin) {
  // The unfinished check on the server this one took over is closed first. If it had finished after all (its last
  // answer was lost on the way back) and nothing was read on the phone since, this one only repeats it: let go.
  if (c.replaces && !c.serverId) {
    const old = await Api.abandon(c.replaces).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null // removed in the meantime
      throw e
    })
    if (old && (old.status === 'scored' || old.status === 'needs_review') && c.items.length <= (c.carried ?? 0) && !c.teacherLevel) {
      await db.clips.where('checkinLocalId').equals(c.localId).delete()
      await db.checkins.update(c.localId, { status: 'synced', serverId: old.id, error: undefined })
      return
    }
  }
  let server = await Api.startCheckin(c.studentId, c.language, c.localId, c.startLevel, !!c.fixedLevel, c.startedAt)
  await db.checkins.update(c.localId, { serverId: server.id })
  if (server.status === 'abandoned') throw new NotSendable('stopped on the server while it was being sent')
  if (server.status === 'in_progress') {
    for (let k = server.items.length; k < c.items.length; k++) {
      const it = c.items[k]
      server = (
        it.skipped
          ? await Api.skipItem(server.id, it.itemId)
          : await sendMarks(server.id, it)
      ).checkin
    }
    server = c.teacherLevel ? await Api.override(server.id, c.teacherLevel) : await Api.finish(server.id)
  }
  if (server.items.length < c.items.length) throw new NotSendable(`the server has ${server.items.length} of its ${c.items.length} cards`)
  // The picture step's answers, for any card the server does not have them for yet (a sync may have broken off
  // between a card's marks and its answers).
  for (let k = 0; k < Math.min(server.items.length, c.items.length); k++) {
    const it = c.items[k]
    if (it.meaning?.length && !server.items[k].meaning) server = await Api.meaning(server.id, server.items[k].id, it.meaning)
  }
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

const MAX_ATTEMPTS = 3 // a check the server refuses is tried this often, then left for the teacher (send again, or remove)

/** Push every finished offline check-in of the teacher logged in. Stops quietly at the first sign of no network (or
 * a server failing for now): those are sent next time. A check the server refuses is tried a few times only. */
export async function syncAll(): Promise<number> {
  if (running || !navigator.onLine) return 0
  running = true
  let synced = 0
  try {
    await flushOutbox() // classes, children and group changes made offline go first: the checks may need them
    const pending = (await db.checkins.where('status').anyOf('queued', 'failed').sortBy('startedAt')).filter(
      (c) => mine(c) && (c.status === 'queued' || (c.attempts ?? 0) < MAX_ATTEMPTS),
    )
    for (const c of pending) {
      if (await waitsForChild(c)) continue // the child made offline is not on the server yet
      try {
        await syncOne(c)
        synced += 1
      } catch (e) {
        if (noServer(e)) break // no network, or the server failing for now: sent next time
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
    announceSynced(synced)
  }
  return synced
}
