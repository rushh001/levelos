/** Splitting words the way the activities do: a card per letter or vowel sign, a cluster per written syllable. */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Written syllables (grapheme clusters): पानी → [पा, नी]; cat → [c, a, t]. */
export function clusters(word: string): string[] {
  const w = word.normalize('NFC')
  return segmenter ? [...segmenter.segment(w)].map((s) => s.segment) : [...w]
}

/** One card per code point, as the letter-and-matra cards of the activity: पानी → [प, ा, न, ी]. */
export function cards(word: string): string[] {
  return [...word.normalize('NFC')]
}

const MARK = /^\p{M}+$/u

/** A vowel sign on its own is shown on a dotted circle, as on a barakhadi chart (◌ा). */
export function showCard(card: string): string {
  return MARK.test(card) ? `◌${card}` : card
}

/** The clusters of `word` that differ from `prev`, compared from both ends so one changed sign stands out
 * (मेला → मैला highlights मै; मला → माला highlights मा). */
export function changedClusters(prev: string, word: string): boolean[] {
  const a = clusters(prev)
  const b = clusters(word)
  const fromLeft = b.map((c, i) => a[i] === c)
  const fromRight = b.map((c, i) => a[a.length - b.length + i] === c)
  return b.map((_, i) => !(fromLeft[i] || fromRight[i]))
}

/** A fixed shuffle (the same on every phone), never the original order when there is more than one card. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const keyed = items.map((v, i) => ({ v, k: (i * 7919 + seed * 104729 + 13) % 97 }))
  keyed.sort((x, y) => x.k - y.k)
  const out = keyed.map((x) => x.v)
  if (items.length > 1 && out.every((v, i) => v === items[i])) out.push(out.shift() as T)
  return out
}
