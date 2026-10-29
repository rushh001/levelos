"""Activity bank integrity, candidate ranking, and the generate -> validate -> fallback pipeline (fake model)."""

import asyncio
import json
import re

import pytest

from app.config import settings
from app.content import text_for
from app.levels.aser_rules import COHORTS
from app.llm import activities as act
from app.llm.patterns import PATTERNS
from tests.test_api import client, login, make_student, run_checkin, script  # noqa: F401  (fixtures)

TEACHER_LANGUAGES = ("en", "hi", "mr", "kn", "ta", "bn")
CTX = {"cohort": "word", "language": "hi", "grade": 2, "group_size": 6,
       "pattern_counts": {"matra_vowel_sign": 4, "sight_word": 1}, "misread_words": ["पानी", "केला", "नाव"],
       "teacher_language": {"code": "hi", "name": "Hindi"}}


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
        for lang in TEACHER_LANGUAGES:  # every interface language reads every activity
            for field in ("title", "watch_for"):
                assert a[field][lang], (a["id"], field, lang)
            assert all(s[lang] for s in a["steps"]), (a["id"], lang)
            assert len(a["materials"][lang]) == len(a["materials"]["en"]), (a["id"], lang)
            assert lang == "en" or a["source"][f"note_{lang}"], (a["id"], lang)


def test_every_cohort_and_pattern_has_activities():
    for c in COHORTS:
        assert len([a for a in act.bank()["activities"] if c in a["cohorts"]]) >= 3, c
    covered = {p for a in act.bank()["activities"] for p in a["patterns"]}
    assert set(PATTERNS) - {"insufficient_audio"} <= covered


def test_examples_follow_the_language_the_group_reads():
    # A general activity shows English examples to an English group and Hindi ones to a Hindi group, in both
    # interface languages; nothing is left as a {ex1} placeholder.
    a = act.entry("correct-the-incorrect")
    en, hi = act.localize(a, "en"), act.localize(a, "hi")
    assert all("My dog liks my ball" in en["steps"][0][ui] for ui in ("en", "hi"))
    assert all("गाय का रंग सफाद है" in hi["steps"][0][ui] for ui in ("en", "hi"))
    for entry in act.bank()["activities"]:
        for lang in ("en", "hi", "mr", "ta", "kn", "bn"):
            if entry.get("script", "latin" if lang == "en" else "indic") != ("latin" if lang == "en" else "indic"):
                continue  # not offered in this language's script
            if entry.get("uses_text") and not text_for(lang, entry["uses_text"]):
                continue  # a text activity is only offered where the language has such a text
            shown = json.dumps(act.localize(entry, lang), ensure_ascii=False)
            assert not re.search(r"\{[a-z]+\d?\}", shown), (entry["id"], lang)
        assert act.source_of(entry)["note_hi"], entry["id"]


def test_a_tamil_group_sees_tamil_letters_and_the_charts_own_name():
    chart = act.localize(act.entry("barakhadi-chart-reading"), "ta")
    assert (chart["title"]["en"], chart["title"]["hi"]) == ("Uyirmei chart reading", "उयिरमेय चार्ट पढ़ना")
    assert "உயிர்மெய்" in chart["title"]["ta"]  # in the Tamil app, the chart's Tamil name
    assert "ಕಾಗುಣಿತ" in act.localize(act.entry("barakhadi-chart-reading"), "kn")["title"]["kn"]
    assert "க கா கி கீ" in chart["steps"][0]["en"] and "क का कि की" not in json.dumps(chart, ensure_ascii=False)
    split = act.localize(act.entry("conjunct-break-and-join"), "bn")["steps"][0]
    assert "বন্ধু → ব + ন্ + ধু" in split["en"] and "বন্ধু → ব + ন্ + ধু" in split["hi"]


def test_candidates_follow_the_groups_difficulties():
    top = act.candidates("word", {"matra_vowel_sign": 5})
    assert len(top) == 3 and all("word" in a["cohorts"] and a.get("text") for a in top)
    assert top[0]["id"] == "rhyme-words-break-and-join"  # the book activity that trains vowel signs
    assert act.candidates("paragraph", {"fluency_only": 3})[0]["patterns"][0] == "fluency_only"


# ---- generation pipeline


HI_RHYME_WORDS = ["जुकाम", "नंदू", "छींका", "पत्ते"]  # from the Hindi group's rhyme (नंदू को जुकाम)


def good_plan(source_id, minutes=(3, 4, 3), words=HI_RHYME_WORDS):
    return {"source_activity_id": source_id, "title_en": "Change one matra", "title_local": "एक मात्रा बदलो",
            "materials_en": ["Board"], "materials_local": ["बोर्ड"],
            "steps": [{"minutes": m, "en": f"Step {i}", "local": f"चरण {i}"} for i, m in enumerate(minutes)],
            "practice_words": list(words), "watch_for_en": "Matra position", "watch_for_local": "मात्रा की जगह",
            "why_en": "The group drops matras.", "why_local": "समूह मात्राएँ छोड़ता है।"}


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


OK = {"faithful_to_source": True, "age_appropriate": True, "safe": True, "fits_10_minutes": True, "fits_level": True,
      "issues": []}


def test_without_a_key_the_bank_entry_is_served_with_practice_words():
    out = asyncio.run(act.generate(CTX))
    assert out["generated_by"] == "bank" and not out["accepted"]
    # A Word group practises single short words from the rhyme (not the rhyme itself, not the misread words)
    plan = out["plan"]
    assert plan["material"]["kind"] == "words" and plan["practice_words"] == plan["material"]["items"]
    assert all(2 <= len(act.aksharas(w)) <= 3 for w in plan["practice_words"]) and "जुकाम" in plan["practice_words"]
    assert plan["text"]["id"] == "hi-rhyme-nandu" and plan["text"]["read_aloud"]
    assert out["source_activity_id"] == act.candidates("word", CTX["pattern_counts"])[0]["id"]


def test_accepted_plan(fake_models):
    fake_models["plans"] = [lambda ids: good_plan(ids[0])]
    fake_models["verdicts"] = [OK]
    out = asyncio.run(act.generate(CTX))
    assert out["accepted"] and out["generated_by"] == settings.claude_model
    assert out["plan"]["title"]["hi"] == "एक मात्रा बदलो"
    messages, ids = fake_models["gen_calls"][0]
    assert '"misread_words"' in messages[0]["content"] and len(ids) == 3


def test_a_plan_for_a_kannada_class_is_in_kannada_and_english(fake_models):
    kn_words = ["ನಾಗರಹಾವೆ", "ಬಾಗಿಲ", "ಕೈಗಳ"]
    fake_models["plans"] = [lambda ids: good_plan(ids[0], words=kn_words) | {"title_local": "ಒಂದು ಸ್ವರ ಚಿಹ್ನೆ ಬದಲಿಸಿ"}]
    fake_models["verdicts"] = [OK]
    out = asyncio.run(act.generate(CTX | {"language": "kn", "teacher_language": {"code": "kn", "name": "Kannada"}}))
    assert out["accepted"] and out["plan"]["title"] == {"en": "Change one matra", "kn": "ಒಂದು ಸ್ವರ ಚಿಹ್ನೆ ಬದಲಿಸಿ"}
    assert set(out["plan"]["steps"][0]) == {"minutes", "en", "kn"}
    messages, _ = fake_models["gen_calls"][0]
    assert '"teacher_language": {"code": "kn"' in messages[0]["content"]


def test_reviewer_rejection_triggers_one_regeneration(fake_models):
    fake_models["plans"] = [lambda ids: good_plan(ids[0]), lambda ids: good_plan(ids[1])]
    fake_models["verdicts"] = [{**OK, "faithful_to_source": False, "issues": ["Different method"]}, OK]
    out = asyncio.run(act.generate(CTX))
    assert out["accepted"] and len(fake_models["gen_calls"]) == 2
    retry = fake_models["gen_calls"][1][0]
    assert retry[-1]["role"] == "user" and "Different method" in retry[-1]["content"]


def test_practice_words_must_come_from_the_text(fake_models):
    # Words from outside the text are dropped; fewer than three left sends the plan back once.
    fake_models["plans"] = [lambda ids: good_plan(ids[0], words=["पानी", "केला", "जुकाम"]),
                            lambda ids: good_plan(ids[0], words=["जुकाम,", "नंदू", "छींका", "पानी"])]
    fake_models["verdicts"] = [OK]
    out = asyncio.run(act.generate(CTX | {"cohort": "paragraph"}))  # a Paragraph group reads the rhyme itself
    assert out["accepted"] and len(fake_models["gen_calls"]) == 2
    assert "copied exactly from the text" in fake_models["gen_calls"][1][0][-1]["content"]
    assert out["plan"]["practice_words"] == ["जुकाम", "नंदू", "छींका"]
    assert out["plan"]["text"]["author"] == "रामनरेश त्रिपाठी"


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
