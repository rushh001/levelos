"""Diagnosis: evidence features, rule-based fallback, validation of Claude output, and the API wiring.
Claude itself is never called: its responses are fixtures written in the exact schema it must return."""

from types import SimpleNamespace

import pytest

from app.config import settings
from app.llm import diagnose as diag
from app.llm import rules
from app.llm.evidence import word_features
from tests.test_api import client, login, make_student, run_checkin, script  # noqa: F401  (fixtures)


# ---- features


def test_features_classify_akshara_differences():
    f = word_features("पानी", "पनी", "hi")
    assert f["vowel_sign_only"] and f["overlap"] == "final"
    f = word_features("बादल", "बाकल", "hi")
    assert f["overlap"] == "scaffolding" and not f["vowel_sign_only"]
    f = word_features("बच्चे", "बचे", "hi")
    assert f["has_conjunct"] and f["conjunct_changed"]
    f = word_features("sun", "sin", "en")
    assert f["vowel_sign_only"] and f["overlap"] == "scaffolding"
    assert word_features("है", None, "hi")["sight_word"]


# ---- rules


def evidence_input(*errors, level="paragraph", lang="hi", source="ai", pauses=0, wcpm=40.0, n_errors=None):
    words = [{"i": i, "ref": r, "heard": h, "kind": "omission" if h is None else "substitution",
              "uncertain": u, "teacher_confirmed": False, "features": word_features(r, h, lang)}
             for i, (r, h, u) in enumerate(errors)]
    return {"language": lang, "aser_level": "word", "items": [{
        "item_id": f"{lang}-para-a", "level": level, "source": source, "errors": len(words) if n_errors is None
        else n_errors, "pauses_over_3s": pauses, "wcpm": wcpm, "error_words": words}]}


def test_rules_rank_patterns_and_write_both_languages():
    inp = evidence_input(("पानी", "पनी", False), ("केला", "केल", False), ("बादल", "बाकल", False))
    out = rules.diagnose(inp, "मीना")
    assert out["error_patterns"][:2] == ["matra_vowel_sign", "blending_scaffolding"]
    assert "पानी → पनी" in out["summary"]["hi"] and "मीना को" in out["summary"]["hi"]
    assert out["summary"]["en"] and out["confidence"] == "low"


def test_rules_ignore_uncertain_words_and_say_so():
    out = rules.diagnose(evidence_input(("पानी", "पनी", True)), "Ravi")
    assert out["error_patterns"] == ["insufficient_audio"]


def test_rules_say_when_a_check_was_only_tap_marked():
    out = rules.diagnose(evidence_input(("पानी", None, False), source="offline_marks"), "Ravi")
    assert out["error_patterns"] == ["insufficient_audio"]
    assert "tapping" in out["summary"]["en"] and "quieter" not in out["summary"]["en"]


def test_rules_give_english_reading_advice_for_an_english_check():
    out = rules.diagnose(evidence_input(("sun", "sin", False), ("cat", "cut", False), lang="en"), "Ravi")
    assert out["error_patterns"][0] == "matra_vowel_sign"
    for text in out["summary"].values():  # in both languages: vowel sounds, not matras or the barakhadi
        assert "sat, sit, set" in text and "मात्रा" not in text and "बारहखड़ी" not in text


def test_rules_fluency_only_for_accurate_but_halting_reading():
    out = rules.diagnose(evidence_input(level="paragraph", pauses=4, n_errors=0), "Ravi")
    assert out["error_patterns"] == ["fluency_only"]


def test_rules_no_errors():
    out = rules.diagnose(evidence_input(n_errors=0), "Ravi")
    assert out["error_patterns"] == [] and "Word" in out["summary"]["en"]


# ---- validation of model output (guardrail: cite only real evidence)


def test_validation_drops_unsupported_claims():
    inp = evidence_input(("पानी", "पनी", False), ("घर", "धर", True))
    out = diag.validate({
        "error_patterns": ["matra_vowel_sign", "letter_recognition", "conjunct"],
        "evidence": [
            {"pattern": "matra_vowel_sign", "item_id": "hi-para-a", "word_indices": [0, 7], "note_en": "x", "note_hi": "y"},
            {"pattern": "letter_recognition", "item_id": "hi-para-a", "word_indices": [1], "note_en": "", "note_hi": ""},
            {"pattern": "conjunct", "item_id": "hi-story-z", "word_indices": [0], "note_en": "", "note_hi": ""},
        ],
        "word_notes": [{"item_id": "hi-para-a", "i": 0, "real_word": False}, {"item_id": "hi-para-a", "i": 9, "real_word": True}],
        "summary_hi": "मीना को मात्राओं में कठिनाई है।", "summary_en": "Meena misreads vowel signs.", "confidence": "high",
    }, inp)
    assert out["error_patterns"] == ["matra_vowel_sign"]  # uncertain-only and unknown-item claims dropped
    assert out["evidence"][0]["words"] == [{"i": 0, "ref": "पानी", "heard": "पनी"}]  # bogus index 7 dropped
    assert out["word_notes"] == [{"item_id": "hi-para-a", "i": 0, "real_word": False}]


def test_validation_rejects_empty_summary_or_all_unsupported():
    inp = evidence_input(("पानी", "पनी", False))
    bad = {"error_patterns": ["conjunct"], "evidence": [], "word_notes": [], "summary_hi": "x", "summary_en": "y",
           "confidence": "high"}
    assert diag.validate(bad, inp) is None
    empty = {"error_patterns": [], "evidence": [], "word_notes": [], "summary_hi": "", "summary_en": "y",
             "confidence": "low"}
    assert diag.validate(empty, inp) is None


# ---- API wiring: rules at once, Claude in the background


@pytest.fixture
def claude_on(monkeypatch):
    calls = []

    async def fake_call(payload, on_usage=None, effort=None):
        calls.append(payload)
        if on_usage:  # what a real Opus response bills: ~2k in, ~1.5k out (incl. thinking)
            on_usage("claude-opus-5-5", SimpleNamespace(input_tokens=2000, output_tokens=1500,
                                                       cache_read_input_tokens=0, cache_creation_input_tokens=0),
                     "end_turn")
        word_item = payload["items"][0]
        idx = [w["i"] for w in word_item["error_words"]]
        return ({  # written in the schema Claude must follow
            "error_patterns": ["matra_vowel_sign"],
            "evidence": [{"pattern": "matra_vowel_sign", "item_id": word_item["item_id"], "word_indices": idx,
                          "note_en": "Drops the long vowel sign.", "note_hi": "बड़ी मात्रा छूट रही है।"}],
            "word_notes": [{"item_id": word_item["item_id"], "i": i, "real_word": False} for i in idx],
            "summary_hi": "Meena को मात्राएँ पढ़ने में कठिनाई है। बारहखड़ी का अभ्यास कराएँ।",
            "summary_en": "Meena drops vowel signs. Practise the barakhadi chart.",
            "confidence": "medium",
        }, {"id": "msg_test", "model": "claude-opus-5-5", "stop_reason": "end_turn", "usage": None})

    monkeypatch.setattr(diag, "call_claude", fake_call)
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    return calls


def test_finish_stores_rules_diagnosis_without_claude(client, script):
    h = login(client)
    _, st = make_student(client, h)
    done = run_checkin(client, h, st["id"], {"word": {"wrong": 2}, "letter": {"wrong": 0}}, script)
    assert done["diagnosis"]["model"] == "rules"
    assert done["diagnosis"]["summary"]["hi"]


def test_claude_replaces_rules_in_the_background(client, script, claude_on):
    h = login(client)
    _, st = make_student(client, h)
    done = run_checkin(client, h, st["id"], {"word": {"wrong": 2}, "letter": {"wrong": 0}}, script)
    assert len(claude_on) == 1 and claude_on[0]["child_name"] == "Meena"
    assert "aser_level" in claude_on[0] and claude_on[0]["items"][0]["error_words"]
    got = client.get(f"/api/checkins/{done['id']}", headers=h).json()["diagnosis"]
    assert got["model"] == "claude-opus-5-5" and got["error_patterns"] == ["matra_vowel_sign"]
    assert got["evidence"][0]["words"][0]["ref"]  # filled from the evidence, not from the model

    # Re-fetching or finishing again does not call Claude again; a teacher correction does.
    client.post(f"/api/checkins/{done['id']}/finish", headers=h)
    assert len(claude_on) == 1
    word_ir = done["items"][0]
    client.post(f"/api/checkins/{done['id']}/review", headers=h,
                json={"marks": [{"item_result_id": word_ir["id"], "i": 0, "correct": True}]})
    assert len(claude_on) == 2


# ---- spend: every call is logged and costed; caps stop calls; bursts of corrections cost one call


def test_claude_calls_are_logged_and_costed(client, script, claude_on):
    h = login(client)
    _, st = make_student(client, h)
    run_checkin(client, h, st["id"], {"word": {"wrong": 2}, "letter": {"wrong": 0}}, script)
    b = client.get("/api/health").json()["claude_budget"]
    assert b["spent_usd"] == pytest.approx((2000 * 4.00 + 1500 * 20.00) / 1e6)  # Opus 5.5: $4 in / $20 out
    assert b["available"] is True


def test_total_cap_stops_claude_but_not_the_app(client, script, claude_on, monkeypatch):
    monkeypatch.setattr(settings, "claude_budget_usd", 0.03)  # one call (~$0.038) exceeds it
    h = login(client)
    _, a = make_student(client, h)
    run_checkin(client, h, a["id"], {"word": {"wrong": 2}, "letter": {"wrong": 0}}, script)
    assert len(claude_on) == 1
    other = client.post(f"/api/classes/{client.get('/api/classes', headers=h).json()[0]['id']}/students",
                        json={"first_name": "Ravi"}, headers=h).json()
    done = run_checkin(client, h, other["id"], {"word": {"wrong": 2}, "letter": {"wrong": 0}}, script)
    assert len(claude_on) == 1  # blocked: no second call
    assert done["diagnosis"]["model"] == "rules" and done["diagnosis"]["summary"]["hi"]
    assert client.get("/api/health").json()["claude_budget"]["available"] is False


def test_superseded_evidence_does_not_call_claude(client, script, claude_on):
    import asyncio

    h = login(client)
    _, st = make_student(client, h)
    done = run_checkin(client, h, st["id"], {"word": {"wrong": 2}, "letter": {"wrong": 0}}, script)
    assert len(claude_on) == 1
    asyncio.run(diag.run_claude(done["id"], expected_hash="stale-hash"))  # a newer change is queued
    asyncio.run(diag.run_claude(done["id"]))  # same evidence as the stored Claude diagnosis
    assert len(claude_on) == 1
