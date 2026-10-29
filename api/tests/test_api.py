"""End-to-end API flow with a scripted fake scorer (no audio processing, no vendors)."""

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_pin
from app.content import get_item
from app.models import LevelHistory, Teacher
from app.speech.align import tokenize
from app.speech.scorer import ItemScore


def fake_score(item, wrong=0, uncertain=(), status="scored", reason=None, hesitations=0):
    ref = tokenize(item.text, item.lang)
    words = [{"i": i, "ref": r, "label": "sub" if i < wrong else "correct", "uncertain": i in uncertain,
              "heard": {}, "labels": {}, "pa": None, "start_ms": None, "end_ms": None, "teacher_correct": None}
             for i, r in enumerate(ref)]
    s = ItemScore(item.id, item.level, item.lang, status, reason, duration_ms=5000, reading_ms=30_000,
                  words=words, hesitations=hesitations)
    return s.evaluate() if status == "scored" else s


@pytest.fixture
def script(monkeypatch):
    """level -> fake_score kwargs for the next upload at that level."""
    plan: dict[str, dict] = {}

    async def fake(data, item, *, suffix, allow_gemini):
        assert allow_gemini is False  # real children never go to Gemini's free tier
        return fake_score(item, **plan.get(item.level, {}))

    monkeypatch.setattr("app.services.checkins.score_item", fake)
    return plan


@pytest.fixture
def client(db):
    from app.main import app

    db.add(Teacher(login="asha", name="Asha", pin_hash=hash_pin("1234")))
    db.add(Teacher(login="ravi", name="Ravi", pin_hash=hash_pin("9999")))
    db.commit()
    with TestClient(app) as c:
        yield c


def login(client, who="asha", pin="1234"):
    r = client.post("/api/auth/login", json={"login": who, "pin": pin})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def make_student(client, h, grade=2, lang="hi"):
    cls = client.post("/api/classes", json={"name": "कक्षा 2", "grade": grade, "language": lang}, headers=h).json()
    st = client.post(f"/api/classes/{cls['id']}/students", json={"first_name": "Meena"}, headers=h).json()
    return cls, st


def upload(client, h, checkin, item_id=None):
    item_id = item_id or checkin["next_item"]["id"]
    r = client.post(f"/api/checkins/{checkin['id']}/items", data={"item_id": item_id},
                    files={"audio": ("clip.webm", b"fake", "audio/webm")}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def start_at(client, h, student_id, level):
    """A check that begins at `level` (as a phone's offline check may), for tests of the ladder above letters: a child
    not checked yet otherwise starts at letters."""
    return client.post("/api/checkins", json={"student_id": student_id, "local_id": f"start-{level}-{student_id}",
                                              "start_level": level}, headers=h).json()


def run_checkin(client, h, student_id, plan, script):
    script.clear()
    script.update(plan)
    c = client.post("/api/checkins", json={"student_id": student_id}, headers=h).json()
    while c["next_item"]:
        c = upload(client, h, c)["checkin"]
    return client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()


# ---- auth and ownership


def test_login_and_auth(client):
    assert client.post("/api/auth/login", json={"login": "asha", "pin": "0000"}).status_code == 401
    assert client.get("/api/me").status_code == 401
    h = login(client)
    assert client.get("/api/me", headers=h).json()["login"] == "asha"


def test_teachers_only_see_their_own_classes(client):
    h = login(client)
    cls, st = make_student(client, h)
    other = login(client, "ravi", "9999")
    assert client.get(f"/api/classes/{cls['id']}", headers=other).status_code == 404
    assert client.get(f"/api/students/{st['id']}", headers=other).status_code == 404
    assert client.post("/api/checkins", json={"student_id": st["id"]}, headers=other).status_code == 404


# ---- the adaptive ladder and the two-check guardrail


def test_ladder_brackets_the_level_and_two_checkins_confirm(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=2)  # not checked yet: starts at letters, whatever the grade

    first = run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    assert [i["item_level"] for i in first["items"]] == ["letter", "word", "paragraph"]
    assert first["status"] == "scored" and first["level_final"] == "word"
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert (s["provisional_level"], s["confirmed_level"], s["level_confirmed"]) == ("word", None, False)

    second = run_checkin(client, h, st["id"], {"word": {"wrong": 1}, "paragraph": {"wrong": 5}}, script)
    assert second["items"][0]["item_level"] == "word"  # re-tested at the last level's rung
    assert second["items"][0]["item_id"] != first["items"][1]["item_id"]  # a different word card
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert (s["provisional_level"], s["confirmed_level"]) == ("word", "word")
    assert s["cohort"] == "word"


def test_check_starts_at_the_group_the_teacher_set(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    first = lambda: client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()  # noqa: E731
    for group, level in (("letter", "letter"), ("word", "word"), ("paragraph", "paragraph")):
        client.patch(f"/api/students/{st['id']}", json={"cohort_override": group}, headers=h)
        c = first()
        assert c["start_level"] == level and c["next_item"]["level"] == level and c["fixed_level"], group
        client.post(f"/api/checkins/{c['id']}/abandon", headers=h)
    client.patch(f"/api/students/{st['id']}", json={"clear_cohort_override": True}, headers=h)
    c = first()  # "group by level" again: not checked yet, so letters (not the grade-3 paragraph)
    assert c["next_item"]["level"] == "letter" and not c["fixed_level"]


def test_a_group_chosen_by_hand_reads_only_its_own_card(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "letter"}, headers=h)
    failed = run_checkin(client, h, st["id"], {"letter": {"wrong": 3}}, script)
    assert [i["item_level"] for i in failed["items"]] == ["letter"] and failed["level_final"] == "beginner"
    passed = run_checkin(client, h, st["id"], {"letter": {"wrong": 0}, "word": {"wrong": 0}}, script)
    assert [i["item_level"] for i in passed["items"]] == ["letter"]  # no word card after the pass
    assert passed["level_final"] == "letter"
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "word"}, headers=h)
    words = run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 0}}, script)
    assert [i["item_level"] for i in words["items"]] == ["word"] and words["level_final"] == "word"


def test_an_unfinished_check_with_nothing_read_follows_the_current_group(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    assert c["next_item"]["level"] == "letter"  # not checked yet: letters, whatever the grade
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "word"}, headers=h)
    again = client.get(f"/api/checkins/{c['id']}", headers=h).json()  # "Not finished": opened again
    assert again["start_level"] == "word" and again["fixed_level"] and again["next_item"]["level"] == "word"
    again = upload(client, h, again)["checkin"]
    assert again["next_item"] is None  # only the group's card


def test_rerecord_keeps_the_same_item(client, script):
    h = login(client)
    _, st = make_student(client, h)
    script["letter"] = {"status": "rerecord", "reason": "silent"}
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    r = upload(client, h, c)
    assert (r["status"], r["reason"], r["item_result"]) == ("rerecord", "silent", None)
    assert r["checkin"]["next_item"]["id"] == c["next_item"]["id"]


def test_uploading_the_wrong_level_is_rejected(client, script):
    h = login(client)
    _, st = make_student(client, h)
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    r = client.post(f"/api/checkins/{c['id']}/items", data={"item_id": "hi-story-a"},
                    files={"audio": ("clip.webm", b"x", "audio/webm")}, headers=h)
    assert r.status_code == 409


def test_local_id_makes_start_idempotent(client):
    h = login(client)
    _, st = make_student(client, h)
    a = client.post("/api/checkins", json={"student_id": st["id"], "local_id": "phone-1"}, headers=h).json()
    b = client.post("/api/checkins", json={"student_id": st["id"], "local_id": "phone-1"}, headers=h).json()
    assert a["id"] == b["id"]


# ---- teacher review of uncertain words, overrides


FLIPPABLE = {"wrong": 3, "uncertain": (5,)}  # 3 errors + 1 uncertain word: pass or fail hangs on that word


def test_uncertain_item_pauses_the_ladder_until_confirmed(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    script.update({"paragraph": FLIPPABLE, "word": {"wrong": 0}})
    c = start_at(client, h, st["id"], "paragraph")
    c = upload(client, h, c)["checkin"]
    assert c["awaiting_review"] and c["next_item"] is None
    r = client.post(f"/api/checkins/{c['id']}/items", data={"item_id": "hi-word-a"},
                    files={"audio": ("clip.webm", b"x", "audio/webm")}, headers=h)
    assert r.status_code == 409

    para = c["items"][0]
    c = client.post(f"/api/checkins/{c['id']}/review", headers=h,
                    json={"marks": [{"item_result_id": para["id"], "i": 5, "correct": False}]}).json()
    assert not c["awaiting_review"] and c["next_item"]["level"] == "word"  # paragraph failed -> go down
    c = upload(client, h, c)["checkin"]
    assert c["next_item"] is None
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert (done["status"], done["level_final"]) == ("scored", "word")


def test_finishing_before_review_then_correction_reopens_the_ladder(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    script.update({"paragraph": FLIPPABLE, "word": {"wrong": 0}})
    c = start_at(client, h, st["id"], "paragraph")
    c = upload(client, h, c)["checkin"]
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert done["status"] == "needs_review" and done["level_final"] is None
    assert client.get(f"/api/students/{st['id']}", headers=h).json()["provisional_level"] is None

    # The word was wrong: the paragraph fails and nothing read places the child, so the ladder reopens at words.
    r = client.post(f"/api/checkins/{c['id']}/review", headers=h,
                    json={"marks": [{"item_result_id": c["items"][0]["id"], "i": 5, "correct": False}]}).json()
    assert r["status"] == "in_progress" and r["next_item"]["level"] == "word"
    assert client.post(f"/api/checkins/{c['id']}/finish", headers=h).status_code == 409
    r = upload(client, h, r)["checkin"]
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert (done["status"], done["level_final"]) == ("scored", "word")


def test_override_on_an_unfinished_checkin(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)
    script.update({"paragraph": {"wrong": 8}})
    c = start_at(client, h, st["id"], "paragraph")
    c = upload(client, h, c)["checkin"]  # child failed the paragraph and then left
    assert client.post(f"/api/checkins/{c['id']}/finish", headers=h).status_code == 409
    done = client.post(f"/api/checkins/{c['id']}/override", json={"level": "word"}, headers=h).json()
    assert (done["status"], done["level_final"], done["teacher_overrode"]) == ("scored", "word", True)


def test_override_wins_and_is_logged(client, script, db):
    h = login(client)
    _, st = make_student(client, h)
    done = run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    r = client.post(f"/api/checkins/{done['id']}/override", json={"level": "letter"}, headers=h).json()
    assert r["level_final"] == "letter" and r["teacher_overrode"]
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert (s["provisional_level"], s["confirmed_level"]) == ("letter", "letter")
    assert s["level_history"][-1]["source"] == "teacher"
    r = client.post(f"/api/checkins/{done['id']}/override", json={"level": None}, headers=h).json()
    assert r["level_final"] == "word" and not r["teacher_overrode"]
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert (s["provisional_level"], s["confirmed_level"]) == ("word", None)


def test_late_correction_replays_levels(client, script):
    h = login(client)
    _, st = make_student(client, h)
    one = run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    assert client.get(f"/api/students/{st['id']}", headers=h).json()["confirmed_level"] == "word"
    # Teacher corrects check-in one: two of the five words were actually wrong -> word failed there.
    word_ir = one["items"][1]  # after the letter card
    client.post(f"/api/checkins/{one['id']}/review", headers=h, json={"marks": [
        {"item_result_id": word_ir["id"], "i": 0, "correct": False},
        {"item_result_id": word_ir["id"], "i": 1, "correct": False}]})
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert (s["provisional_level"], s["confirmed_level"]) == ("word", None)


# ---- tap-to-mark


def test_tap_to_mark(client):
    h = login(client)
    _, st = make_student(client, h)
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    url = f"/api/checkins/{c['id']}/marks"
    item_id = c["next_item"]["id"]
    assert client.post(url, json={"item_id": item_id, "marks": [True] * 3}, headers=h).status_code == 422
    r = client.post(url, json={"item_id": item_id, "marks": [True, True, True, False, True]}, headers=h).json()
    assert r["item_result"]["passed"] and r["item_result"]["source"] == "offline_marks"
    assert r["checkin"]["next_item"]["level"] == "word"  # letters passed: up to words
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert done["source"] == "offline_marks" and done["level_final"] == "letter"


def test_offline_sync_marks_then_audio(client, monkeypatch):
    """The phone ran the ladder offline on tap-marks; on sync the recordings are AI-scored afterwards."""
    h = login(client)
    _, st = make_student(client, h)
    c = client.post("/api/checkins", json={"student_id": st["id"], "local_id": "phone-7", "start_level": "word"},
                    headers=h).json()
    r = client.post(f"/api/checkins/{c['id']}/marks", headers=h,
                    json={"item_id": "hi-word-b", "marks": [True, True, True, True, False]}).json()
    word_ir = r["item_result"]
    client.post(f"/api/checkins/{c['id']}/marks", headers=h, json={"item_id": "hi-para-a", "marks": [False] * 19})
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert done["level_final"] == "word"

    async def ai_heard_two_wrong(data, item, *, suffix, allow_gemini):
        s = fake_score(item, wrong=0)
        for i in (3, 4):  # agrees with the teacher on word 5; hears word 4 wrong where the teacher tapped it right
            s.words[i]["label"] = "sub"
        return s.evaluate()

    monkeypatch.setattr("app.services.checkins.score_item", ai_heard_two_wrong)
    after = client.post(f"/api/checkins/{c['id']}/items/{word_ir['id']}/audio", headers=h,
                        files={"audio": ("clip.webm", b"x", "audio/webm")}).json()
    words = after["items"][0]["result"]["words"]
    assert [w["uncertain"] for w in words] == [False, False, False, True, False]  # only the disagreement
    assert words[3]["teacher_mark"] is True and words[3]["label"] == "sub"
    # 3 certain + 1 open: 4/5 passes, 3/5 fails -> the teacher must confirm before the level counts.
    assert after["status"] == "needs_review"
    # The diagnosis now treats the item as heard (AI-scored), not as taps without audio.
    from app.llm.evidence import item_evidence
    assert item_evidence(after["items"][0]["result"], "offline_marks")["source"] == "ai"
    assert item_evidence(after["items"][1]["result"], "offline_marks")["source"] == "offline_marks"
    # A retried upload is a no-op.
    again = client.post(f"/api/checkins/{c['id']}/items/{word_ir['id']}/audio", headers=h,
                        files={"audio": ("clip.webm", b"x", "audio/webm")}).json()
    assert again["items"][0]["result"]["words"] == words


# ---- dashboard


def test_dashboard_groups_by_cohort(client, script):
    h = login(client)
    cls, st = make_student(client, h)
    other = client.post(f"/api/classes/{cls['id']}/students", json={"first_name": "Ravi"}, headers=h).json()
    run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    d = client.get(f"/api/classes/{cls['id']}/dashboard", headers=h).json()
    by = {c["cohort"]: [s["first_name"] for s in c["students"]] for c in d["cohorts"]}
    assert by == {"letter": [], "word": ["Meena"], "paragraph": [], "story": []}
    assert [s["first_name"] for s in d["not_assessed"]] == ["Ravi"]
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "letter"}, headers=h)
    d = client.get(f"/api/classes/{cls['id']}/dashboard", headers=h).json()
    assert [s["first_name"] for s in d["cohorts"][0]["students"]] == ["Meena"]
    assert other["level"] is None


def test_an_unfinished_check_with_only_skips_starts_over_in_the_chosen_group(client, script):
    # The teacher's case: a check begun under "group by level", letters and words skipped, the ladder at the
    # paragraph; then the Word group is chosen and "Not finished" is opened: it must show the word card.
    h = login(client)
    _, st = make_student(client, h, grade=2)
    c = client.post("/api/checkins", json={"student_id": st["id"], "language": "en"}, headers=h).json()
    for _ in range(2):
        c = client.post(f"/api/checkins/{c['id']}/skip", json={"item_id": c["next_item"]["id"]}, headers=h).json()["checkin"]
    assert c["next_item"]["level"] == "paragraph"
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "word", "language": "en"}, headers=h)
    again = client.get(f"/api/checkins/{c['id']}", headers=h).json()
    assert again["items"] == [] and again["fixed_level"] and again["next_item"]["level"] == "word"
    script.update({"word": {"wrong": 0}})
    again = upload(client, h, again)["checkin"]
    assert again["next_item"] is None
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert [i["item_level"] for i in done["items"]] == ["word"] and done["level_final"] == "word"


def test_a_group_chosen_during_a_check_gives_its_card_next(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=2)
    script.update({"letter": {"wrong": 0}, "word": {"wrong": 4}})
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    c = upload(client, h, c)["checkin"]  # letters read and passed under "group by level"
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "paragraph"}, headers=h)
    again = client.get(f"/api/checkins/{c['id']}", headers=h).json()
    assert again["fixed_level"] and again["next_item"]["level"] == "paragraph"  # the group's card, not words
    script.update({"paragraph": {"wrong": 0}})
    again = upload(client, h, again)["checkin"]
    assert again["next_item"] is None
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert [i["item_level"] for i in done["items"]] == ["letter", "paragraph"] and done["level_final"] == "paragraph"


def test_story_group(client, script):
    # Story readers have their own group; chosen by hand, the check gives only the story card.
    h = login(client)
    cls, st = make_student(client, h, grade=3)
    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "story"}, headers=h)
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    assert c["start_level"] == "story" and c["fixed_level"] and c["next_item"]["level"] == "story"
    script.update({"story": {"wrong": 0}})
    c = upload(client, h, c)["checkin"]
    assert c["next_item"] is None
    done = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert [i["item_level"] for i in done["items"]] == ["story"] and done["level_final"] == "story"
    d = client.get(f"/api/classes/{cls['id']}/dashboard", headers=h).json()
    assert [c["cohort"] for c in d["cohorts"]] == ["letter", "word", "paragraph", "story"]
    assert [s["first_name"] for s in d["cohorts"][3]["students"]] == ["Meena"]
    a = client.post(f"/api/classes/{cls['id']}/activities", json={"cohort": "story"}, headers=h).json()
    assert a["cohort"] == "story" and a["plan"]["text"] and not a["plan"].get("material")


def test_signup_gives_a_unique_six_digit_login_id(client):
    body = {"name": "  Asha   Verma ", "email": "Asha@School.in", "pin": "4321", "ui_lang": "hi"}
    r = client.post("/api/auth/signup", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    login_id = out["login"]
    assert len(login_id) == 6 and login_id.isdigit() and out["teacher"]["login"] == login_id
    assert (out["teacher"]["name"], out["teacher"]["email"], out["teacher"]["ui_lang"]) == ("Asha Verma", "asha@school.in", "hi")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {out['token']}"}).json()["login"] == login_id
    # log in with the ID (typed with a space, too) and the PIN
    assert client.post("/api/auth/login", json={"login": login_id[:3] + " " + login_id[3:], "pin": "4321"}).status_code == 200
    assert client.post("/api/auth/login", json={"login": login_id, "pin": "9999"}).status_code == 401
    # one account per email, whatever the case
    assert client.post("/api/auth/signup", json=body | {"email": "asha@SCHOOL.in"}).status_code == 409
    # a second teacher gets a different ID; an unknown interface language falls back to English
    other = client.post("/api/auth/signup", json={"name": "Ravi", "email": "ravi@school.in", "pin": "123456", "ui_lang": "xx"}).json()
    assert other["login"] != login_id and other["teacher"]["ui_lang"] == "en"
    # a new teacher starts with no classes
    assert client.get("/api/classes", headers={"Authorization": f"Bearer {other['token']}"}).json() == []


def test_signup_checks_its_fields(client):
    ok = {"name": "Meena", "email": "meena@school.in", "pin": "1234"}
    for bad in ({"email": "not-an-email"}, {"pin": "12ab"}, {"pin": "123"}, {"pin": "123456789"}, {"name": "   "}):
        assert client.post("/api/auth/signup", json=ok | bad).status_code == 422, bad
