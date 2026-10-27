import Dexie, { type Table } from 'dexie'
import type { ItemLevel, Level } from './lib/types'

/** One item of a check-in run offline: the teacher's tap-marks, plus the recording if one was made. */
export interface OfflineItem {
  itemId: string
  level: ItemLevel
  marks: boolean[]
  durationMs: number | null
  clipId?: number
  audioUploaded?: boolean
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
