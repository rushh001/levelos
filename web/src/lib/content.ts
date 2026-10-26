/** Item banks bundled into the app, so a check-in can run with no network (the service worker precaches them).
 * Every bank in content/items/ is included, with the language settings (tier, speed floors) from languages.json. */
import activityBank from 'virtual:activity-bank'
import languageConfig from '../../../content/languages.json'
import type { Bilingual, ItemLevel, ItemPublic } from './types'

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

/** The bank's activities for a group reading in `lang` (the same script rule as the server's candidates). */
export function bankActivities(cohort: string, lang: string): { id: string; title: Record<string, string> }[] {
  const script = LANGUAGES[lang]?.script === 'Latin' ? 'latin' : 'indic'
  return ACTIVITIES.filter((a) => a.cohorts.includes(cohort) && (!a.script || a.script === script)).map((a) => ({ id: a.id, title: a.title }))
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
  if (!a?.examples) return {}
  const latin = LANGUAGES[lang]?.script === 'Latin'
  const ex = a.examples[lang] ?? a.examples[latin ? 'en' : 'hi'] ?? {}
  return Object.fromEntries(
    Object.entries(ex).map(([k, v]) => [k, typeof v === 'string' ? v : (v[ui] ?? v.en ?? Object.values(v)[0] ?? '')]),
  )
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
