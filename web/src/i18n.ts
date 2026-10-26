import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import bn from './locales/bn.json'
import en from './locales/en.json'
import hi from './locales/hi.json'
import kn from './locales/kn.json'
import mr from './locales/mr.json'
import ta from './locales/ta.json'

// The interface languages: English and each regional language a class can read in.
const resources = {
  en: { translation: en },
  hi: { translation: hi },
  mr: { translation: mr },
  kn: { translation: kn },
  ta: { translation: ta },
  bn: { translation: bn },
}
export const UI_LANGS = Object.keys(resources)

let saved: string | null = null
try {
  saved = localStorage.getItem('levelos.uiLang')
} catch {
  /* storage unavailable */
}

i18n.use(initReactI18next).init({
  resources,
  lng: saved && UI_LANGS.includes(saved) ? saved : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

// The document's language follows the interface, so the browser picks the right fonts and hyphenation.
const setLang = (lng: string) => {
  document.documentElement.lang = lng
}
setLang(i18n.language)
i18n.on('languageChanged', setLang)

export default i18n
