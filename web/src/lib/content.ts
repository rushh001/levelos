/** Item banks bundled into the app, so a check-in can run with no network (the service worker precaches them).
 * Every bank in content/items/ is included, with the language settings (tier, speed floors) from languages.json. */
import activityBank from 'virtual:activity-bank'
import languageConfig from '../../../content/languages.json'
import letterWordsConfig from '../../../content/letter_words.json'
import { clusters } from './graphemes'
import { picturedWords } from './pictures'
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
  /** Letters and words each check draws its letter or word card from (as on the server). */
  pools?: Partial<Record<'letter' | 'word', string[]>>
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
/** The words of a text in order, as printed, without the punctuation around them. */
export const wordsOf = (t: BundledText) =>
  t.lines
    .join(' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, ''))
    .filter((w) => w && [...w].every((c) => /[\p{L}\p{M}]/u.test(c) || ZW.has(c)))
export const isAscii = (w: string) => [...w].every((c) => c.charCodeAt(0) < 128)
export const NUKTA = new Set([String.fromCharCode(0x093c), String.fromCharCode(0x09bc)]) // part of the letter: ड़, ড়

/** The letters or words a Letter or Word group reads in a text activity opened from the shelf (the server picks
 * them for a generated plan): the letters the rhyme's words start with, most frequent first, or its short words. */
export function shelfMaterial(activityId: string, lang: string): ActivityMaterial | null {
  const a = ACTIVITIES.find((x) => x.id === activityId)
  const t = a?.uses_text ? textFor(lang, a.uses_text) : null
  if (!a || !t || (a.reads !== 'letters' && a.reads !== 'words')) return null
  if (a.reads === 'letters') return letterCards(lang)
  const words = wordsOf(t).map((w) => (isAscii(w) ? w.toLowerCase() : w))
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

/** The letter a word starts with, without its vowel sign (किसने → क); English in lower case (as the server). */
export const baseLetter = (w: string) => {
  const c = [...w]
  return (NUKTA.has(c[1]) ? c[0] + c[1] : (c[0] ?? '')).toLowerCase()
}

/**
 * Letter cards for a Letter group, as the server makes them (api/app/llm/activities.py, letter_cards): no poem, the
 * language's ASER letters (a different five each `turn`), each with a short word for its sound: one the app has a
 * picture for first, then a classic alphabet-chart word (content/letter_words.json), then one from the language's
 * ASER word cards. The letters the children misread are known to the server.
 */
export function letterCards(lang: string, turn = 0): ActivityMaterial {
  const pool = Array.from(new Set((BANKS[lang]?.items ?? []).filter((i) => i.level === 'letter').flatMap((i) => i.units ?? []).map(baseLetter)))
  const k = pool.length ? (turn * 5) % pool.length : 0
  const items = [...pool.slice(k), ...pool.slice(0, k)].slice(0, 5)
  const short = (w: string) => clusters(w).length >= 2 && clusters(w).length <= 3
  const lower = (w: string) => (isAscii(w) ? w.toLowerCase() : w)
  const cards = (BANKS[lang]?.items ?? []).filter((i) => i.level === 'word').flatMap((i) => i.units ?? []).map(lower)
  const chart = (letterWordsConfig as { words: Record<string, Record<string, string>> }).words[lang] ?? {}
  const anchors: Record<string, string> = {}
  for (const x of items) {
    const pictured = picturedWords(lang)
      .filter((w) => baseLetter(w) === x)
      .sort((p, q) => Number(!short(p)) - Number(!short(q)) || clusters(p).length - clusters(q).length)
    const w = pictured[0] ?? chart[x] ?? cards.find((c) => baseLetter(c) === x && short(c))
    if (w) anchors[x] = w
  }
  return { kind: 'letters', items, anchors }
}
const LANGUAGES = languageConfig as unknown as Record<string, LanguageConfig>
const ACTIVITIES = activityBank as unknown as BankActivity[]

/** Whether the language is written in Latin script (English): no barakhadi or matra work. */
export function isLatinScript(lang: string): boolean {
  return LANGUAGES[lang]?.script === 'Latin'
}

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

// A letter or word card is drawn for each check from the language's pool, as on the server (api/app/content.py):
// its id carries its letters or words ("hi-word~गाय~पानी~मोर~केला~दिन"), so the server scores it when it is synced.
const CARD_SIZE = 5
const CARD_SEP = '~'
const PICTURED_WORDS = 2 // a word card has at least two words with a picture, for the meaning step

/** A small seeded random-number generator (mulberry32 on an FNV-1a hash of the seed): the same seed, the same cards. */
function seeded(seed: string): () => number {
  let a = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 0x01000193) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sample<T>(rand: () => number, from: T[], n: number): T[] {
  const left = [...from]
  const out: T[] = []
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rand() * left.length), 1)[0]!)
  return out
}

const poolOf = (bank: Bank, level: ItemLevel) => (level === 'letter' || level === 'word' ? (bank.pools?.[level] ?? []) : [])

function drawnCard(bank: Bank, level: ItemLevel, units: string[]): ItemPublic {
  return toPublic(bank, { id: `${bank.language}-${level}${CARD_SEP}${units.join(CARD_SEP)}`, level, units })
}

/** Five letters or words from the pool, none of `avoidUnits` while the pool has enough others; null without a pool. */
function drawCard(bank: Bank, level: ItemLevel, rand: () => number, avoidUnits: string[]): ItemPublic | null {
  const pool = poolOf(bank, level)
  if (pool.length < CARD_SIZE * 2) return null
  const fresh = pool.filter((u) => !avoidUnits.includes(u))
  const source = fresh.length >= CARD_SIZE * 2 ? fresh : pool
  const pictured = new Set(picturedWords(bank.language))
  const chosen = level === 'word' ? sample(rand, source.filter((u) => pictured.has(u)), PICTURED_WORDS) : []
  chosen.push(...sample(rand, source.filter((u) => !chosen.includes(u)), CARD_SIZE - chosen.length))
  return drawnCard(bank, level, sample(rand, chosen, chosen.length))
}

/**
 * The card for the next rung (the server's rule): with a `seed` (the check and its position, so the check always
 * shows the same card), a letter or word card drawn from the pool, or a paragraph or story chosen at random among
 * those not in `avoid`; without one, the first card not in `avoid`.
 */
export function pickItem(lang: string, level: ItemLevel, avoid: string[] = [], seed?: string, avoidUnits: string[] = []): ItemPublic {
  const bank = BANKS[lang]
  if (!bank) throw new Error(`no item bank for ${lang}`)
  const rand = seed === undefined ? null : seeded(seed)
  const card = rand ? drawCard(bank, level, rand, avoidUnits) : null
  if (card) return card
  const atLevel = bank.items.filter((i) => i.level === level)
  const fresh = atLevel.filter((i) => !avoid.includes(i.id))
  const choices = fresh.length ? fresh : atLevel
  return toPublic(bank, (rand ? choices[Math.floor(rand() * choices.length)] : choices[0])!)
}

export function getItem(id: string): ItemPublic | null {
  const bank = BANKS[id.split('-')[0]]
  if (!bank) return null
  if (id.includes(CARD_SEP)) {
    const [head, ...units] = id.split(CARD_SEP)
    const level = head!.split('-')[1] as ItemLevel
    const known = new Set([...poolOf(bank, level), ...bank.items.filter((i) => i.level === level).flatMap((i) => i.units ?? [])])
    const ok = (level === 'letter' || level === 'word') && units.length === CARD_SIZE && new Set(units).size === CARD_SIZE
    return ok && units.every((u) => known.has(u)) ? drawnCard(bank, level, units) : null
  }
  const raw = bank.items.find((i) => i.id === id)
  return raw ? toPublic(bank, raw) : null
}
