"""ASER reading-level rules, as pure functions.

Source: ASER 2024 Assessment Tasks (ASER Centre), reading tool:
  - Letter level:    child reads at least 4 of 5 letters correctly.
  - Word level:      child reads at least 4 of 5 familiar words correctly.
  - Paragraph level: child reads the Std I paragraph "as sentences, fluently even if slowly" with 3 or fewer mistakes.
                     Reading it as a string of words, or haltingly, does not count.
  - Story level:     same criteria on the Std II story.
  - Beginner:        fewer than 4 of 5 letters.
  The level recorded is the highest the child reaches comfortably.

ASER administers the test starting at the paragraph and moving down. For a 3-minute classroom check we start
adaptively (by grade or last confirmed level) and move up on a pass / down on a fail until the level is bracketed,
but the pass/fail criteria above are applied unchanged. "Halting" is approximated with long pauses and a low WCPM floor;
both thresholds are explicit and tunable (see Thresholds). Self-corrections count as correct (EGRA convention).

The teacher may also skip a card instead of making the child read it. A skipped card counts for nothing: it is
neither a pass nor a fail, the level is worked out only from the cards the child actually read (no card read, no
level), and it carries no words and no evidence. After a skip the ladder moves to the nearest card not tried yet
(an easier one first); it never comes back to a skipped card.

No LLM is involved anywhere in this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil

LEVELS = ["beginner", "letter", "word", "paragraph", "story"]
LEVEL_ORDER = {name: i for i, name in enumerate(LEVELS)}
ITEM_LEVELS = ["letter", "word", "paragraph", "story"]  # what a child can be asked to read
COHORTS = ["letter", "word", "paragraph", "story"]  # dashboard groups

MAX_ITEMS_PER_CHECKIN = 4


@dataclass(frozen=True)
class Thresholds:
    """Tunable approximations of ASER's qualitative criteria. Defaults are deliberately lenient on speed
    ('fluently even if slowly') and strict on halting."""

    # Letter and word items: fraction of items that must be correct (ASER: 4 of 5).
    discrete_pass_fraction: float = 0.8
    # Paragraph and story: maximum mistakes (substitutions + omissions). ASER: 3.
    passage_max_errors: int = 3
    # Pauses longer than this between words count as hesitations (EGRA uses 3 s). Used when we cannot tell where
    # in the text a pause fell (silence detected in the audio only).
    hesitation_ms: int = 3000
    # When word timings place each pause, only pauses INSIDE a sentence count: ASER's criterion is reading "as
    # sentences", and a long mid-sentence pause is word-by-word reading, while a pause between sentences is not.
    # Calibrated on a real recording: three deliberate mid-sentence pauses measured 3.3 s, 2.9 s and 3.4 s.
    mid_sentence_pause_ms: int = 2500
    # More hesitations than this = "halting" reading.
    passage_max_hesitations: int = 2
    # Below this WCPM we treat the reading as a string of words rather than sentences. Very low on purpose:
    # NIPUN's Grade 2 target is 45-60 wpm, but ASER passes a slow accurate reader.
    passage_min_wcpm: dict[str, float] = field(default_factory=lambda: {"paragraph": 15.0, "story": 20.0})


DEFAULT_THRESHOLDS = Thresholds()


@dataclass(frozen=True)
class ItemOutcome:
    """What the scorer produced for one item the child read."""

    item_level: str  # letter | word | paragraph | story
    total: int  # letters/words in the item
    correct: int  # read correctly, including self-corrections
    errors: int  # substitutions + omissions
    hesitations: int | None = None  # pauses > hesitation_ms; None if no timing available
    wcpm: float | None = None  # words correct per minute; None if no duration available
    # Teacher's judgement overrides the automatic one when present.
    teacher_passed: bool | None = None
    # The text's language's own speed floor, when its words are longer than Hindi's (Tamil: 4 aksharas a word
    # against Hindi's 2), so the floor means the same reading pace in every language. None: the default floor.
    wcpm_floor: float | None = None
    # The card was not read: the teacher skipped it. It counts for nothing (neither a pass nor a fail).
    skipped: str | None = None


def skipped_outcome(item_level: str) -> ItemOutcome:
    """A card the teacher skipped: nothing read, and it counts for nothing in the level."""
    return ItemOutcome(item_level, 0, 0, 0, skipped="skipped")


def read_outcomes(outcomes: list[ItemOutcome]) -> list[ItemOutcome]:
    """The cards the child actually read (skipped cards left out)."""
    return [o for o in outcomes if o.skipped is None]


def item_passed(o: ItemOutcome, t: Thresholds = DEFAULT_THRESHOLDS) -> bool:
    if o.skipped is not None:
        return False  # the ladder and the level leave skipped cards out; a skip is never a pass
    if o.teacher_passed is not None:
        return o.teacher_passed
    if o.item_level not in ITEM_LEVELS:
        raise ValueError(f"unknown item level {o.item_level!r}")

    if o.item_level in ("letter", "word"):
        needed = ceil(t.discrete_pass_fraction * o.total)
        return o.correct >= needed

    # paragraph / story
    if o.errors > t.passage_max_errors:
        return False
    if o.hesitations is not None and o.hesitations > t.passage_max_hesitations:
        return False
    floor = o.wcpm_floor if o.wcpm_floor is not None else t.passage_min_wcpm.get(o.item_level)
    if o.wcpm is not None and floor is not None and o.wcpm < floor:
        return False
    return True


def level_from_outcomes(outcomes: list[ItemOutcome], t: Thresholds = DEFAULT_THRESHOLDS) -> str | None:
    """Highest item level passed among the cards read; 'beginner' if cards were read and none passed; None if no
    card was read (skipped cards do not count)."""
    read = read_outcomes(outcomes)
    if not read:
        return None
    passed = [LEVEL_ORDER[o.item_level] for o in read if item_passed(o, t)]
    if not passed:
        return "beginner"
    return LEVELS[max(passed)]


GROUP_START = {"letter": "letter", "word": "word", "paragraph": "paragraph", "story": "story"}


def _rung(level: str) -> str:
    """The card a known level is re-tested with: Beginner and Letter at letters, the others at their own rung."""
    return "letter" if level in ("beginner", "letter") else level


def start_level(grade: int | None, last_level: str | None, group: str | None = None,
                other_levels: list[str] | None = None) -> str:
    """Where the check begins. A group the teacher chose by hand wins: the check reads only that group's card (see
    next_item_level, `fixed`). Otherwise the child's last level in this test, confirmed or not, is re-tested at its
    own rung, and a child not checked yet in this test starts at letters, whatever the grade. (`grade` and
    `other_levels` are kept for callers; they no longer move the start.)"""
    if group in GROUP_START:
        return GROUP_START[group]
    if last_level in LEVELS:
        return _rung(last_level)
    return "letter"


def next_item_level(
    outcomes: list[ItemOutcome], start: str, t: Thresholds = DEFAULT_THRESHOLDS, fixed: bool = False
) -> str | None:
    """Next item to show, or None when the level is bracketed or the item cap is reached.

    `fixed`: the teacher chose the child's group, so the check reads only that level's card (`start`) and ends
    after it: no other level is tested.

    Pass -> one level up; fail -> one level down. Skip -> the nearest card not tried yet, an easier one first.
    The ladder never goes to a card already tried (read or skipped), nor past one the child read: not above a
    failed card, not below a passed one. Only cards the child read count towards the item cap.
    """
    if not outcomes:
        return start
    if fixed:  # only the group's card: offered until it has been tried (read or skipped)
        return None if any(o.item_level == start for o in outcomes) else start
    read = read_outcomes(outcomes)
    if len(read) >= MAX_ITEMS_PER_CHECKIN:
        return None

    tried = {o.item_level for o in outcomes}
    passed = [ITEM_LEVELS.index(o.item_level) for o in read if item_passed(o, t)]
    failed = [ITEM_LEVELS.index(o.item_level) for o in read if not item_passed(o, t)]
    lo, hi = max(passed, default=-1), min(failed, default=len(ITEM_LEVELS))
    open_ = [i for i in range(lo + 1, hi) if ITEM_LEVELS[i] not in tried]
    last = outcomes[-1]
    idx = ITEM_LEVELS.index(last.item_level)

    if last.skipped is not None:
        below, above = [i for i in open_ if i < idx], [i for i in open_ if i > idx]
        return ITEM_LEVELS[max(below)] if below else ITEM_LEVELS[min(above)] if above else None
    step = idx + 1 if item_passed(last, t) else idx - 1
    return ITEM_LEVELS[step] if step in open_ else None


def update_levels(
    prev_provisional: str | None, prev_confirmed: str | None, new_level: str
) -> tuple[str, str | None]:
    """Guardrail: a level change is confirmed only after two consecutive check-ins agree.

    Returns (provisional, confirmed). The provisional level always follows the latest check-in;
    the confirmed level moves only when the previous provisional level already said the same thing.
    """
    if new_level not in LEVEL_ORDER:
        raise ValueError(f"unknown level {new_level!r}")
    confirmed = prev_confirmed
    if new_level != prev_confirmed and prev_provisional == new_level:
        confirmed = new_level
    return new_level, confirmed


def cohort_for_level(level: str | None) -> str | None:
    """Dashboard grouping: Beginner and Letter share the Letter group (as in TaRL); Word, Paragraph and Story readers
    each have their own group."""
    if level is None:
        return None
    if level in ("beginner", "letter"):
        return "letter"
    return level


def effective_level(provisional: str | None, confirmed: str | None) -> tuple[str | None, bool]:
    """Level to group by and whether it is confirmed. New children are grouped by their provisional level
    (flagged) so a class is usable after one round of check-ins."""
    if confirmed is not None:
        return confirmed, True
    return provisional, False
