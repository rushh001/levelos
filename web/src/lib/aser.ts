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
}

export function outcomeFromMarks(level: ItemLevel, marks: boolean[], durationMs: number | null, lang: string): Outcome {
  const correct = marks.filter(Boolean).length
  const passage = level === 'paragraph' || level === 'story'
  // Same rounding as the server (one decimal) so a borderline reading lands on the same side.
  const wcpm = passage && durationMs ? Math.round((correct * 600_000) / durationMs) / 10 : null
  return { level, total: marks.length, correct, hesitations: null, wcpm, wcpmFloor: wcpmFloor(lang, level) }
}

export function itemPassed(o: Outcome): boolean {
  if (o.level === 'letter' || o.level === 'word') {
    return o.correct >= Math.ceil(THRESHOLDS.discretePassFraction * o.total)
  }
  if (o.total - o.correct > THRESHOLDS.passageMaxErrors) return false
  if (o.hesitations !== null && o.hesitations > THRESHOLDS.passageMaxHesitations) return false
  const floor = o.wcpmFloor ?? THRESHOLDS.passageMinWcpm[o.level]
  if (o.wcpm !== null && floor !== undefined && o.wcpm < floor) return false
  return true
}

export function levelFromOutcomes(outcomes: Outcome[]): Level | null {
  if (!outcomes.length) return null
  const passed = outcomes.filter(itemPassed).map((o) => ORDER[o.level])
  if (!passed.length) return 'beginner'
  const top = Math.max(...passed)
  return (Object.keys(ORDER) as Level[]).find((l) => ORDER[l] === top) ?? null
}

/** Null when the items read do not place the child (nothing passed and letters were never tried). */
export function placedLevel(outcomes: Outcome[]): Level | null {
  const level = levelFromOutcomes(outcomes)
  if (level === 'beginner' && !outcomes.some((o) => o.level === 'letter')) return null
  return level
}

/** A group the teacher chose by hand wins; then the last confirmed level; then the grade (as the server). */
/** The card a known level is re-tested with: Beginner and Letter at letters, the others at their own rung. */
function rung(level: Level): ItemLevel {
  return level === 'beginner' || level === 'letter' ? 'letter' : level
}

/** Same rule as the server's aser_rules.start_level: the teacher's group, else the child's last level in this test
 * (confirmed or not), else the grade — but never above the child's level in their other reading test. */
export function startLevel(grade: number | null, lastLevel: Level | null, group?: string | null, otherLevels: Level[] = []): ItemLevel {
  if (group === 'letter' || group === 'word' || group === 'paragraph') return group
  if (lastLevel) return rung(lastLevel)
  const byGrade: ItemLevel = grade === null || grade <= 1 ? 'letter' : grade === 2 ? 'word' : 'paragraph'
  return [byGrade, ...otherLevels.map(rung)].reduce((lo, l) => (ITEM_LEVELS.indexOf(l) < ITEM_LEVELS.indexOf(lo) ? l : lo))
}

export function nextItemLevel(outcomes: Outcome[], start: ItemLevel): ItemLevel | null {
  if (!outcomes.length) return start
  if (outcomes.length >= MAX_ITEMS_PER_CHECKIN) return null
  const passed = new Set(outcomes.filter(itemPassed).map((o) => o.level))
  const failed = new Set(outcomes.filter((o) => !itemPassed(o)).map((o) => o.level))
  const last = outcomes[outcomes.length - 1]
  const idx = ITEM_LEVELS.indexOf(last.level)
  if (itemPassed(last)) {
    if (idx === ITEM_LEVELS.length - 1) return null
    const up = ITEM_LEVELS[idx + 1]
    return failed.has(up) ? null : up
  }
  if (idx === 0) return null
  const down = ITEM_LEVELS[idx - 1]
  return passed.has(down) ? null : down
}
