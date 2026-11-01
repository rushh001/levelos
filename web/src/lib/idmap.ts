/**
 * Temporary IDs given on the phone to a class or child created offline ("local-c-…", "local-s-…"), and the server's
 * IDs they became on sync. API paths are rewritten through this map, so a page still showing a temporary ID keeps
 * working after the sync.
 */
import { db } from '../db'

const KEY = 'idmap'
let map: Record<string, string> | null = null

async function load(): Promise<Record<string, string>> {
  if (!map) map = ((await db.cache.get(KEY).catch(() => undefined))?.value as Record<string, string> | undefined) ?? {}
  return map
}

export const isTempId = (id: string) => /^local-[cs]-/.test(id)

export async function realId(id: string): Promise<string> {
  return (await load())[id] ?? id
}

/** A path with every temporary ID the server has since replaced swapped for the real one. */
export async function realPath(path: string): Promise<string> {
  if (!path.includes('local-')) return path
  const m = await load()
  return path.replace(/local-[cs]-[a-z0-9-]+/g, (id) => m[id] ?? id)
}

export async function remember(tempId: string, serverId: string): Promise<void> {
  const m = await load()
  m[tempId] = serverId
  await db.cache.put({ key: KEY, value: m, updatedAt: Date.now() })
}
