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
# An English reading check: the same patterns in English-reading terms (letter sounds, short vowels, blends;
# no matras, conjuncts or barakhadi), in both languages of the summary.
FINDING_ENGLISH = {
    "letter_recognition": ("{name} को अंग्रेज़ी के कुछ अक्षरों के नाम या ध्वनियाँ अभी नहीं आतीं ({ex})।",
                           "{name} does not yet know some English letter names or sounds ({ex})."),
    "matra_vowel_sign": ("{name} को अंग्रेज़ी शब्दों की स्वर ध्वनियों (a, e, i, o, u) में गलती हो रही है ({ex})।",
                         "{name} mixes up vowel sounds ({ex})."),
    "conjunct": ("{name} को sh, ch, st जैसी जुड़ी ध्वनियों वाले शब्दों में कठिनाई है ({ex})।",
                 "{name} has trouble with blends and digraphs such as sh, ch, st ({ex})."),
    "blending_scaffolding": ("{name} को अक्षरों की ध्वनियाँ जोड़कर अंग्रेज़ी शब्द पढ़ने में कठिनाई है ({ex})।",
                             "{name} knows the letter sounds but struggles to blend them into words ({ex})."),
}
ACTION_ENGLISH = {
    "letter_recognition": ("इस हफ़्ते रोज़ 5 मिनट अक्षर-ध्वनि चार्ट (a – apple, b – ball) से अभ्यास कराएँ; b/d और p/q पर ध्यान दें।",
                           "This week, practise the letter-sound chart (a – apple, b – ball) for 5 minutes a day; "
                           "watch b/d and p/q."),
    "matra_vowel_sign": ("ऐसे शब्द-परिवार पढ़वाएँ जिनमें सिर्फ़ स्वर बदलता है (sat, sit, set)।",
                         "Practise word families that change only the vowel (sat, sit, set)."),
    "conjunct": ("sh, ch, st वाले शब्दों को ध्वनियों में तोड़कर पढ़वाएँ, फिर जोड़कर (sh-i-p → ship)।",
                 "Break words with sh, ch or st into sounds, read each, then join them (sh-i-p → ship)."),
    "blending_scaffolding": ("ध्वनि-दर-ध्वनि शब्द बनाने का अभ्यास कराएँ (c-a-t → cat)।",
                             "Practise building words sound by sound (c-a-t → cat)."),
}
# Tap-marked without a recording: the wrong words are known, not what the child said instead.
MARKS_ONLY = ("यह जाँच टैप करके की गई: कौन-से शब्द गलत थे यह पता है, पर बच्चे ने उनकी जगह क्या पढ़ा यह नहीं। "
              "अगली जाँच रिकॉर्ड करें ताकि गलती का प्रकार दिख सके।",
              "This check was marked by tapping: it shows which words were wrong, not what the child said instead. "
              "Record the next check so the kind of error shows.")


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
    found: dict[str, list[dict]] = {}
    unclear = marks_only = 0
    for item in inp["items"]:
        offline = item["source"] == "offline_marks"
        for w in item["error_words"]:
            if w["uncertain"]:
                unclear += 1
                continue
            if offline and item["level"] != "letter":
                marks_only += 1
                continue
            p = classify(w, item["level"])
            if p:
                found.setdefault(p, []).append({"item_id": item["item_id"], "i": w["i"], "ref": w["ref"],
                                                "heard": w["heard"]})
        if item["level"] in ("paragraph", "story") and item["errors"] is not None \
                and item["errors"] <= DEFAULT_THRESHOLDS.passage_max_errors and _halting(item):
            found.setdefault("fluency_only", []).append({"item_id": item["item_id"], "i": None, "ref": None,
                                                         "heard": None})
    if not found and (unclear or marks_only):
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
        "summary": summarize(ranked, found, inp, name, marks_only=bool(marks_only) and not unclear),
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


def summarize(ranked: list[str], found: dict[str, list[dict]], inp: dict, name: str, *,
              marks_only: bool = False) -> dict:
    english = inp["language"] == "en"
    if not ranked:
        level = LEVEL_LABELS.get(inp.get("aser_level") or "", {"hi": "", "en": ""})
        return {"hi": f"{name} का {level['hi']} स्तर का पढ़ना ठीक है, कोई खास गलती नहीं। अगले स्तर की सामग्री दें।",
                "en": f"{name} reads at {level['en']} level without notable errors. Move on to next-level material."}
    if ranked == ["insufficient_audio"] and marks_only:
        return {"hi": MARKS_ONLY[0], "en": MARKS_ONLY[1]}
    hi_parts, en_parts = [], []
    for p in ranked[:2]:
        ex = _examples(found[p])
        fh, fe = FINDING_ENGLISH[p] if english and p in FINDING_ENGLISH else FINDING[p]
        hi_parts.append(fh.format(name=name, ex=ex).replace(" ()", ""))
        en_parts.append(fe.format(name=name, ex=ex).replace(" ()", ""))
    ah, ae = ACTION_ENGLISH[ranked[0]] if english and ranked[0] in ACTION_ENGLISH else ACTION[ranked[0]]
    return {"hi": " ".join(hi_parts + [ah]), "en": " ".join(en_parts + [ae])}
