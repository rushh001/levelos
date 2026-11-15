/**
 * An activity read aloud for the teacher, in the language of their screen. Online, the server's neural voice reads
 * the parts (what the activity is for, each step, the homework, what to watch for) as one recording with the time
 * each part starts; the recording is kept on the phone, so it plays again with no network. Otherwise the phone's own
 * voice reads the parts, if the phone has one for the language.
 */
import bank from 'virtual:activity-bank'
import type { TFunction } from 'i18next'
import { Api, isReachable } from '../api'
import { db } from '../db'
import { patternKey } from './readingLang'
import type { Activity, ActivityStep } from './types'
import { pick } from './uiLang'

export interface Part {
  /** 'intro', 'step-0'…, 'homework' or 'tip' */
  key: string
  text: string
}

export interface Recording {
  url: string
  starts: number[]
  duration: number
}

const MAX_PART = 500
const KEPT = 30 // recordings kept on the phone (each about half a megabyte): a class's groups in its languages, and more
// The locale each interface language's voice speaks, for the phone's own voices.
const LOCALE: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', kn: 'kn-IN', ta: 'ta-IN', bn: 'bn-IN' }

export const stepText = (s: ActivityStep, ui: string): string => String(s[ui] || s.en)

const sentence = (s: string | undefined | null) => {
  const x = (s ?? '').trim()
  return !x || /[.!?।:]$/.test(x) ? x : `${x}.`
}

/** The activity as the parts the teacher hears, in order. `lang`: the reading test (for the mistakes' names). */
export function speechParts(a: Activity, ui: string, lang: string, t: TFunction): Part[] {
  const p = a.plan
  const gaps = (p.focus?.patterns ?? []).map((x) => t(patternKey(x.pattern, lang))).join(', ')
  const materials = pick(p.materials, ui) ?? []
  const intro = [
    sentence(pick(p.title, ui)),
    gaps ? sentence(t('activity.focusSay', { gaps })) : '',
    sentence(pick(p.why, ui)),
    materials.length ? sentence(`${t('activity.materials')}: ${materials.join(', ')}`) : '',
  ]
  const parts: Part[] = [{ key: 'intro', text: intro.filter(Boolean).join(' ') }]
  p.steps.forEach((s, i) => parts.push({ key: `step-${i}`, text: `${t('activity.stepN', { n: i + 1 })}. ${sentence(stepText(s, ui))}` }))
  const homework = pick(p.homework, ui)
  if (homework) parts.push({ key: 'homework', text: `${t('activity.homework')}: ${homework}` })
  const tip = pick(p.watch_for, ui)
  if (tip) parts.push({ key: 'tip', text: `${t('activity.watchFor')}: ${tip}` })
  return parts.map((x) => ({ ...x, text: x.text.slice(0, MAX_PART) }))
}

// FNV-1a: a short, stable name for the parts (crypto.subtle needs HTTPS, which a phone on the local network lacks).
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

interface Kept {
  mime: string
  audio: string
  starts: number[]
  duration: number
}

const asking = new Map<string, Promise<Kept | null>>() // recordings being fetched right now

/** The server's recording of these parts (from the phone's copy when it has one), or null with no network or voice. */
export async function serverRecording(ui: string, parts: Part[]): Promise<Recording | null> {
  const key = `speech/${ui}/${fnv(parts.map((p) => p.text).join('\n'))}`
  let kept = (await db.cache.get(key).catch(() => undefined))?.value as Kept | undefined
  if (!kept) {
    // The header says Offline: no wait on the network (a request would only time out).
    if (!navigator.onLine || !isReachable()) return null
    // One request for a recording, however many ask for it at once (a new activity's recording is being kept for
    // offline as it opens when the teacher presses Listen).
    let ask = asking.get(key)
    if (!ask) {
      ask = Api.speech(ui, parts.map((p) => p.text))
        .then(async (made) => {
          await db.cache.put({ key, value: made, updatedAt: Date.now() }).catch(() => undefined)
          void forgetOld()
          return made
        })
        .catch(() => null)
        .finally(() => asking.delete(key))
      asking.set(key, ask)
    }
    kept = (await ask) ?? undefined
    if (!kept) return null
  }
  const bytes = Uint8Array.from(atob(kept.audio), (c) => c.charCodeAt(0))
  return { url: URL.createObjectURL(new Blob([bytes], { type: kept.mime })), starts: kept.starts, duration: kept.duration }
}

async function forgetOld() {
  const rows = await db.cache.where('key').startsWith('speech/').toArray()
  const old = rows.sort((x, y) => y.updatedAt - x.updatedAt).slice(KEPT)
  if (old.length) await db.cache.bulkDelete(old.map((r) => r.key))
}

/** Keeps the server's recording of an activity on the phone (made once on the server, then free), so it can be
 * heard offline later. Online only; quietly does nothing otherwise. */
export async function keepRecording(ui: string, parts: Part[]): Promise<void> {
  if (!navigator.onLine || !isReachable()) return
  const r = await serverRecording(ui, parts)
  if (r) URL.revokeObjectURL(r.url)
}

// ---------------------------------------------------------------- the book activities, recorded once

// Each book activity's title, steps and tip, recorded per language (api/scripts/make_activity_audio.py; the
// examples in brackets are not read). An activity made on the phone with no network is read aloud from these.
// They are kept in the browser's cache storage, in the cache the service worker serves them from (vite.config.ts):
// the page puts them there itself and reads them back itself, so they do not depend on the service worker being in
// charge of the page at that moment (on the first visit it is not yet, and a hard reload bypasses it).
const AUDIO_CACHE = 'activity-audio'
const RECORDED_PARTS = ['title', 'step-0', 'step-1', 'step-2', 'tip']
const AT_ONCE = 4 // files downloaded at the same time
const clipUrl = (ui: string, activityId: string, part: string) => `/audio/activity/${ui}/${activityId}/${part}.mp3`
const BOOK = bank.filter((a) => a.uses_text)
const audioCache = () => ('caches' in window ? caches.open(AUDIO_CACHE).catch(() => null) : Promise.resolve(null))

/** The recorded parts of a book activity as the bank has it (made on the phone, or the bank's own when Claude was not
 * used): part key -> file. Null for an activity Claude or LM Studio reworded. */
export function bookClips(a: Activity, ui: string): Record<string, string> | null {
  if (!['phone', 'bank'].includes(a.generated_by) || !BOOK.some((b) => b.id === a.source_activity_id)) return null
  const clips: Record<string, string> = { intro: clipUrl(ui, a.source_activity_id, 'title'), tip: clipUrl(ui, a.source_activity_id, 'tip') }
  a.plan.steps.forEach((_, i) => {
    if (RECORDED_PARTS.includes(`step-${i}`)) clips[`step-${i}`] = clipUrl(ui, a.source_activity_id, `step-${i}`)
  })
  return clips
}

const saving = new Map<string, Promise<void>>() // languages being downloaded right now

/** Downloads the recordings for these interface languages (in the background, while online), so they play with no
 * network. Only the files not on the phone yet are fetched, so calling it again costs one look at the cache. */
export async function saveRecordings(uis: string[]): Promise<void> {
  for (const ui of new Set(uis)) {
    let run = saving.get(ui)
    if (!run) {
      run = saveLanguage(ui).finally(() => saving.delete(ui))
      saving.set(ui, run)
    }
    await run
  }
}

async function saveLanguage(ui: string): Promise<void> {
  if (!navigator.onLine) return
  const cache = await audioCache()
  if (!cache) return // no cache storage (a plain-http address): the service worker cannot run there either
  const have = new Set((await cache.keys().catch(() => [] as readonly Request[])).map((r) => new URL(r.url).pathname))
  const missing = BOOK.flatMap((a) => RECORDED_PARTS.map((part) => clipUrl(ui, a.id, part))).filter((u) => !have.has(u))
  let next = 0
  const worker = async () => {
    while (next < missing.length && navigator.onLine) await cache.add(missing[next++]).catch(() => undefined)
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
}

/** The recorded parts ready to play: each from the phone's copy (as a blob, so no network or service worker is
 * needed), or from the network while online. Null when the first part cannot be played. `release` frees the copies. */
export async function playableClips(clips: Record<string, string>): Promise<{ urls: Record<string, string>; release: () => void } | null> {
  const cache = await audioCache()
  const urls: Record<string, string> = {}
  const made: string[] = []
  for (const [key, url] of Object.entries(clips)) {
    const kept = await cache?.match(url).catch(() => undefined)
    const blob = kept?.ok ? await kept.blob().catch(() => null) : null
    if (blob?.size) {
      urls[key] = URL.createObjectURL(blob)
      made.push(urls[key])
    } else if (navigator.onLine && (await fetch(url).then((r) => r.ok).catch(() => false))) {
      urls[key] = url
    }
  }
  const release = () => made.forEach((u) => URL.revokeObjectURL(u))
  if (urls.intro) return { urls, release }
  release()
  return null
}

/** The phone's own voice for the language, if it has one (the list can take a moment to load). */
export async function phoneVoice(ui: string): Promise<SpeechSynthesisVoice | null> {
  if (!('speechSynthesis' in window)) return null
  const find = () => {
    const want = (LOCALE[ui] ?? ui).toLowerCase()
    const voices = window.speechSynthesis.getVoices()
    const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase()
    return voices.find((v) => norm(v) === want) ?? voices.find((v) => norm(v).startsWith(`${ui}-`)) ?? null
  }
  if (window.speechSynthesis.getVoices().length) return find()
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    window.setTimeout(done, 1500)
  })
  return find()
}
