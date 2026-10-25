/**
 * The interface language. A teacher uses the app in English and in their class's own language (a Kannada class:
 * English and Kannada, never Hindi), so the language button switches between those two. Which regional language
 * that is comes from the page (the class or child on screen), else from the last class opened on this phone.
 */
import { useTranslation } from 'react-i18next'
import i18n, { UI_LANGS } from '../i18n'
import { setReadingLang } from './readingLang'

const REGIONAL_KEY = 'levelos.regionalLang'

/** The button's label for each language, in its own script. */
export const LANG_SHORT: Record<string, string> = { en: 'EN', hi: 'हि', mr: 'म', kn: 'ಕ', ta: 'த', bn: 'বা' }

const DATE_LOCALE: Record<string, string> = {
  hi: 'hi-IN',
  mr: 'mr-IN',
  kn: 'kn-IN',
  ta: 'ta-IN',
  bn: 'bn-IN',
}

export function dateLocale(lang: string): string {
  return DATE_LOCALE[lang] ?? 'en-IN'
}

/** The language the app is shown in (always one it has an interface for). */
export function useUiLang(): string {
  const { i18n: current } = useTranslation()
  return UI_LANGS.includes(current.language) ? current.language : 'en'
}

/** Text given per language ({en, kn}): the interface language's, else the English. */
export function pick<T>(texts: Partial<Record<string, T>> | null | undefined, ui: string): T | undefined {
  return texts?.[ui] || texts?.en
}

function isRegional(lang?: string | null): lang is string {
  return !!lang && lang !== 'en' && UI_LANGS.includes(lang)
}

function storedRegional(): string {
  try {
    const v = localStorage.getItem(REGIONAL_KEY)
    if (isRegional(v)) return v
  } catch {
    /* storage unavailable */
  }
  return 'hi'
}

/** Remember the class's language, so pages without a class (the class list, login) offer it on the button. */
export function rememberRegional(lang?: string | null) {
  if (!isRegional(lang)) return
  try {
    localStorage.setItem(REGIONAL_KEY, lang)
  } catch {
    /* storage unavailable */
  }
}

/** The regional language the app pairs with English here: the page's language (a class, a child), if the app has
 * an interface in it, else the last one used on this phone. */
export function regionalFor(lang?: string | null): string {
  return isRegional(lang) ? lang : storedRegional()
}

/** What the language button switches to: English from the class's language; the class's language from English
 * (or from any third language). */
export function nextUiLang(ui: string, regional?: string | null): string {
  const home = regionalFor(regional)
  return ui === home ? 'en' : home
}

export function setUiLang(next: string) {
  void i18n.changeLanguage(next)
  setReadingLang(next) // the teacher switched to English: give the English reading test too
  rememberRegional(next)
  try {
    localStorage.setItem('levelos.uiLang', next)
  } catch {
    /* storage unavailable: the language still switches for this session */
  }
}
