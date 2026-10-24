/**
 * Which reading test the teacher is giving. As in ASER, a child is tested in their regional language and in
 * English, each with its own level and group. Switching the app's language switches the test as well; the switch
 * on the class and child pages changes only the test. Remembered on this phone (a convenience, not data).
 */
import { useSyncExternalStore } from 'react'
import i18n from '../i18n'

const KEY = 'levelos.readingLang'
const EVENT = 'levelos:readingLang'
let chosen: string | null = null

function stored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setReadingLang(lang: string) {
  chosen = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    /* storage unavailable: the choice lasts until the tab closes */
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}

const preferred = () => chosen ?? stored() ?? i18n.language

/** The reading test to show: the preferred one if `offered` includes it, else the first offered. */
export function useReadingLang(offered?: string[]): [string, (lang: string) => void] {
  const lang = useSyncExternalStore(subscribe, preferred)
  return [offered?.length && !offered.includes(lang) ? offered[0] : lang, setReadingLang]
}

/** Error-pattern label for a reading test: English reading has its own words for the same patterns. */
export function patternKey(pattern: string, lang: string): string | string[] {
  return lang === 'en' ? [`patternEn.${pattern}`, `pattern.${pattern}`] : `pattern.${pattern}`
}
