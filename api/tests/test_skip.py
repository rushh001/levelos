"""The teacher skips a card instead of making the child read it. A skipped card counts for nothing: the level comes
only from the cards the child read, and the ladder moves on to a card not tried yet, never back to a skipped one."""

from app.content import pick_item
from app.llm.evidence import build_input
from app.models import Checkin
from tests.test_api import client, login, make_student, script, start_at, upload  # noqa: F401  (fixtures)


def start(client, h, student_id):
    return client.post("/api/checkins", json={"student_id": student_id}, headers=h).json()


def skip(client, h, c, reason=None):
    body = {"item_id": c["next_item"]["id"]} | ({"reason": reason} if reason else {})
    r = client.post(f"/api/checkins/{c['id']}/skip", json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def finish(client, h, c):
    r = client.post(f"/api/checkins/{c['id']}/finish", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_skipped_card_counts_for_nothing_and_the_level_comes_from_the_cards_read(client, script, db):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    c = start_at(client, h, st["id"], "paragraph")
    assert c["next_item"]["level"] == "paragraph"
    r = skip(client, h, c)
    assert r["status"] == "skipped"
    assert r["item_result"]["source"] == "skipped" and r["item_result"]["passed"] is None  # neither pass nor fail
    c = r["checkin"]
    assert c["next_item"]["level"] == "word"  # the nearest card not tried, an easier one first
    script.update({"word": {"wrong": 3}, "letter": {"wrong": 0}})
    c = upload(client, h, c)["checkin"]  # words read and failed
    assert c["next_item"]["level"] == "letter"
    c = upload(client, h, c)["checkin"]  # letters read and passed
    assert c["next_item"] is None
    done = finish(client, h, c)
    assert done["status"] == "scored" and done["level_final"] == "letter"
    assert [i["source"] for i in done["items"]] == ["skipped", "ai", "ai"]
    # The diagnosis sees only the cards read, and is told which were skipped.
    db.expire_all()
    inp = build_input(db.get(Checkin, done["id"]))
    assert [i["level"] for i in inp["items"]] == ["word", "letter"]
    assert inp["skipped"] == ["paragraph"]
    assert done["diagnosis"] and all(e["item_id"] != done["items"][0]["item_id"] for e in done["diagnosis"]["evidence"])


def test_skipping_letters_and_words_gives_no_level_and_never_goes_back(client, script):
    # Letters skipped, words skipped: nothing was read, so there is no level (the app used to say "Letter").
    h = login(client)
    _, st = make_student(client, h, grade=1)  # starts at letters
    c = start(client, h, st["id"])
    assert c["next_item"]["level"] == "letter"
    c = skip(client, h, c)["checkin"]
    assert c["next_item"]["level"] == "word"  # nothing easier than letters: the next card up
    c = skip(client, h, c)["checkin"]
    assert c["next_item"]["level"] == "paragraph"  # not back to the skipped letters
    c = skip(client, h, c)["checkin"]
    c = skip(client, h, c)["checkin"]  # story skipped too
    assert c["next_item"] is None
    assert client.post(f"/api/checkins/{c['id']}/finish", headers=h).status_code == 409  # no card read: no level
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert s["level"] is None


def test_letters_skipped_then_words_read_gives_the_word_level(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=1)
    c = start(client, h, st["id"])
    c = skip(client, h, c)["checkin"]  # letters skipped
    script.update({"word": {"wrong": 0}, "paragraph": {"wrong": 6}})
    c = upload(client, h, c)["checkin"]  # words read and passed
    assert c["next_item"]["level"] == "paragraph"
    c = upload(client, h, c)["checkin"]  # paragraph read and failed; words already passed, letters skipped
    assert c["next_item"] is None
    done = finish(client, h, c)
    assert done["level_final"] == "word"


def test_skip_validation(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    c = start_at(client, h, st["id"], "paragraph")
    other = pick_item("hi", "letter", set()).id  # not the card the ladder expects
    assert client.post(f"/api/checkins/{c['id']}/skip", json={"item_id": other}, headers=h).status_code == 409
    c = skip(client, h, c, "too_hard")["checkin"]  # an older app still sends a reason: it is ignored
    assert c["next_item"]["level"] == "word"
    ir = skip(client, h, c)["item_result"]  # the word card, skipped too
    # a skipped word card has no meaning step and no words to review
    meaning = client.post(f"/api/checkins/{c['id']}/items/{ir['id']}/meaning",
                          json={"answers": [{"word": "x", "correct": True}]}, headers=h)
    assert meaning.status_code == 409
    review = client.post(f"/api/checkins/{c['id']}/review",
                         json={"marks": [{"item_result_id": ir["id"], "i": 0, "correct": True}]}, headers=h)
    assert review.status_code == 422
