"""Activity bank integrity, candidate ranking, and the generate -> validate -> fallback pipeline (fake model)."""

import asyncio

import pytest

from app.config import settings
from app.levels.aser_rules import COHORTS
from app.llm import activities as act
from app.llm.patterns import PATTERNS
from tests.test_api import client, login, make_student, run_checkin, script  # noqa: F401  (fixtures)

CTX = {"cohort": "word", "language": "hi", "grade": 2, "group_size": 6,
       "pattern_counts": {"matra_vowel_sign": 4, "sight_word": 1}, "misread_words": ["पानी", "केला", "नाव"]}


# ---- the bank


def test_bank_entries_are_complete_and_cited():
    b = act.bank()
    ids = [a["id"] for a in b["activities"]]
    assert len(ids) == len(set(ids)) >= 15
    for a in b["activities"]:
        assert a["source"]["ref"] in b["sources"], a["id"]
        assert a["source"]["note"], a["id"]
        assert set(a["cohorts"]) <= set(COHORTS) and a["cohorts"], a["id"]
        assert set(a["patterns"]) <= set(PATTERNS) and a["patterns"], a["id"]
        assert 8 <= sum(s["minutes"] for s in a["steps"]) <= 12, a["id"]
        for field in ("title", "watch_for"):
            assert a[field]["en"] and a[field]["hi"], (a["id"], field)
        assert all(s["en"] and s["hi"] for s in a["steps"]), a["id"]
        assert a["materials"]["en"] and a["materials"]["hi"], a["id"]


def test_every_cohort_and_pattern_has_activities():
    for c in COHORTS:
        assert len([a for a in act.bank()["activities"] if c in a["cohorts"]]) >= 3, c
    covered = {p for a in act.bank()["activities"] for p in a["patterns"]}
    assert set(PATTERNS) - {"insufficient_audio"} <= covered


def test_candidates_follow_the_groups_difficulties():
    top = act.candidates("word", {"matra_vowel_sign": 5})
    assert len(top) == 3 and all("word" in a["cohorts"] for a in top)
    assert all("matra_vowel_sign" in a["patterns"] for a in top)
    assert act.candidates("paragraph", {"fluency_only": 3})[0]["patterns"][0] == "fluency_only"


# ---- generation pipeline


def good_plan(source_id, minutes=(3, 4, 3)):
    return {"source_activity_id": source_id, "title_en": "Change one matra", "title_hi": "एक मात्रा बदलो",
            "materials_en": ["Board"], "materials_hi": ["बोर्ड"],
            "steps": [{"minutes": m, "en": f"Step {i}", "hi": f"चरण {i}"} for i, m in enumerate(minutes)],
            "practice_words": ["पानी", "पनी"], "watch_for_en": "Matra position", "watch_for_hi": "मात्रा की जगह",
            "why_en": "The group drops matras.", "why_hi": "समूह मात्राएँ छोड़ता है।"}


@pytest.fixture
def fake_models(monkeypatch):
    state = {"plans": [], "verdicts": [], "gen_calls": [], "val_calls": 0}

    async def gen(messages, ids, on_usage=None):
        state["gen_calls"].append((messages, ids))
        plan = state["plans"].pop(0)
        return plan(ids) if callable(plan) else plan

    async def val(source, plan, ctx, on_usage=None):
        state["val_calls"] += 1
        return state["verdicts"].pop(0)

    monkeypatch.setattr(act, "call_generate", gen)
    monkeypatch.setattr(act, "call_validate", val)
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    return state


OK = {"faithful_to_source": True, "age_appropriate": True, "safe": True, "fits_10_minutes": True, "issues": []}


def test_without_a_key_the_bank_entry_is_served_with_practice_words():
    out = asyncio.run(act.generate(CTX))
    assert out["generated_by"] == "bank" and not out["accepted"]
    assert out["plan"]["practice_words"] == ["पानी", "केला", "नाव"]
    assert out["source_activity_id"] == act.candidates("word", CTX["pattern_counts"])[0]["id"]


def test_accepted_plan(fake_models):
    fake_models["plans"] = [lambda ids: good_plan(ids[0])]
    fake_models["verdicts"] = [OK]
    out = asyncio.run(act.generate(CTX))
    assert out["accepted"] and out["generated_by"] == settings.claude_model
    assert out["plan"]["title"]["hi"] == "एक मात्रा बदलो"
    messages, ids = fake_models["gen_calls"][0]
    assert '"misread_words"' in messages[0]["content"] and len(ids) == 3


def test_reviewer_rejection_triggers_one_regeneration(fake_models):
    fake_models["plans"] = [lambda ids: good_plan(ids[0]), lambda ids: good_plan(ids[1])]
    fake_models["verdicts"] = [{**OK, "faithful_to_source": False, "issues": ["Different method"]}, OK]
    out = asyncio.run(act.generate(CTX))
    assert out["accepted"] and len(fake_models["gen_calls"]) == 2
    retry = fake_models["gen_calls"][1][0]
    assert retry[-1]["role"] == "user" and "Different method" in retry[-1]["content"]


def test_plans_that_break_the_rules_twice_fall_back_to_the_bank(fake_models):
    too_long = lambda ids: good_plan(ids[0], minutes=(10, 10, 10))  # noqa: E731
    fake_models["plans"] = [too_long, too_long]
    out = asyncio.run(act.generate(CTX))
    assert not out["accepted"] and out["generated_by"] == "bank"
    assert fake_models["val_calls"] == 0  # deterministic checks failed first; the reviewer was not needed
    assert "30 minutes" in out["validation"]["attempts"][0]["problems"][0]


# ---- API


def test_generate_endpoint_and_rating(client, script):
    h = login(client)
    cls, st = make_student(client, h)
    run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    r = client.post(f"/api/classes/{cls['id']}/activities", json={"cohort": "word"}, headers=h)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["source"]["url"].startswith("https://") and a["plan"]["steps"]
    assert client.post(f"/api/classes/{cls['id']}/activities", json={"cohort": "x"}, headers=h).status_code == 422
    rated = client.post(f"/api/activities/{a['id']}/rating", json={"rating": 4}, headers=h).json()
    assert rated["teacher_rating"] == 4
    assert client.get(f"/api/classes/{cls['id']}/activities", headers=h).json()[0]["id"] == a["id"]
