"""Rule-based diagnosis from the evidence features. Shown instantly, used offline and whenever Claude is
unavailable; Claude's diagnosis replaces it when it arrives. Same output shape as the validated Claude output."""

from __future__ import annotations

from ..levels.aser_rules import DEFAULT_THRESHOLDS
from .patterns import PATTERNS

LEVEL_LABELS = {
    "beginner": {"hi": "आरंभिक", "en": "Beginner"},
    "letter": {"hi": "अक्षर", "en": "Letter"},
    "word": {"hi": "शब्द", "en": "Word"},
    "paragraph": {"hi": "अनुच्छेद", "en": "Paragraph"},
    "story": {"hi": "कहानी", "en": "Story"},
}

# One finding sentence per pattern ({name}, {ex} = example words) and one action for the top pattern.
# Hindi uses "{name} को ..." constructions so the sentence does not assume the child's gender.
FINDING = {
    "letter_recognition": ("{name} को कुछ अक्षर पहचानने में कठिनाई है ({ex})।",
                           "{name} does not yet recognise some letters ({ex})."),
    "matra_vowel_sign": ("{name} को मात्राएँ पढ़ने में गलती हो रही है ({ex})।",
                         "{name} misreads vowel signs ({ex})."),
    "conjunct": ("{name} को संयुक्त अक्षरों वाले शब्दों में कठिनाई है ({ex})।",
                 "{name} has trouble with conjunct letters ({ex})."),
    "blending_scaffolding": ("{name} को अक्षर जोड़कर पूरा शब्द पढ़ने में कठिनाई है ({ex})।",
                             "{name} knows the letters but struggles to blend them into words ({ex})."),
    "sight_word": ("{name} को छोटे, आम शब्दों में गलती हो रही है ({ex})।",
                   "{name} misreads common short words ({ex})."),
    "guessing_from_first_akshara": ("पढ़ते समय पहले अक्षर से शब्द का अनुमान लगाया जा रहा है ({ex})।",
                                    "{name} guesses words from the first letter ({ex})."),
    "fluency_only": ("{name} को शब्द सही आते हैं, पर पढ़ना अभी रुक-रुककर है।",
                     "{name} reads the words correctly but slowly or haltingly."),
    "insufficient_audio": ("इस जाँच से गलतियों का प्रकार साफ़ नहीं हुआ।",
                           "This check did not show clearly what kind of errors these are."),
}
ACTION = {
    "letter_recognition": ("इस हफ़्ते रोज़ 5 मिनट अक्षर कार्ड से पहचान का अभ्यास कराएँ।",
                           "This week, practise letter cards for 5 minutes a day."),
    "matra_vowel_sign": ("बारहखड़ी चार्ट से एक व्यंजन के साथ सभी मात्राएँ पढ़वाएँ।",
                         "Use the barakhadi chart: read one consonant with every vowel sign."),
    "conjunct": ("संयुक्त अक्षर वाले शब्दों को तोड़कर पढ़वाएँ, फिर जोड़कर।",
                 "Break words with conjuncts into parts, read each part, then join them."),
    "blending_scaffolding": ("अक्षर जोड़कर शब्द बनाने का अभ्यास कराएँ (क-म-ल → कमल)।",
                             "Practise building words sound by sound (k-a-m-a-l → kamal)."),
    "sight_word": ("इन शब्दों के फ़्लैशकार्ड बनाकर रोज़ दोहराएँ।",
                   "Make flashcards of these words and revise them daily."),
    "guessing_from_first_akshara": ("हर शब्द पर उँगली रखकर पूरा शब्द पढ़ने को कहें।",
                                    "Ask the child to point at each word and read every letter in it."),
    "fluency_only": ("रोज़ एक छोटा अनुच्छेद दो-तीन बार दोहराकर पढ़वाएँ।",
                     "Have the child re-read one short paragraph two or three times a day."),
    "insufficient_audio": ("अगली बार शांत जगह पर दोबारा रिकॉर्ड करें।",
                           "Next time, record again somewhere quieter."),
}
EN_VOWEL_FINDING = "{name} mixes up vowel sounds ({ex})."
EN_VOWEL_ACTION = "Practise word families that change only the vowel (sat, sit, set)."


def classify(word: dict, level: str) -> str | None:
    """A specific decoding pattern wins; 'sight word' is for skipped common words, or common words misread in a
    way no decoding pattern explains (की -> कि is a matra error even though की is a common word)."""
    f = word["features"]
    if level == "letter":
        return "letter_recognition"
    if word["kind"] == "omission":
        return "sight_word" if f["sight_word"] else None
    if f.get("conjunct_changed"):
        return "conjunct"
    if f.get("vowel_sign_only"):
        return "matra_vowel_sign"
    if f["sight_word"]:
        return "sight_word"
    if f.get("overlap") == "scaffolding":
        return "blending_scaffolding"
    if f.get("overlap") == "initial":
        return "guessing_from_first_akshara"
    if f.get("overlap") in ("final", "some"):
        return "blending_scaffolding"
    return None


def _halting(item: dict) -> bool:
    t = DEFAULT_THRESHOLDS
    floor = t.passage_min_wcpm.get(item["level"])
    return ((item["pauses_over_3s"] or 0) > t.passage_max_hesitations
            or (item["wcpm"] is not None and floor is not None and item["wcpm"] < floor))


def diagnose(inp: dict, name: str) -> dict:
    lang = inp["language"]
    found: dict[str, list[dict]] = {}
    unclear = 0
    for item in inp["items"]:
        offline = item["source"] == "offline_marks"
        for w in item["error_words"]:
            if w["uncertain"]:
                unclear += 1
                continue
            if offline and item["level"] != "letter":
                unclear += 1
                continue
            p = classify(w, item["level"])
            if p:
                found.setdefault(p, []).append({"item_id": item["item_id"], "i": w["i"], "ref": w["ref"],
                                                "heard": w["heard"]})
        if item["level"] in ("paragraph", "story") and item["errors"] is not None \
                and item["errors"] <= DEFAULT_THRESHOLDS.passage_max_errors and _halting(item):
            found.setdefault("fluency_only", []).append({"item_id": item["item_id"], "i": None, "ref": None,
                                                         "heard": None})
    if not found and unclear:
        found["insufficient_audio"] = [{"item_id": inp["items"][0]["item_id"], "i": None, "ref": None,
                                        "heard": None}]

    ranked = sorted(found, key=lambda p: (-len(found[p]), PATTERNS.index(p)))[:3]
    evidence = []
    for p in ranked:
        by_item: dict[str, list[dict]] = {}
        for e in found[p]:
            by_item.setdefault(e["item_id"], [])
            if e["i"] is not None:
                by_item[e["item_id"]].append({"i": e["i"], "ref": e["ref"], "heard": e["heard"]})
        evidence += [{"pattern": p, "item_id": iid, "words": ws, "note_en": "", "note_hi": ""}
                     for iid, ws in by_item.items()]
    return {
        "error_patterns": ranked,
        "evidence": evidence,
        "word_notes": [],
        "summary": summarize(ranked, found, inp, name),
        "confidence": "low",
    }


def _examples(entries: list[dict]) -> str:
    out = []
    for e in entries:
        if e["ref"] is None:
            continue
        out.append(f"{e['ref']} → {e['heard']}" if e["heard"] else f"{e['ref']} → —")
        if len(out) == 2:
            break
    return ", ".join(out)


def summarize(ranked: list[str], found: dict[str, list[dict]], inp: dict, name: str) -> dict:
    lang = inp["language"]
    if not ranked:
        level = LEVEL_LABELS.get(inp.get("aser_level") or "", {"hi": "", "en": ""})
        return {"hi": f"{name} का {level['hi']} स्तर का पढ़ना ठीक है, कोई खास गलती नहीं। अगले स्तर की सामग्री दें।",
                "en": f"{name} reads at {level['en']} level without notable errors. Move on to next-level material."}
    hi_parts, en_parts = [], []
    for p in ranked[:2]:
        ex = _examples(found[p])
        fh, fe = FINDING[p]
        if p == "matra_vowel_sign" and lang == "en":
            fe = EN_VOWEL_FINDING
        hi_parts.append(fh.format(name=name, ex=ex).replace(" ()", ""))
        en_parts.append(fe.format(name=name, ex=ex).replace(" ()", ""))
    ah, ae = ACTION[ranked[0]]
    if ranked[0] == "matra_vowel_sign" and lang == "en":
        ae = EN_VOWEL_ACTION
    return {"hi": " ".join(hi_parts + [ah]), "en": " ".join(en_parts + [ae])}
