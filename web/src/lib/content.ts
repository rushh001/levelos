/** Item banks bundled into the app, so a check-in can run with no network (the service worker precaches them). */
import en from '../../../content/items/en.json'
import hi from '../../../content/items/hi.json'
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

const BANKS: Record<string, Bank> = { hi: hi as Bank, en: en as Bank }

export function hasBank(lang: string): boolean {
  return lang in BANKS
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
