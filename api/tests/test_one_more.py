"""One more card: once the ladder has found the level on a failed card, the teacher may give one more card at that
level (a nervous child, a bad moment). It replaces the failed card: a pass and the ladder goes on up, a fail and the
level stands. Once per level, never after a pass or a skip, and the server refuses it otherwise."""

from app.content import get_item
from app.levels.aser_rules import ItemOutcome, effective_outcomes, next_item_level, one_more_level, skipped_outcome
from app.speech.align import tokenize
from tests.test_api import client, login, make_student, script  # noqa: F401  (fixtures)


def card(level: str, correct: int, total: int = 5, retry: bool = False) -> ItemOutcome:
    return ItemOutcome(level, total, correct, total - correct, retry=retry)


def test_one_more_is_offered_only_after_a_fail_that_ended_the_ladder():
    letters_pass, words_fail = card("letter", 5), card("word", 2)
    assert next_item_level([letters_pass, words_fail], "letter") is None
    assert one_more_level([letters_pass, words_fail], "letter") == "word"
    assert one_more_level([letters_pass], "letter") is None  # the ladder goes on by itself
    assert one_more_level([card("letter", 5), card("word", 5), card("paragraph", 20, 20), card("story", 40, 40)],
                          "letter") is None  # ended on a pass
    assert one_more_level([card("letter", 2)], "letter") == "letter"  # Beginner: one more letter card
    assert one_more_level([letters_pass, skipped_outcome("word")], "letter") is None  # ended on a skip


def test_the_card_given_again_replaces_the_failed_one():
    first = [card("letter", 5), card("word", 2)]
    passed = first + [card("word", 5, retry=True)]
    assert effective_outcomes(passed) == [first[0], passed[2]]
    assert next_item_level(passed, "letter") == "paragraph"  # passed this time: the ladder goes on up
    failed = first + [card("word", 1, retry=True)]
    assert next_item_level(failed, "letter") is None  # failed again: the level stands
    assert one_more_level(failed, "letter") is None  # once per level


def test_the_card_given_again_does_not_use_up_the_card_limit():
    read = [card("paragraph", 20, 20), card("story", 10, 40), card("story", 40, 40, retry=True)]
    assert next_item_level(read, "paragraph") is None  # story passed: top of the ladder


def _marks(item_id: str, correct: int) -> list[bool]:
    n = len(tokenize(get_item(item_id).text, get_item(item_id).lang))
    return [i < correct for i in range(n)]


def test_the_server_takes_one_more_card_only_when_the_ladder_allows_it(client, script):
    h = login(client)
    _, st = make_student(client, h)
    c = client.post("/api/checkins", json={"student_id": st["id"], "local_id": "one-more", "start_level": "letter"},
                    headers=h).json()
    url = f"/api/checkins/{c['id']}/marks"
    letter = c["next_item"]["id"]
    r = client.post(url, headers=h, json={"item_id": letter, "marks": _marks(letter, 5)}).json()
    # Too early: the ladder still has a card to give.
    word = r["checkin"]["next_item"]["id"]
    early = client.post(url, headers=h, json={"item_id": word, "marks": _marks(word, 5), "one_more": True})
    assert early.status_code == 409
    r = client.post(url, headers=h, json={"item_id": word, "marks": _marks(word, 2)}).json()
    assert r["checkin"]["next_item"] is None  # level found: letter
    other_word = next(i for i in ("hi-word-b", "hi-word-c", "hi-word-a") if i != word and get_item(i).level == "word")
    again = client.post(url, headers=h, json={"item_id": other_word, "marks": _marks(other_word, 5), "one_more": True})
    assert again.status_code == 200, again.text
    assert again.json()["item_result"]["result"]["retry"] is True
    assert again.json()["checkin"]["next_item"]["level"] == "paragraph"  # passed: the ladder goes on up
