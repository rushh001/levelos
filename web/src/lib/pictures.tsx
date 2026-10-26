/** Pictures for simple words (OpenMoji drawings bundled with the app): the meaning step after a word card, the
 * matching game, flash cards. A word without a picture simply has none; nothing waits for the network. */
import picturesConfig from '../../../content/pictures.json'

const WORDS = (picturesConfig as { words: Record<string, Record<string, string>> }).words

export function pictureFor(word: string, lang: string): string | null {
  const code = WORDS[lang]?.[word.normalize('NFC').trim()]
  return code ? `/pictures/${code}.svg` : null
}

export function hasPicture(word: string, lang: string): boolean {
  return pictureFor(word, lang) !== null
}

/** Words of `lang` that have a picture, for distractors in games. */
export function picturedWords(lang: string): string[] {
  return Object.keys(WORDS[lang] ?? {})
}

export function Picture({ word, lang, size = 96, className = '' }: { word: string; lang: string; size?: number; className?: string }) {
  const src = pictureFor(word, lang)
  if (!src) return null
  return <img src={src} alt="" width={size} height={size} draggable={false} className={`select-none ${className}`} />
}
