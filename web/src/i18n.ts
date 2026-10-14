import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import hi from './locales/hi.json'

let saved: string | null = null
try {
  saved = localStorage.getItem('levelos.uiLang')
} catch {
  /* storage unavailable */
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: saved ?? 'hi',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
