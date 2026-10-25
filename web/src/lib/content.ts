/** Item banks bundled into the app, so a check-in can run with no network (the service worker precaches them).
 * Every bank in content/items/ is included, with the language settings (tier, speed floors) from languages.json. */
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

interface LanguageConfig {
  tier?: number
  wcpm_floor?: Record<string, number>
}

const files = import.meta.glob<{ default: Bank }>('../../../content/items/*.json', { eager: true })
const BANKS: Record<string, Bank> = Object.fromEntries(Object.values(files).map((m) => [m.default.language, m.default]))
const LANGUAGES = languageConfig as unknown as Record<string, LanguageConfig>

export function hasBank(lang: string): boolean {
  return lang in BANKS
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
