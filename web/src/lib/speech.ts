/**
 * An activity read aloud for the teacher, in the language of their screen. Online, the server's neural voice reads
 * the parts (what the activity is for, each step, the homework, what to watch for) as one recording with the time
 * each part starts; the recording is kept on the phone, so it plays again with no network. Otherwise the phone's own
 * voice reads the parts, if the phone has one for the language.
 */
import type { TFunction } from 'i18next'
import { Api } from '../api'
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
const KEPT = 12 // recordings kept on the phone (each about half a megabyte)
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

/** The server's recording of these parts (from the phone's copy when it has one), or null with no network or voice. */
export async function serverRecording(ui: string, parts: Part[]): Promise<Recording | null> {
  const key = `speech/${ui}/${fnv(parts.map((p) => p.text).join('\n'))}`
  let kept = (await db.cache.get(key).catch(() => undefined))?.value as Kept | undefined
  if (!kept) {
    try {
      kept = await Api.speech(ui, parts.map((p) => p.text))
    } catch {
      return null
    }
    await db.cache.put({ key, value: kept, updatedAt: Date.now() }).catch(() => undefined)
    void forgetOld()
  }
  const bytes = Uint8Array.from(atob(kept.audio), (c) => c.charCodeAt(0))
  return { url: URL.createObjectURL(new Blob([bytes], { type: kept.mime })), starts: kept.starts, duration: kept.duration }
}

async function forgetOld() {
  const rows = await db.cache.where('key').startsWith('speech/').toArray()
  const old = rows.sort((x, y) => y.updatedAt - x.updatedAt).slice(KEPT)
  if (old.length) await db.cache.bulkDelete(old.map((r) => r.key))
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
