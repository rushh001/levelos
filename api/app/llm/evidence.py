"""Turns a check-in into the structured evidence the diagnosis works from. Deterministic; no model.

Every error word gets akshara-level features (Raman & Rao 2025 substitution categories: initial-part correct,
final-part correct, scaffolding = first and last correct, some overlap, none; plus vowel-sign-only and
conjunct flags). Claude receives exactly this JSON (it cannot take audio), and the rule-based fallback uses it
directly.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata

from ..content import get_item, languages
from ..models import Checkin, Student
from ..speech.align import _INDIC_LETTER_MARKS, graphemes, normalize
from ..speech.scorer import ItemScore, word_correct

# High-frequency words a reader is expected to know on sight (Hindi function words; Dolch pre-primer to grade 1).
SIGHT_WORDS = {
    "hi": {"है", "हैं", "का", "की", "के", "में", "और", "एक", "वह", "यह", "से", "को", "ने", "पर", "था", "थी", "थे",
           "नहीं", "भी", "तो", "हम", "मैं", "तुम", "आज", "सब", "मेरा", "मेरे", "मेरी", "उसका", "उसने"},
    "en": {"a", "and", "away", "big", "blue", "can", "come", "down", "find", "for", "funny", "go", "help", "here",
           "i", "in", "is", "it", "jump", "little", "look", "make", "me", "my", "not", "one", "play", "red", "run",
           "said", "see", "the", "three", "to", "two", "up", "we", "where", "yellow", "you", "all", "am", "are",
           "at", "be", "but", "came", "did", "do", "eat", "get", "good", "have", "he", "into", "like", "no", "now",
           "on", "our", "out", "she", "so", "that", "there", "they", "this", "too", "was", "went", "what", "who",
           "will", "with", "yes", "after", "an", "as", "by", "every", "from", "had", "has", "her", "him", "his",
           "of", "old", "over", "some", "them", "then", "were", "when"},
}
_VOWELS_EN = set("aeiou")


def _virama(c: str) -> bool:
    return any("VIRAMA" in unicodedata.name(ch, "") for ch in c)


def _skeleton(clusters: list[str], lang: str) -> list[str]:
    """Consonant frame: Indic clusters without vowel signs; English letters without vowels."""
    if lang == "en":
        return [c for c in clusters if c not in _VOWELS_EN]
    return [_INDIC_LETTER_MARKS.sub("", c) for c in clusters]


def word_features(ref: str, heard: str | None, lang: str) -> dict:
    gr = graphemes(normalize(ref, lang))
    feats: dict = {"aksharas": len(gr), "sight_word": normalize(ref, lang) in SIGHT_WORDS.get(lang, set()),
                   "has_conjunct": lang != "en" and any(_virama(c) for c in gr)}
    if heard is None:
        return feats
    gh = graphemes(normalize(heard, lang))
    first, last = gr[:1] == gh[:1], gr[-1:] == gh[-1:]
    # Scaffolding: first and last right, middle wrong (or a sound inserted between them: नाव -> नानव).
    if first and last and max(len(gr), len(gh)) >= 3:
        overlap = "scaffolding"
    elif first:
        overlap = "initial"
    elif last:
        overlap = "final"
    elif set(gr) & set(gh):
        overlap = "some"
    else:
        overlap = "none"
    changed = [c for c in gr if c not in gh]
    feats.update({
        "overlap": overlap,
        "vowel_sign_only": _skeleton(gr, lang) == _skeleton(gh, lang),
        "conjunct_changed": lang != "en" and any(_virama(c) for c in changed),
        "length_change": len(gh) - len(gr),
    })
    return feats


def _heard(w: dict, primary: str | None) -> str | None:
    """What the paths on the winning side heard, preferring the primary path."""
    agreeing = [p for p, lab in w["labels"].items() if lab == w["label"]]
    for p in ([primary] if primary in agreeing else []) + agreeing:
        if w["heard"].get(p) is not None:
            return w["heard"][p]
    return None


def item_evidence(ir_result: dict, source: str) -> dict:
    s = ItemScore.from_dict(ir_result)
    item = get_item(s.item_id)
    if s.ai_scored:  # tap-marked offline, then its recording was scored on sync: what was heard is known
        source = "ai"
    errors = []
    for w in s.words:
        if word_correct(w):
            continue
        teacher = w.get("teacher_correct") is not None
        heard = None if w["label"] == "omit" or source == "offline_marks" else _heard(w, s.primary)
        errors.append({
            "i": w["i"],
            "ref": w["ref"],
            "heard": heard,
            "kind": "omission" if w["label"] == "omit" else "substitution",
            "uncertain": bool(w["uncertain"]) and not teacher,
            "teacher_confirmed": teacher,
            "features": word_features(w["ref"], heard, s.lang),
        })
    return {
        "item_id": s.item_id,
        "level": s.level,
        "text": item.text,
        "passed": s.passed,
        "needs_review": s.needs_review,
        "source": source,
        "words_total": len(s.words),
        "errors": s.counts.get("errors"),
        "self_corrected": [w["ref"] for w in s.words if w["label"] == "self_correct"],
        "repeats": sum(1 for e in s.extras if e["label"] == "repeat"),
        "insertions": [e["hyp"] for e in s.extras if e["label"] == "insert"],
        "pauses_over_3s": s.hesitations,
        "wcpm": s.wcpm,
        "error_words": errors,
    }


def build_input(checkin: Checkin) -> dict:
    student: Student = checkin.student
    cfg = languages().get(checkin.language, {})
    return {
        "language": checkin.language,
        "language_name": cfg.get("english_name", checkin.language),
        "script": cfg.get("script"),
        "grade": student.grade,
        "aser_level": checkin.level_final or checkin.level_suggested,
        "level_is_final": checkin.level_final is not None,
        "items": [item_evidence(ir.result, ir.source) for ir in checkin.items],
    }


def input_hash(inp: dict) -> str:
    return hashlib.sha256(json.dumps(inp, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
