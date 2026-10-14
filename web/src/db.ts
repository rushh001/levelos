import Dexie, { type Table } from 'dexie'

/** A check-in started on the phone. Lives here until the server has accepted it. */
export interface QueuedCheckin {
  localId: string
  studentId: string
  language: string
  startedAt: number
  itemIds: string[]
  /** Teacher tap-to-mark results captured offline, per item: true = read correctly. */
  offlineMarks?: Record<string, boolean[]>
  status: 'recording' | 'queued' | 'uploading' | 'uploaded' | 'failed'
  serverId?: string
  error?: string
}

/** One recorded clip (one item) belonging to a queued check-in. */
export interface QueuedClip {
  id?: number
  checkinLocalId: string
  itemId: string
  blob: Blob
  mime: string
  durationMs: number
  recordedAt: number
}

/** Last-known server documents (roster, dashboard) so the app opens offline. */
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
