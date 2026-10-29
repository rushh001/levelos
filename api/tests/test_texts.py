"""Free-to-use texts (public domain or Creative Commons BY) and the activities built on them."""

import json
import re

from app.content import available_languages, text_for, texts
from app.llm import activities as act
from tests.test_api import client, script  # noqa: F401  (fixtures)

LICENCES = {"public domain", "CC0 1.0", "CC BY 4.0", "CC BY-SA 4.0"}  # free of cost and of permission
CTX = {"cohort": "paragraph", "language": "en", "grade": 2, "group_size": 5, "pattern_counts": {"fluency_only": 3},
       "misread_words": ["world", "diamond"], "teacher_language": {"code": "hi", "name": "Hindi"}}


def test_every_text_is_free_to_use_and_complete():
    seen = set()
    for lang in available_languages():
        for t in texts(lang):
            assert t["id"] not in seen and t["id"].startswith(f"{lang}-"), t["id"]
            seen.add(t["id"])
            assert t["kind"] in ("rhyme", "story") and t["level"] in ("paragraph", "story"), t["id"]
            assert t["title"] and t["author"] and t["licence"] in LICENCES, t["id"]
            assert t["source"]["name"] and t["source"]["url"].startswith("http"), t["id"]
            if t["licence"] == "public domain":  # India: life + 60 years, so the author died before 1966
                assert t.get("traditional") or (t.get("author_died") and t["author_died"] <= 1965), t["id"]
            assert 2 <= len(t["lines"]) <= 16 and all(line.strip() for line in t["lines"]), t["id"]
            body = " ".join(t["lines"])
            assert t["words_to_find"] and all(w in body for w in t["words_to_find"]), t["id"]
            if t["kind"] == "story":
                qs = t.get("questions", [])
                assert 3 <= len(qs) <= 4 and all(q["q"].strip() and q["a"].strip() for q in qs), t["id"]
    assert text_for("en", "rhyme")["title"] == "The Star"


def test_a_text_activity_carries_the_text_and_fills_its_placeholders():
    a = act.entry("classic-rhyme-reading")
    assert a["uses_text"] == "rhyme"
    shown = act.localize(a, "en")
    assert shown["title"]["en"] == "Read a classic rhyme: The Star"
    assert "(star, wonder, world, diamond, sky)" in shown["steps"][2]["en"]
    plan = act.plan_from_bank(shown, CTX)
    assert plan["text"]["author"] == "Jane Taylor" and plan["text"]["licence"] == "public domain"
    assert plan["text"]["lines"][0].startswith("Twinkle") and plan["text"]["source"]["url"].startswith("https://")
    assert not re.search(r"\{[a-z_]+\}", json.dumps(plan, ensure_ascii=False))  # no placeholder left unfilled
    hunt = act.localize(act.entry("word-hunt-in-rhyme"), "en")
    assert "(s)" in hunt["steps"][1]["en"]  # the letter the first word to find starts with


def test_text_activities_are_offered_only_where_the_language_has_the_text():
    ids = lambda cands: [a["id"] for a in cands]  # noqa: E731
    assert "classic-rhyme-reading" in ids(act.candidates("paragraph", {"fluency_only": 3}, k=10, language="en"))
    for lang in available_languages():
        for cohort in ("letter", "word", "paragraph"):
            for a in act.candidates(cohort, {}, k=50, language=lang):
                if a.get("uses_text"):
                    assert text_for(lang, a["uses_text"]), (a["id"], lang)
    assert act.first_akshara("कमल") == "क" and act.first_akshara("क्षमा") == "क्ष" and act.first_akshara("கோடு") == "கோ"


def test_every_group_in_every_language_gets_only_activities_built_on_a_book_text():
    # The main 10-minute activity always has the group read a credited text from a free book, and serves an
    # NCERT foundational-stage (NCF-FS) goal; the Pratham / TaRL method bank is only for a language without texts.
    for lang in available_languages():
        for cohort in ("letter", "word", "paragraph"):
            cands = act.candidates(cohort, {}, k=10, language=lang)
            assert len(cands) >= 3, (lang, cohort)
            for a in cands:
                assert a.get("uses_text") and a["text"]["licence"] in LICENCES, (lang, cohort, a["id"])
                assert a["source"]["ref"] == "ncf_fs" and act.source_of(a)["url"].startswith("https://ncert.nic.in/")
                assert not re.search(r"\{[a-z_]+\}", json.dumps(a, ensure_ascii=False)), (lang, a["id"])
    assert act.bank()["sources"]["ncf_fs"]["name"].startswith("NCERT")


def test_another_activity_brings_another_method_and_another_text():
    first = act.candidates("paragraph", {}, language="en")
    assert first[0]["id"] == "classic-rhyme-reading" and first[0]["text"]["id"] == "en-rhyme-star"
    after = act.candidates("paragraph", {}, language="en",
                           recent={"activities": ["classic-rhyme-reading"], "texts": ["en-rhyme-star"]})
    assert "classic-rhyme-reading" not in [a["id"] for a in after]
    assert all(a["text"]["id"] != "en-rhyme-star" for a in after)
    # every rhyme read: the one read longest ago comes back
    read = ["en-rhyme-rain", "en-rhyme-humpty", "en-rhyme-wind", "en-rhyme-star"]
    assert act.pick_text("en", "rhyme", read)["id"] == "en-rhyme-star"
    # letter cards: the letters the rhyme's words start with, the most frequent first, English in lower case
    humpty = next(t for t in texts("en") if t["id"] == "en-rhyme-humpty")
    letters = act.letters_from(humpty)
    assert "h" in letters["items"] and letters["anchors"]["h"] == "humpty"
    cards = act.localize(act.entry("rhyme-letter-cards"), "en", humpty, letters)
    assert ", ".join(letters["items"]) in cards["materials"]["en"][0]


def test_the_api_remembers_what_the_group_did(client, script):
    from tests.test_api import login, make_student, run_checkin  # noqa: PLC0415
    h = login(client)
    cls, st = make_student(client, h)
    run_checkin(client, h, st["id"], {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}, script)
    made = [client.post(f"/api/classes/{cls['id']}/activities", json={"cohort": "word"}, headers=h).json() for _ in range(3)]
    assert all(a["plan"]["text"]["licence"] in LICENCES for a in made)
    assert made[0]["source_activity_id"] != made[1]["source_activity_id"] != made[2]["source_activity_id"]
    assert made[0]["plan"]["text"]["id"] != made[1]["plan"]["text"]["id"]
    assert made[0]["source"]["name"].startswith("NCERT")


def test_each_group_reads_only_what_its_level_allows():
    # A child who cannot read letters cannot read a word, and one who cannot read words cannot read a rhyme.
    for lang in available_languages():
        for a in act.candidates("letter", {}, k=10, language=lang, misread=["क"]):
            assert a["reads"] == "letters" and 3 <= len(a["material"]["items"]) <= 5, (lang, a["id"])
            assert all(len(act.aksharas(x)) == 1 for x in a["material"]["items"]), (lang, a["material"])
            assert all(x in a["materials"]["en"][0] for x in a["material"]["items"]), (lang, a["id"])
        for a in act.candidates("word", {}, k=10, language=lang):
            assert a["reads"] == "words" and 4 <= len(a["material"]["items"]) <= 8, (lang, a["id"])
            for w in a["material"]["items"]:
                assert (2 <= len(w) <= 5) if w.isascii() else (2 <= len(act.aksharas(w)) <= 3), (lang, w)
                assert w in " ".join(a["text"]["lines"]) or w in " ".join(a["text"]["lines"]).lower(), (lang, w)
        for a in act.candidates("paragraph", {}, k=10, language=lang):
            assert a["reads"] == "text" and act.is_short(a["text"]), (lang, a["id"], a["text"]["id"])
        story = act.candidates("story", {}, k=10, language=lang)  # the Story group
        assert {a["id"] for a in story} >= {"read-and-answer", "story-echo-reading"}, lang
        assert all(a["text"]["kind"] == "story" for a in story if a["id"] != "classic-rhyme-reading"), lang
    # the letters the children misread come first when the rhyme has them
    hi = act.candidates("letter", {}, language="hi", misread=["क"])[0]
    assert hi["material"]["items"][0] == "क" and hi["material"]["anchors"]["क"] == "को"
    # without Claude the Letter group still gets its letters, not the rhyme
    plan = act.plan_from_bank(hi, {"misread_words": []})
    assert plan["practice_words"] == hi["material"]["items"] and plan["text"]["read_aloud"]


def test_paragraph_and_story_groups_get_homework_not_single_words():
    for lang in available_languages():
        for cohort in ("paragraph", "story"):
            for a in act.candidates(cohort, {}, k=10, language=lang):
                plan = act.plan_from_bank(a, {"misread_words": []})
                hw = plan["homework"]
                assert set(hw) == {"en", "hi", "mr", "kn", "ta", "bn"}, (lang, a["id"])
                assert all(a["text"]["title"] in s and "{" not in s for s in hw.values()), (lang, a["id"])
        for cohort in ("letter", "word"):
            for a in act.candidates(cohort, {}, k=10, language=lang):
                assert "homework" not in act.plan_from_bank(a, {"misread_words": []}), (lang, a["id"])
    story = act.homework_for(next(t for t in texts("hi") if t["kind"] == "story"))
    assert "अपने शब्दों में" in story["hi"]  # a story: read it, retell it, write two sentences
