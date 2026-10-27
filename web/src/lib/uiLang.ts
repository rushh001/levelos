/**
 * The interface language. It is the language of the reading test the teacher chose (see readingLang.ts), so a
 * teacher giving the Hindi test works in Hindi and giving the English test works in English.
 */
import { useTranslation } from 'react-i18next'
import { UI_LANGS } from '../i18n'

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
