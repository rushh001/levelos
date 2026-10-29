/** Item banks bundled into the app, so a check-in can run with no network (the service worker precaches them).
 * Every bank in content/items/ is included, with the language settings (tier, speed floors) from languages.json. */
import activityBank from 'virtual:activity-bank'
import languageConfig from '../../../content/languages.json'
import { clusters } from './graphemes'
import type { ActivityMaterial, ActivityText, Bilingual, ItemLevel, ItemPublic } from './types'

interface RawItem {
  id: string
  level: string
  units?: string[]
  sentences?: string[]
  title?: string
}

interface Bank {
  language: string
  instructions: Record<string, Bilingual>
  items: RawItem[]
}

/** The letter chart the "Show the class" screen draws: consonants × vowel signs, or letters with picture words. */
export interface Chart {
  consonants?: string
  vowel_signs?: string[]
  letters?: string
  pictures?: Record<string, [string, string]>
}

interface LanguageConfig {
  tier?: number
  script?: string
  wcpm_floor?: Record<string, number>
  chart?: Chart
}

type ExampleValue = string | Record<string, string>
interface BankActivity {
  id: string
  title: Record<string, string>
  cohorts: string[]
  script?: string
  examples?: Record<string, Record<string, ExampleValue>>
  uses_text?: 'rhyme' | 'story'
  reads?: 'letters' | 'words' | 'text'
}

/** A free-to-use text (content/texts/<lang>.json): the same shape the plan carries, plus the bank's own fields. */
export type BundledText = ActivityText & { level: string; author_died?: number | null }

const textFiles = import.meta.glob<{ default: { language: string; texts: BundledText[] } }>('../../../content/texts/*.json', { eager: true })
const TEXTS: Record<string, BundledText[]> = Object.fromEntries(Object.values(textFiles).map((m) => [m.default.language, m.default.texts]))

export function textsFor(lang: string): BundledText[] {
  return TEXTS[lang] ?? []
}

/** The language's first text of this kind (the one the bank's text activities use), or null. */
export function textFor(lang: string, kind: 'rhyme' | 'story'): BundledText | null {
  return textsFor(lang).find((t) => t.kind === kind) ?? null
}

/** The bundled text a text activity uses when it has no plan of its own (the shelf), or null. */
export function textForActivity(activityId: string, lang: string): BundledText | null {
  const kind = ACTIVITIES.find((x) => x.id === activityId)?.uses_text
  return kind ? textFor(lang, kind) : null
}

const ZW = new Set([String.fromCharCode(0x200c), String.fromCharCode(0x200d)])
const wordsOf = (t: BundledText) =>
  t.lines
    .join(' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, ''))
    .filter((w) => w && [...w].every((c) => /[\p{L}\p{M}]/u.test(c) || ZW.has(c)))
const isAscii = (w: string) => [...w].every((c) => c.charCodeAt(0) < 128)
const NUKTA = new Set([String.fromCharCode(0x093c), String.fromCharCode(0x09bc)]) // part of the letter: ड़, ড়

/** The letters or words a Letter or Word group reads in a text activity opened from the shelf (the server picks
 * them for a generated plan): the letters the rhyme's words start with, most frequent first, or its short words. */
export function shelfMaterial(activityId: string, lang: string): ActivityMaterial | null {
  const a = ACTIVITIES.find((x) => x.id === activityId)
  const t = a?.uses_text ? textFor(lang, a.uses_text) : null
  if (!a || !t || (a.reads !== 'letters' && a.reads !== 'words')) return null
  const words = wordsOf(t).map((w) => (isAscii(w) ? w.toLowerCase() : w))
  if (a.reads === 'letters') {
    const counts = new Map<string, number>()
    const anchors: Record<string, string> = {}
    for (const w of words) {
      const first = [...w]
      const b = (NUKTA.has(first[1]) ? first[0] + first[1] : first[0]).toLowerCase()
      counts.set(b, (counts.get(b) ?? 0) + 1)
      if (!anchors[b] || (clusters(anchors[b]).length < 2 && clusters(w).length >= 2)) anchors[b] = w // "all" for a, not "a"
    }
    const items = [...counts.keys()].sort((x, y) => (counts.get(y) ?? 0) - (counts.get(x) ?? 0)).slice(0, 5)
    return { kind: 'letters', items, anchors: Object.fromEntries(items.map((b) => [b, anchors[b]])) }
  }
  const simple = (w: string) => (isAscii(w) ? w.length >= 2 && w.length <= 5 : clusters(w).length >= 2 && clusters(w).length <= 3)
  const own = t.words_to_find.map((w) => (isAscii(w) ? w.toLowerCase() : w))
  const items = Array.from(new Set([...own, ...words].filter((w) => simple(w) && words.includes(w)))).slice(0, 8)
  return { kind: 'words', items }
}

/** What a text activity fills {title}, {words}, {letter} and {letters} with, from the language's text (as the
 * server does): English letters in lower case, so H and h are one card. */
function textExamples(t: BundledText | null): Record<string, string> {
  if (!t) return {}
  const words = t.words_to_find
  const letters = Array.from(new Set(words.map((w) => (clusters(w)[0] ?? '').toLowerCase()).filter(Boolean)))
  return { title: t.title, words: words.join(', '), letter: letters[0] ?? '', letters: letters.join(', ') }
}

/** A short rhyme per language for the "Rhyme and read" screen; its lines' recordings are in public/audio/rhyme. */
export interface Rhyme {
  language: string
  title: string
  lines: string[]
  words_to_find: string[]
}

const files = import.meta.glob<{ default: Bank }>('../../../content/items/*.json', { eager: true })
const rhymeFiles = import.meta.glob<{ default: Rhyme }>('../../../content/rhymes/*.json', { eager: true })
const RHYMES: Record<string, Rhyme> = Object.fromEntries(Object.values(rhymeFiles).map((m) => [m.default.language, m.default]))

export function rhymeFor(lang: string): Rhyme | null {
  return RHYMES[lang] ?? null
}
const BANKS: Record<string, Bank> = Object.fromEntries(Object.values(files).map((m) => [m.default.language, m.default]))
const LANGUAGES = languageConfig as unknown as Record<string, LanguageConfig>
const ACTIVITIES = activityBank as unknown as BankActivity[]

export function hasBank(lang: string): boolean {
  return lang in BANKS
}

export function chartFor(lang: string): Chart | null {
  return LANGUAGES[lang]?.chart ?? null
}

/** The bank's activities for a group reading in `lang` (the same script and text rules as the server's candidates). */
export function bankActivities(cohort: string, lang: string): { id: string; title: Record<string, string> }[] {
  const script = LANGUAGES[lang]?.script === 'Latin' ? 'latin' : 'indic'
  return ACTIVITIES.filter(
    (a) => a.cohorts.includes(cohort) && (!a.script || a.script === script) && (!a.uses_text || textFor(lang, a.uses_text)),
  )
    .sort((a, b) => Number(!!b.uses_text) - Number(!!a.uses_text)) // the ones built on a book's text first
    .map((a) => ({ id: a.id, title: a.title }))
}

/** Fills {ex1}, {chart}, … in a bank text with the group's examples. */
export function fillExamples(text: string, ex: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => ex[k] ?? '')
}

/** The example letters and words a bank activity shows a group reading in `lang` (the same fallback as the
 * server: a language without its own gets the Hindi ones, or the English ones for Latin script). A value given per
 * interface language (the chart's name) comes back in `ui`. */
export function activityExamples(activityId: string, lang: string, ui: string): Record<string, string> {
  const a = ACTIVITIES.find((x) => x.id === activityId)
  if (!a) return {}
  const fromText = a.uses_text ? textExamples(textFor(lang, a.uses_text)) : {}
  const latin = LANGUAGES[lang]?.script === 'Latin'
  const ex = a.examples?.[lang] ?? a.examples?.[latin ? 'en' : 'hi'] ?? {}
  return {
    ...fromText,
    ...Object.fromEntries(
      Object.entries(ex).map(([k, v]) => [k, typeof v === 'string' ? v : (v[ui] ?? v.en ?? Object.values(v)[0] ?? '')]),
    ),
  }
}

/** Languages a reading check can be given in, in the order of languages.json (Hindi, English, then the rest). */
export function bankLanguages(): string[] {
  return Object.keys(LANGUAGES).filter((lang) => lang in BANKS)
}

/** Supported but not yet validated with children's recordings and teacher testing. */
export function isBeta(lang: string): boolean {
  return (LANGUAGES[lang]?.tier ?? 2) > 1
}

/** The language's own reading-speed floor for a passage level (same rule as the server's content.wcpm_floor). */
export function wcpmFloor(lang: string, level: string): number | null {
  return LANGUAGES[lang]?.wcpm_floor?.[level] ?? null
}

function toPublic(bank: Bank, raw: RawItem): ItemPublic {
  return {
    id: raw.id,
    lang: bank.language,
    level: raw.level as ItemLevel,
    units: raw.units ?? null,
    sentences: raw.sentences ?? null,
    title: raw.title ?? null,
    instructions: bank.instructions[raw.level] ?? {},
  }
}

/** First variant at this level not in `avoid` (same rotation rule as the server). */
export function pickItem(lang: string, level: ItemLevel, avoid: string[] = []): ItemPublic {
  const bank = BANKS[lang]
  if (!bank) throw new Error(`no item bank for ${lang}`)
  const atLevel = bank.items.filter((i) => i.level === level)
  const fresh = atLevel.filter((i) => !avoid.includes(i.id))
  return toPublic(bank, (fresh[0] ?? atLevel[0])!)
}

export function getItem(id: string): ItemPublic | null {
  const bank = BANKS[id.split('-')[0]]
  const raw = bank?.items.find((i) => i.id === id)
  return bank && raw ? toPublic(bank, raw) : null
}
