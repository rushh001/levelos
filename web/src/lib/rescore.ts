/**
 * A teacher's corrections to a check's result, worked out on the phone when there is no network, by the server's
 * own rules: ItemScore.evaluate (api/app/speech/scorer.py), _settle and replay_levels (api/app/services/checkins.py),
 * update_levels / effective_level / cohort_for_level (api/app/levels/aser_rules.py). The server works it all out
 * again when the corrections are sent; until then the result, the child's level and the class's groups show what it
 * will say.
 */
import { itemPassed, placedLevel, skippedOutcome, type Outcome } from './aser'
import { wcpmFloor } from './content'
import type { Checkin, Cohort, Dashboard, ItemScore, LangLevel, Level, StudentSummary, Word } from './types'

export type ReviewMark = { item_result_id: string; i: number; correct: boolean }

/** Read correctly: the teacher's tap if there is one, else what the speech services heard. */
export function wordCorrect(w: Word): boolean {
  if (w.teacher_correct !== null && w.teacher_correct !== undefined) return w.teacher_correct
  return w.label === 'correct' || w.label === 'self_correct'
}

function outcomeOf(s: ItemScore, correct: number): Outcome {
  const passage = s.level === 'paragraph' || s.level === 'story'
  const wcpm = passage && s.reading_ms ? Math.round((correct * 600_000) / s.reading_ms) / 10 : null
  return { level: s.level, total: s.words.length, correct, hesitations: s.hesitations ?? null, wcpm, wcpmFloor: wcpmFloor(s.lang, s.level) }
}

/** ItemScore.evaluate: the counts and the pass again, after the teacher's taps. */
function evaluate(s: ItemScore): ItemScore {
  const correct = s.words.filter(wordCorrect).length
  const open = s.words.filter((w) => w.uncertain && (w.teacher_correct === null || w.teacher_correct === undefined))
  const flipUp = open.filter((w) => !wordCorrect(w)).length
  const flipDown = open.filter((w) => wordCorrect(w)).length
  const likely = outcomeOf(s, correct)
  const best = itemPassed(outcomeOf(s, correct + flipUp))
  const worst = itemPassed(outcomeOf(s, correct - flipDown))
  return {
    ...s,
    wcpm: likely.wcpm,
    passed: itemPassed(likely),
    passed_best: best,
    passed_worst: worst,
    needs_review: best !== worst,
    counts: {
      total: s.words.length,
      correct,
      errors: s.words.length - correct,
      self_corrections: s.words.filter((w) => w.label === 'self_correct').length,
      uncertain: s.words.filter((w) => w.uncertain).length,
      uncertain_open: open.length,
    },
  }
}

const outcomes = (c: Checkin): Outcome[] =>
  c.items.map((r) =>
    r.source === 'skipped' ? skippedOutcome(r.item_level) : outcomeOf(r.result, r.result.words.filter(wordCorrect).length),
  )

/** _settle: what the check counts as now. A correction that fails a card the ladder had passed reopens it, as on the
 * server (the next card is read when the check is continued). */
function settle(c: Checkin): Checkin {
  const suggested = placedLevel(outcomes(c))
  let { status, level_final } = c
  if (c.teacher_overrode) status = 'scored'
  else if (c.items.some((r) => r.needs_review)) [status, level_final] = ['needs_review', null]
  else if (suggested === null) [status, level_final] = ['in_progress', null]
  else [status, level_final] = ['scored', suggested]
  return {
    ...c,
    level_suggested: suggested,
    status,
    level_final,
    scored_at: c.scored_at ?? new Date().toISOString(),
    awaiting_review: status === 'in_progress' && c.items.some((r) => r.needs_review),
    next_item: null,
  }
}

/** The teacher's word taps: (item, word index, read correctly?). */
export function applyReview(c: Checkin, marks: ReviewMark[]): Checkin {
  const items = c.items.map((r) => {
    const mine = marks.filter((m) => m.item_result_id === r.id && m.i >= 0 && m.i < r.result.words.length)
    if (!mine.length) return r
    const words = r.result.words.map((w) => ({ ...w }))
    for (const m of mine) words[m.i].teacher_correct = m.correct
    const result = evaluate({ ...r.result, words })
    return { ...r, result, passed: result.passed, needs_review: result.needs_review }
  })
  const next = { ...c, items }
  return c.status === 'scored' || c.status === 'needs_review' || c.teacher_overrode ? settle(next) : next
}

/** The teacher sets the level (null: back to the checked level). */
export function applyOverride(c: Checkin, level: Level | null): Checkin {
  return settle(level === null ? { ...c, teacher_overrode: false } : { ...c, teacher_overrode: true, level_final: level })
}

// ---------------------------------------------------------------- the child's level and group

const cohortFor = (level: Level | null): Cohort | null =>
  level === null ? null : level === 'beginner' || level === 'letter' ? 'letter' : (level as Cohort)

/** replay_levels: one language's provisional and confirmed level from the child's checks, oldest first. A level
 * is confirmed when two checks in a row agree; a level the teacher set counts as confirmed at once. */
function replay(checks: Checkin[], lang: string): [Level | null, Level | null] {
  let prov: Level | null = null
  let conf: Level | null = null
  const rows = checks.filter((c) => c.language === lang).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
  for (const c of rows) {
    if (c.status !== 'scored' || !c.level_final) continue
    if (c.teacher_overrode) prov = conf = c.level_final
    else {
      if (c.level_final !== conf && prov === c.level_final) conf = c.level_final
      prov = c.level_final
    }
  }
  return [prov, conf]
}

/** The child's row (on their page or a class page) again from their checks (newest first, as the server lists
 * them), after a correction to one in `lang`. */
export function restate<T extends StudentSummary>(x: T, checks: Checkin[], lang: string): T {
  const [prov, conf] = replay(checks, lang)
  const override = x.levels[lang]?.cohort_override ?? null
  const level = conf ?? prov
  const row: LangLevel = {
    provisional_level: prov,
    confirmed_level: conf,
    level,
    level_confirmed: conf !== null,
    cohort: override ?? cohortFor(level),
    cohort_override: override,
  }
  const finished = checks.filter((c) => c.language === x.language && (c.status === 'scored' || c.status === 'needs_review'))
  const review = checks.find((c) => c.status === 'needs_review')
  return {
    ...x,
    ...(x.language === lang ? row : {}),
    levels: { ...x.levels, [lang]: row },
    checkins: finished.length,
    last_checkin_at: finished[0]?.started_at ?? null,
    patterns: finished[0]?.diagnosis?.error_patterns ?? [],
    pending_review: !!review,
    review_checkin_id: review?.id ?? null,
  }
}

/** Puts the child's new row in a class page: in its group (in place if the group is the same), with the groups'
 * counts and the list of checks waiting for the teacher, as the server builds the page. */
export function place(d: Dashboard, me: StudentSummary): void {
  const now = me.cohort ? d.cohorts.find((c) => c.cohort === me.cohort) : undefined
  const lists = [...d.cohorts.map((c) => c.students), d.not_assessed]
  const target = now ? now.students : d.not_assessed
  for (const list of lists) {
    const k = list.findIndex((x) => x.id === me.id)
    if (k < 0) continue
    if (list === target) list[k] = me
    else list.splice(k, 1)
  }
  if (!target.some((x) => x.id === me.id)) target.push(me)
  for (const c of d.cohorts) {
    const tally: Record<string, number> = {}
    for (const s of c.students) for (const p of s.patterns.slice(0, 2)) tally[p] = (tally[p] ?? 0) + 1
    c.confirmed = c.students.filter((s) => s.level_confirmed).length
    c.pattern_counts = tally
    c.dominant_patterns = Object.keys(tally).sort((a, b) => tally[b] - tally[a]).slice(0, 3)
  }
  d.pending_review = d.pending_review.filter((id) => id !== me.id)
  if (me.pending_review) d.pending_review.push(me.id)
}
