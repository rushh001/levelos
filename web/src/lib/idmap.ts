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

/** The other names a class or child goes by on this phone: its temporary ID and the server's ID for it. */
export async function aliases(id: string): Promise<string[]> {
  const m = await load()
  const out = new Set([id])
  if (m[id]) out.add(m[id])
  for (const [temp, real] of Object.entries(m)) if (real === id) out.add(temp)
  return [...out]
}

/** A path under each name its class or child goes by (itself first): a page saved offline under a temporary ID is
 * found when it is asked for under the server's ID, and the other way round. */
export async function pathAliases(path: string): Promise<string[]> {
  const m = await load()
  const out = new Set([path])
  for (const [temp, real] of Object.entries(m)) {
    for (const p of [...out]) {
      if (p.includes(real)) out.add(p.split(real).join(temp))
      if (p.includes(temp)) out.add(p.split(temp).join(real))
    }
  }
  return [...out]
}

export async function remember(tempId: string, serverId: string): Promise<void> {
  const m = await load()
  m[tempId] = serverId
  await db.cache.put({ key: KEY, value: m, updatedAt: Date.now() })
}
