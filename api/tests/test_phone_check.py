"""Checks that run on the phone: the AI marks a card while the teacher waits, the teacher confirms it, and the check
syncs later with the AI's signed result, so a recording is never scored twice. Also the class's offline pack and
the reading time / pauses the phone measures."""

import json

from app.content import get_item
from app.models import Checkin
from app.speech.align import tokenize
from tests.test_api import client, fake_score, login, make_student, script  # noqa: F401  (fixtures)
from tests.wavgen import make_wav

WAV = make_wav([(0.3, 0.0), (2.0, 0.5), (0.3, 0.0)])


def score_card(client, h, item_id):
    r = client.post("/api/checkins/score", data={"item_id": item_id},
                    files={"audio": ("clip.wav", WAV, "audio/wav")}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def start_on_phone(client, h, student_id, local_id="phone-ai-1", level="word"):
    return client.post("/api/checkins", json={"student_id": student_id, "local_id": local_id, "start_level": level},
                       headers=h).json()


def test_scoring_a_card_stores_nothing_and_signs_the_result(client, script, db):
    h = login(client)
    _, st = make_student(client, h)
    script["word"] = {"wrong": 1, "uncertain": (4,)}
    r = score_card(client, h, "hi-word-b")
    assert r["status"] == "scored" and r["sig"] and r["score_json"]
    assert [w["label"] for w in r["words"]] == ["sub", "correct", "correct", "correct", "correct"]
    assert [w["uncertain"] for w in r["words"]] == [False, False, False, False, True]
    assert db.query(Checkin).count() == 0  # nothing stored until the check syncs
    assert client.post("/api/checkins/score", data={"item_id": "nope"},
                       files={"audio": ("clip.wav", WAV, "audio/wav")}, headers=h).status_code == 422


def test_a_recording_to_redo_is_not_signed(client, script):
    h = login(client)
    script["word"] = {"status": "rerecord", "reason": "silent"}
    r = score_card(client, h, "hi-word-b")
    assert (r["status"], r["reason"], r["sig"], r["score_json"]) == ("rerecord", "silent", None, None)


def test_confirmed_ai_marks_sync_without_scoring_again(client, script, monkeypatch):
    h = login(client)
    _, st = make_student(client, h)
    script["word"] = {"wrong": 1, "uncertain": (4,)}
    ai = score_card(client, h, "hi-word-b")
    # The teacher agrees with the AI on word 1 and settles the uncertain word 5 as wrong.
    marks = [False, True, True, True, False]
    c = start_on_phone(client, h, st["id"])
    r = client.post(f"/api/checkins/{c['id']}/marks", headers=h, json={
        "item_id": "hi-word-b", "marks": marks, "ai_score": ai["score_json"], "ai_sig": ai["sig"]})
    assert r.status_code == 200, r.text
    ir = r.json()["item_result"]
    assert ir["source"] == "ai" and ir["result"]["ai_scored"]
    words = ir["result"]["words"]
    assert [w["teacher_correct"] for w in words] == marks
    assert not any(w["uncertain"] for w in words)  # the teacher has settled every word
    assert ir["needs_review"] is False and ir["passed"] is False  # 3 of 5

    async def must_not_score(*a, **k):
        raise AssertionError("a card the AI already scored was scored again")

    monkeypatch.setattr("app.services.checkins.score_item", must_not_score)
    after = client.post(f"/api/checkins/{c['id']}/items/{ir['id']}/audio", headers=h,
                        files={"audio": ("clip.wav", WAV, "audio/wav")})
    assert after.status_code == 200, after.text
    assert after.json()["items"][0]["has_audio"]  # kept for the teacher to play
    assert after.json()["items"][0]["result"]["words"] == words


def test_a_made_up_or_borrowed_ai_result_is_refused(client, script):
    h = login(client)
    _, st = make_student(client, h)
    script["word"] = {"wrong": 3}
    ai = score_card(client, h, "hi-word-b")
    c = start_on_phone(client, h, st["id"])
    url = f"/api/checkins/{c['id']}/marks"
    forged = json.loads(ai["score_json"])
    for w in forged["words"]:
        w["label"] = "correct"
    bad = [
        {"ai_score": json.dumps(forged), "ai_sig": ai["sig"]},  # edited on the phone
        {"ai_score": ai["score_json"], "ai_sig": "0" * 64},  # signature made up
        {"ai_score": ai["score_json"]},  # signature missing
    ]
    for extra in bad:
        r = client.post(url, headers=h, json={"item_id": "hi-word-b", "marks": [True] * 5, **extra})
        assert r.status_code == 422, extra
    # Signed for another teacher: refused too.
    other = login(client, "ravi", "9999")
    theirs = client.post("/api/checkins/score", data={"item_id": "hi-word-b"},
                         files={"audio": ("clip.wav", WAV, "audio/wav")}, headers=other).json()
    r = client.post(url, headers=h, json={"item_id": "hi-word-b", "marks": [True] * 5,
                                          "ai_score": theirs["score_json"], "ai_sig": theirs["sig"]})
    assert r.status_code == 422
    # Signed for another card of the same level: refused.
    word_c = score_card(client, h, "hi-word-c")
    r = client.post(url, headers=h, json={"item_id": "hi-word-b", "marks": [True] * 5,
                                          "ai_score": word_c["score_json"], "ai_sig": word_c["sig"]})
    assert r.status_code == 422


def test_the_phones_timing_decides_a_card_the_ai_marked(client, script):
    """The phone decided pass/fail with its own reading time and pauses; the server must land on the same side."""
    h = login(client)
    _, st = make_student(client, h)
    c = start_on_phone(client, h, st["id"], local_id="phone-timing", level="paragraph")
    item_id = c["next_item"]["id"]
    total = len(tokenize(get_item(item_id).text, "hi"))
    script["paragraph"] = {"hesitations": 0}  # the AI heard no long pause
    ai = score_card(client, h, item_id)
    r = client.post(f"/api/checkins/{c['id']}/marks", headers=h, json={
        "item_id": item_id, "marks": [True] * total, "duration_ms": 20_000, "hesitations": 3,
        "ai_score": ai["score_json"], "ai_sig": ai["sig"]}).json()
    res = r["item_result"]["result"]
    assert (res["hesitations"], res["hesitation_source"], res["reading_ms"]) == (3, "phone", 20_000)
    assert r["item_result"]["passed"] is False  # halting, as the phone decided


def test_reading_time_and_pauses_measured_on_the_phone_count(client):
    h = login(client)
    _, st = make_student(client, h)
    c = start_on_phone(client, h, st["id"], local_id="phone-pauses", level="paragraph")
    item_id = c["next_item"]["id"]
    total = len(tokenize(get_item(item_id).text, "hi"))
    # Every word right and quick, but three long pauses: halting, so the paragraph is not passed.
    r = client.post(f"/api/checkins/{c['id']}/marks", headers=h, json={
        "item_id": item_id, "marks": [True] * total, "duration_ms": 20_000, "hesitations": 3}).json()
    res = r["item_result"]["result"]
    assert res["hesitations"] == 3 and res["hesitation_source"] == "phone"
    assert r["item_result"]["passed"] is False


def test_the_offline_pack_has_every_page_of_the_class(client, script):
    h = login(client)
    cls, st = make_student(client, h)
    second = client.post(f"/api/classes/{cls['id']}/students", json={"first_name": "Ravi"}, headers=h).json()
    pack = client.get(f"/api/classes/{cls['id']}/offline", headers=h)
    assert pack.status_code == 200, pack.text
    pack = pack.json()
    assert set(pack["dashboards"]) == {"hi", "en"} and pack["default_language"] == "hi"
    assert pack["dashboards"]["hi"] == client.get(f"/api/classes/{cls['id']}/dashboard?language=hi", headers=h).json()
    assert set(pack["students"]) == {st["id"], second["id"]}
    assert pack["students"][st["id"]] == client.get(f"/api/students/{st['id']}", headers=h).json()
    other = login(client, "ravi", "9999")
    assert client.get(f"/api/classes/{cls['id']}/offline", headers=other).status_code == 404
