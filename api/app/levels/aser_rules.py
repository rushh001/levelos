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

No LLM is involved anywhere in this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil

LEVELS = ["beginner", "letter", "word", "paragraph", "story"]
LEVEL_ORDER = {name: i for i, name in enumerate(LEVELS)}
ITEM_LEVELS = ["letter", "word", "paragraph", "story"]  # what a child can be asked to read
COHORTS = ["letter", "word", "paragraph"]  # dashboard groups

MAX_ITEMS_PER_CHECKIN = 4


@dataclass(frozen=True)
class Thresholds:
    """Tunable approximations of ASER's qualitative criteria. Defaults are deliberately lenient on speed
    ('fluently even if slowly') and strict on halting."""

    # Letter and word items: fraction of items that must be correct (ASER: 4 of 5).
    discrete_pass_fraction: float = 0.8
    # Paragraph and story: maximum mistakes (substitutions + omissions). ASER: 3.
    passage_max_errors: int = 3
    # Pauses longer than this between words count as hesitations (EGRA uses 3 s).
    hesitation_ms: int = 3000
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


def item_passed(o: ItemOutcome, t: Thresholds = DEFAULT_THRESHOLDS) -> bool:
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
    floor = t.passage_min_wcpm.get(o.item_level)
    if o.wcpm is not None and floor is not None and o.wcpm < floor:
        return False
    return True


def level_from_outcomes(outcomes: list[ItemOutcome], t: Thresholds = DEFAULT_THRESHOLDS) -> str | None:
    """Highest item level passed; 'beginner' if something was attempted and nothing passed; None if nothing attempted."""
    if not outcomes:
        return None
    passed = [LEVEL_ORDER[o.item_level] for o in outcomes if item_passed(o, t)]
    if not passed:
        return "beginner"
    return LEVELS[max(passed)]


def start_level(grade: int | None, last_confirmed: str | None) -> str:
    """Where the adaptive ladder begins. A known level is re-tested at that level (pass -> go up)."""
    if last_confirmed in ("word", "paragraph", "story"):
        return last_confirmed
    if last_confirmed in ("beginner", "letter"):
        return "letter"
    if grade is None or grade <= 1:
        return "letter"
    if grade == 2:
        return "word"
    return "paragraph"


def next_item_level(
    outcomes: list[ItemOutcome], start: str, t: Thresholds = DEFAULT_THRESHOLDS
) -> str | None:
    """Next item to show, or None when the level is bracketed or the item cap is reached.

    Pass -> one level up (unless already at story, or that level was already failed).
    Fail -> one level down (unless already at letter, or that level was already passed).
    """
    if not outcomes:
        return start
    if len(outcomes) >= MAX_ITEMS_PER_CHECKIN:
        return None

    passed_levels = {o.item_level for o in outcomes if item_passed(o, t)}
    failed_levels = {o.item_level for o in outcomes if not item_passed(o, t)}
    last = outcomes[-1]
    idx = ITEM_LEVELS.index(last.item_level)

    if item_passed(last, t):
        if idx == len(ITEM_LEVELS) - 1:
            return None
        candidate = ITEM_LEVELS[idx + 1]
        return None if candidate in failed_levels else candidate

    if idx == 0:
        return None
    candidate = ITEM_LEVELS[idx - 1]
    return None if candidate in passed_levels else candidate


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
    """Dashboard grouping. Beginner+Letter share a group (as in TaRL); Paragraph+Story share a group."""
    if level is None:
        return None
    if level in ("beginner", "letter"):
        return "letter"
    if level == "word":
        return "word"
    return "paragraph"


def effective_level(provisional: str | None, confirmed: str | None) -> tuple[str | None, bool]:
    """Level to group by and whether it is confirmed. New children are grouped by their provisional level
    (flagged) so a class is usable after one round of check-ins."""
    if confirmed is not None:
        return confirmed, True
    return provisional, False
