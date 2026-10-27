/**
 * Which reading test the teacher is giving, and with it the language of the whole interface. As in ASER, a child
 * is tested in their regional language and in English, each with its own level and group. The teacher chooses
 * the test with one switch (on the class and child pages); the interface follows: choose Hindi and everything is
 * in Hindi, choose English and everything is in English, Tamil and everything is in Tamil. The choice is
 * remembered on this phone (a convenience, not data).
 */
import { useEffect, useSyncExternalStore } from 'react'
import i18n, { UI_LANGS } from '../i18n'

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

/** Puts the interface in `lang`, when the app has that interface (every reading language does). */
export function interfaceTo(lang: string) {
  if (!UI_LANGS.includes(lang) || i18n.language === lang) return
  void i18n.changeLanguage(lang)
  try {
    localStorage.setItem('levelos.uiLang', lang)
  } catch {
    /* storage unavailable: the language still switches for this session */
  }
}

export function setReadingLang(lang: string) {
  chosen = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    /* storage unavailable: the choice lasts until the tab closes */
  }
  interfaceTo(lang)
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}

const preferred = () => chosen ?? stored() ?? i18n.language

/** The reading test to show: the preferred one if `offered` includes it, else the first offered. The interface
 * follows the test shown. */
export function useReadingLang(offered?: string[]): [string, (lang: string) => void] {
  const lang = useSyncExternalStore(subscribe, preferred)
  const shown = offered?.length && !offered.includes(lang) ? offered[0] : lang
  useUiFollows(shown)
  return [shown, setReadingLang]
}

/** Keeps the interface in the language of the test on screen (a check, its result, a group's activity). */
export function useUiFollows(lang: string | null | undefined) {
  useEffect(() => {
    if (lang) interfaceTo(lang)
  }, [lang])
}

/** Error-pattern label for a reading test: English reading has its own words for the same patterns. */
export function patternKey(pattern: string, lang: string): string | string[] {
  return lang === 'en' ? [`patternEn.${pattern}`, `pattern.${pattern}`] : `pattern.${pattern}`
}
