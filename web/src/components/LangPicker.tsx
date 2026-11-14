import { useTranslation } from 'react-i18next'
import { UI_LANGS } from '../i18n'
import { interfaceTo, setReadingLang } from '../lib/readingLang'

/** Each interface language named in its own script, so a teacher finds theirs whatever the screen is in now. */
const NATIVE: Record<string, string> = { en: 'English', hi: 'हिन्दी', mr: 'मराठी', kn: 'ಕನ್ನಡ', ta: 'தமிழ்', bn: 'বাংলা' }

/**
 * The interface language, on the login and sign-up screens and on "My classes". Inside a class the reading test
 * the teacher gives sets the language (see readingLang.ts); on "My classes" (`withTest`) the choice also becomes
 * the preferred test, so a class that offers it opens in it rather than switching back.
 */
export function LangPicker({ withTest = false }: { withTest?: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <label className="flex items-center justify-end gap-2 text-sm text-mute">
      <span aria-hidden>🌐</span>
      <span>{t('login.language')}</span>
      <select
        value={UI_LANGS.includes(i18n.language) ? i18n.language : 'en'}
        onChange={(e) => (withTest ? setReadingLang : interfaceTo)(e.target.value)}
        className="rounded-full border border-line bg-white px-3 py-1.5 text-sm text-ink"
      >
        {UI_LANGS.map((l) => (
          <option key={l} value={l}>
            {NATIVE[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  )
}
