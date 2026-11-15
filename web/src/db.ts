import Dexie, { type Table } from 'dexie'
import type { ItemLevel, Level } from './lib/types'

/** One item of a check-in run offline: the teacher's tap-marks, plus the recording if one was made. */
export interface OfflineItem {
  itemId: string
  level: ItemLevel
  marks: boolean[]
  /** How long the child read: the speech in the recording as measured on the phone (lib/audioCheck), else the
   * clip's length; null without a recording. */
  durationMs: number | null
  /** Long pauses inside the reading, measured on the phone; undefined without a recording that could be measured. */
  hesitations?: number
  /** The teacher skipped this card instead of having it read (no marks): it counts for nothing. Older versions
   * stored a reason here; any value means skipped. */
  skipped?: boolean
  clipId?: number
  audioUploaded?: boolean
  /** The AI marked this card while the teacher waited and the teacher confirmed or changed its marks: the server's
   * signed result, sent back with the marks so the recording is not scored again. */
  ai?: { scoreJson: string; sig: string }
  /** The picture step after a word card, sent with the marks on sync. */
  meaning?: { word: string; correct: boolean }[]
}

/** A check-in started on the phone without network. Lives here until the server has it (and its audio). */
export interface QueuedCheckin {
  localId: string
  studentId: string
  classId: string
  studentName: string
  avatar: string
  language: string
  startLevel: ItemLevel
  /** The teacher chose the group: the check reads only that level's card. */
  fixedLevel?: boolean
  /** An unfinished check on the server this one replaces (started online, then the network went): closed on sync. */
  replaces?: string
  /** How many of its cards were read in that check (carried over to go on from). */
  carried?: number
  /** The teacher who did the check: sent only while they are logged in. */
  owner?: string | null
  startedAt: number
  items: OfflineItem[]
  status: 'in_progress' | 'queued' | 'failed' | 'synced'
  provisionalLevel?: Level | null
  teacherLevel?: Level | null
  serverId?: string
  error?: string
  attempts?: number
}

/** One recorded clip. Deleted as soon as the server has scored it (children's audio is not kept). */
export interface QueuedClip {
  id?: number
  checkinLocalId: string
  itemId: string
  blob: Blob
  mime: string
  durationMs: number
  recordedAt: number
}

/** Last-known server documents (roster, dashboard, child pages) so the app opens offline. */
export interface CachedDoc {
  key: string
  value: unknown
  updatedAt: number
}

class LevelOSDB extends Dexie {
  checkins!: Table<QueuedCheckin, string>
  clips!: Table<QueuedClip, number>
  cache!: Table<CachedDoc, string>

  constructor() {
    super('levelos')
    this.version(1).stores({
      checkins: 'localId, studentId, status, startedAt',
      clips: '++id, checkinLocalId, itemId',
      cache: 'key, updatedAt',
    })
  }
}

export const db = new LevelOSDB()
