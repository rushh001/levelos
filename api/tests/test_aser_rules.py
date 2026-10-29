import pytest

from app.levels.aser_rules import (
    ItemOutcome,
    Thresholds,
    cohort_for_level,
    effective_level,
    item_passed,
    level_from_outcomes,
    next_item_level,
    skipped_outcome,
    start_level,
    update_levels,
)


def letters(correct: int, total: int = 5) -> ItemOutcome:
    return ItemOutcome("letter", total, correct, total - correct)


def words(correct: int, total: int = 5) -> ItemOutcome:
    return ItemOutcome("word", total, correct, total - correct)


def para(errors: int, hesitations: int | None = 0, wcpm: float | None = 40.0, level: str = "paragraph") -> ItemOutcome:
    return ItemOutcome(level, 20, 20 - errors, errors, hesitations, wcpm)


# ---- item pass/fail: the ASER criteria


def test_letters_4_of_5_pass_3_of_5_fail():
    assert item_passed(letters(4))
    assert item_passed(letters(5))
    assert not item_passed(letters(3))


def test_words_4_of_5():
    assert item_passed(words(4))
    assert not item_passed(words(3))


def test_a_skipped_card_counts_for_nothing():
    s = skipped_outcome
    assert not item_passed(s("word"))
    # after a skip: the nearest card not tried yet, an easier one first; never back to a skipped card
    assert next_item_level([s("paragraph")], "paragraph") == "word"
    assert next_item_level([s("letter")], "letter") == "word"  # nothing easier than letters
    assert next_item_level([s("letter"), s("word")], "letter") == "paragraph"
    assert next_item_level([s("paragraph"), s("word"), s("letter"), s("story")], "paragraph") is None
    # after a card read: up on a pass, down on a fail, but not to a skipped card
    assert next_item_level([s("paragraph"), words(2)], "paragraph") == "letter"
    assert next_item_level([s("word"), letters(5)], "word") is None
    # the level comes only from the cards read; none read, no level
    assert level_from_outcomes([s("letter"), s("word")]) is None
    assert level_from_outcomes([s("letter"), words(5)]) == "word"
    assert level_from_outcomes([s("paragraph"), words(2), letters(5)]) == "letter"
    assert level_from_outcomes([s("word"), letters(2)]) == "beginner"
    # skips do not use up the four cards a child may be asked to read
    assert next_item_level([s("story"), words(5), letters(5), s("paragraph")], "story") is None


def test_paragraph_three_mistakes_pass_four_fail():
    assert item_passed(para(3))
    assert not item_passed(para(4))


def test_paragraph_slow_but_accurate_passes():
    # "fluently even if slowly" — a slow reader above the (low) floor still passes
    assert item_passed(para(0, hesitations=1, wcpm=16.0))


def test_paragraph_halting_fails():
    assert not item_passed(para(0, hesitations=3, wcpm=40.0))
    assert not item_passed(para(0, hesitations=0, wcpm=10.0))


def test_paragraph_without_timing_uses_errors_only():
    assert item_passed(para(2, hesitations=None, wcpm=None))
    assert not item_passed(para(5, hesitations=None, wcpm=None))


def test_teacher_judgement_overrides():
    assert item_passed(ItemOutcome("paragraph", 20, 10, 10, teacher_passed=True))
    assert not item_passed(ItemOutcome("letter", 5, 5, 0, teacher_passed=False))


def test_custom_thresholds():
    strict = Thresholds(passage_max_errors=1)
    assert not item_passed(para(2), strict)


# ---- level from outcomes


def test_level_is_highest_passed():
    assert level_from_outcomes([letters(5), words(4), para(2)]) == "paragraph"
    assert level_from_outcomes([words(4), para(5)]) == "word"
    assert level_from_outcomes([para(2), para(1, level="story")]) == "story"


def test_beginner_when_nothing_passed():
    assert level_from_outcomes([letters(2)]) == "beginner"
    assert level_from_outcomes([]) is None


# ---- adaptive ladder


def test_start_level_by_history_else_letters():
    assert start_level(1, None) == "letter"
    assert start_level(2, None) == "letter"  # not checked yet: letters, whatever the grade
    assert start_level(3, None) == "letter"
    assert start_level(3, "beginner") == "letter"
    assert start_level(1, "word") == "word"  # re-tested at the last level's rung
    assert start_level(3, None, None, ["word"]) == "letter"


def test_group_chosen_by_teacher_reads_only_that_card():
    assert start_level(3, None, "letter") == "letter"
    assert start_level(1, None, "paragraph") == "paragraph"
    assert start_level(2, "story", "word") == "word"  # the teacher's group wins over the last level
    assert start_level(2, "paragraph", None, ["letter"]) == "paragraph"  # this test's own level otherwise
    # with the group chosen, the check gives that level's card and ends, pass or fail
    assert next_item_level([], "word", fixed=True) == "word"
    assert next_item_level([words(5)], "word", fixed=True) is None
    assert next_item_level([words(1)], "word", fixed=True) is None
    assert next_item_level([skipped_outcome("word")], "word", fixed=True) is None
    # a group chosen while a check was under way: the group's card comes next, then the check ends
    assert next_item_level([letters(5)], "word", fixed=True) == "word"
    assert next_item_level([letters(5), words(5)], "word", fixed=True) is None


def test_ladder_moves_up_then_brackets():
    assert next_item_level([], "word") == "word"
    hist = [words(5)]
    assert next_item_level(hist, "word") == "paragraph"
    hist.append(para(6))
    assert next_item_level(hist, "word") is None  # word passed, paragraph failed → bracketed


def test_ladder_moves_down_then_brackets():
    hist = [para(6)]
    assert next_item_level(hist, "paragraph") == "word"
    hist.append(words(2))
    assert next_item_level(hist, "paragraph") == "letter"
    hist.append(letters(5))
    assert next_item_level(hist, "paragraph") is None  # letter passed, word failed


def test_ladder_caps_items():
    hist = [letters(5), words(5), para(0), para(0, level="story")]
    assert next_item_level(hist, "letter") is None
    assert level_from_outcomes(hist) == "story"


def test_ladder_stops_at_ends():
    assert next_item_level([letters(1)], "letter") is None
    assert next_item_level([para(0, level="story")], "story") is None


# ---- two-check confirmation guardrail


def test_first_checkin_is_provisional_only():
    assert update_levels(None, None, "word") == ("word", None)


def test_second_agreeing_checkin_confirms():
    prov, conf = update_levels("word", None, "word")
    assert (prov, conf) == ("word", "word")


def test_single_disagreeing_checkin_does_not_move_confirmed():
    prov, conf = update_levels("word", "word", "paragraph")
    assert (prov, conf) == ("paragraph", "word")
    prov, conf = update_levels(prov, conf, "paragraph")
    assert (prov, conf) == ("paragraph", "paragraph")


def test_noisy_jump_is_ignored():
    # word, word → (confirmed word); one bad day at letter; back to word: confirmed never moved
    prov, conf = update_levels("word", "word", "letter")
    assert conf == "word"
    prov, conf = update_levels(prov, conf, "word")
    assert conf == "word"


def test_update_levels_rejects_unknown():
    with pytest.raises(ValueError):
        update_levels(None, None, "fluent")


# ---- cohorts


def test_cohorts():
    assert cohort_for_level("beginner") == "letter"
    assert cohort_for_level("letter") == "letter"
    assert cohort_for_level("word") == "word"
    assert cohort_for_level("paragraph") == "paragraph"
    assert cohort_for_level("story") == "story"  # story readers have their own group
    assert cohort_for_level(None) is None


def test_effective_level_prefers_confirmed():
    assert effective_level("paragraph", "word") == ("word", True)
    assert effective_level("paragraph", None) == ("paragraph", False)
    assert effective_level(None, None) == (None, False)
