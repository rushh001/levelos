/**
 * ASER ladder rules for check-ins run offline on the phone (tap-to-mark). A direct port of
 * api/app/levels/aser_rules.py; api/tests/test_offline_parity.py fails if the numbers below drift from it.
 * The server re-applies the same rules when the check-in syncs.
 */
import { wcpmFloor } from './content'
import type { ItemLevel, Level } from './types'

export const ITEM_LEVELS: ItemLevel[] = ['letter', 'word', 'paragraph', 'story']
const ORDER: Record<Level, number> = { beginner: 0, letter: 1, word: 2, paragraph: 3, story: 4 }

export const THRESHOLDS = {
  discretePassFraction: 0.8,
  passageMaxErrors: 3,
  passageMaxHesitations: 2,
  passageMinWcpm: { paragraph: 15.0, story: 20.0 } as Record<string, number>,
}
export const MAX_ITEMS_PER_CHECKIN = 4

export interface Outcome {
  level: ItemLevel
  total: number
  correct: number
  hesitations: number | null
  wcpm: number | null
  wcpmFloor: number | null // the text's language's own speed floor (longer words than Hindi), else the default
  skipped?: boolean // the teacher skipped the card: not read, it counts for nothing (neither a pass nor a fail)
}

/** A card the teacher skipped instead of having it read: it counts for nothing in the level. */
export function skippedOutcome(level: ItemLevel): Outcome {
  return { level, total: 0, correct: 0, hesitations: null, wcpm: null, wcpmFloor: null, skipped: true }
}

/** The cards the child actually read (skipped cards left out). */
const readOnly = (outcomes: Outcome[]) => outcomes.filter((o) => !o.skipped)

export function outcomeFromMarks(level: ItemLevel, marks: boolean[], durationMs: number | null, lang: string): Outcome {
  const correct = marks.filter(Boolean).length
  const passage = level === 'paragraph' || level === 'story'
  // Same rounding as the server (one decimal) so a borderline reading lands on the same side.
  const wcpm = passage && durationMs ? Math.round((correct * 600_000) / durationMs) / 10 : null
  return { level, total: marks.length, correct, hesitations: null, wcpm, wcpmFloor: wcpmFloor(lang, level) }
}

export function itemPassed(o: Outcome): boolean {
  if (o.skipped) return false // the ladder and the level leave skipped cards out; a skip is never a pass
  if (o.level === 'letter' || o.level === 'word') {
    return o.correct >= Math.ceil(THRESHOLDS.discretePassFraction * o.total)
  }
  if (o.total - o.correct > THRESHOLDS.passageMaxErrors) return false
  if (o.hesitations !== null && o.hesitations > THRESHOLDS.passageMaxHesitations) return false
  const floor = o.wcpmFloor ?? THRESHOLDS.passageMinWcpm[o.level]
  if (o.wcpm !== null && floor !== undefined && o.wcpm < floor) return false
  return true
}

/** Highest level passed among the cards read; 'beginner' if cards were read and none passed; null if none read. */
export function levelFromOutcomes(outcomes: Outcome[]): Level | null {
  const read = readOnly(outcomes)
  if (!read.length) return null
  const passed = read.filter(itemPassed).map((o) => ORDER[o.level])
  if (!passed.length) return 'beginner'
  const top = Math.max(...passed)
  return (Object.keys(ORDER) as Level[]).find((l) => ORDER[l] === top) ?? null
}

/** Null when the items read do not place the child (nothing passed and letters were never tried). */
export function placedLevel(outcomes: Outcome[]): Level | null {
  const level = levelFromOutcomes(outcomes)
  if (level === 'beginner' && !readOnly(outcomes).some((o) => o.level === 'letter')) return null
  return level
}

/** A group the teacher chose by hand wins; then the last confirmed level; then the grade (as the server). */
/** The card a known level is re-tested with: Beginner and Letter at letters, the others at their own rung. */
function rung(level: Level): ItemLevel {
  return level === 'beginner' || level === 'letter' ? 'letter' : level
}

/** Same rule as the server's aser_rules.start_level: the teacher's group (the check then reads only that card),
 * else the child's last level in this test (confirmed or not), else letters, whatever the grade. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function startLevel(_grade: number | null, lastLevel: Level | null, group?: string | null, _otherLevels: Level[] = []): ItemLevel {
  if (group === 'letter' || group === 'word' || group === 'paragraph' || group === 'story') return group
  if (lastLevel) return rung(lastLevel)
  return 'letter'
}

/** Same rule as the server's next_item_level: up on a pass, down on a fail; after a skip the nearest card not tried
 * yet, an easier one first. Never a card already tried (read or skipped), never past a card read. */
export function nextItemLevel(outcomes: Outcome[], start: ItemLevel, fixed = false): ItemLevel | null {
  if (!outcomes.length) return start
  if (fixed) return outcomes.some((o) => o.level === start) ? null : start // the group's card only, until tried
  const read = readOnly(outcomes)
  if (read.length >= MAX_ITEMS_PER_CHECKIN) return null // only cards read count
  const tried = new Set(outcomes.map((o) => o.level))
  const at = (l: ItemLevel) => ITEM_LEVELS.indexOf(l)
  const lo = Math.max(-1, ...read.filter(itemPassed).map((o) => at(o.level)))
  const hi = Math.min(ITEM_LEVELS.length, ...read.filter((o) => !itemPassed(o)).map((o) => at(o.level)))
  const open = ITEM_LEVELS.map((_, i) => i).filter((i) => i > lo && i < hi && !tried.has(ITEM_LEVELS[i]))
  const last = outcomes[outcomes.length - 1]
  const idx = at(last.level)
  if (last.skipped) {
    const below = open.filter((i) => i < idx)
    const above = open.filter((i) => i > idx)
    return below.length ? ITEM_LEVELS[Math.max(...below)] : above.length ? ITEM_LEVELS[Math.min(...above)] : null
  }
  const step = itemPassed(last) ? idx + 1 : idx - 1
  return open.includes(step) ? ITEM_LEVELS[step] : null
}
