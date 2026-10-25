"""Each child is tested in their regional language and in English, as in ASER: separate ladders, levels and groups."""

import re

from app.content import reading_languages, teacher_language
from app.llm import activities as act
from app.models import Checkin, Classroom, Student, StudentLevel, Teacher
from app.services.checkins import migrate_levels
from tests.test_api import client, login, make_student, script, upload  # noqa: F401  (fixtures)

WORD_LEVEL = {"word": {"wrong": 0}, "paragraph": {"wrong": 6}}  # grade 2 starts at words: word passed, paragraph not
LETTER_LEVEL = {"word": {"wrong": 4}, "letter": {"wrong": 0}}  # words failed, letters passed


def run_in(client, h, student_id, language, plan, script):
    script.clear()
    script.update(plan)
    c = client.post("/api/checkins", json={"student_id": student_id, "language": language}, headers=h).json()
    while c["next_item"]:
        c = upload(client, h, c)["checkin"]
    return client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()


def test_reading_languages_are_the_regional_language_and_english():
    assert reading_languages("hi") == ["hi", "en"]
    assert reading_languages("en") == ["en"]
    assert reading_languages("mr") == ["mr", "en"]
    assert reading_languages("te") == ["en"]  # no Telugu item bank yet


def test_english_check_reads_english_cards_and_moves_only_the_english_level(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=2)  # a Hindi class
    hi = run_in(client, h, st["id"], None, WORD_LEVEL, script)
    assert (hi["language"], hi["level_final"]) == ("hi", "word")
    en = run_in(client, h, st["id"], "en", LETTER_LEVEL, script)
    assert en["language"] == "en" and all(i["item_id"].startswith("en-") for i in en["items"])
    assert [i["item_level"] for i in en["items"]] == ["word", "letter"] and en["level_final"] == "letter"

    s = client.get(f"/api/students/{st['id']}", headers=h).json()  # default: the child's main language
    assert (s["language"], s["languages"], s["level"]) == ("hi", ["hi", "en"], "word")
    assert (s["levels"]["hi"]["level"], s["levels"]["en"]["level"]) == ("word", "letter")
    s_en = client.get(f"/api/students/{st['id']}?language=en", headers=h).json()
    assert (s_en["language"], s_en["level"], s_en["checkins"]) == ("en", "letter", 1)


def test_two_checks_confirm_only_within_one_language(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=2)
    run_in(client, h, st["id"], "hi", WORD_LEVEL, script)
    run_in(client, h, st["id"], "en", WORD_LEVEL, script)  # same level, other language: not a second opinion
    levels = client.get(f"/api/students/{st['id']}", headers=h).json()["levels"]
    assert not levels["hi"]["level_confirmed"] and not levels["en"]["level_confirmed"]
    run_in(client, h, st["id"], "en", WORD_LEVEL, script)
    levels = client.get(f"/api/students/{st['id']}", headers=h).json()["levels"]
    assert levels["en"]["level_confirmed"] and not levels["hi"]["level_confirmed"]


def test_group_set_by_hand_applies_to_one_language(client, script):
    h = login(client)
    _, st = make_student(client, h, grade=3)  # Grade 3 starts at the paragraph

    def start(lang):
        return client.post("/api/checkins", json={"student_id": st["id"], "language": lang}, headers=h).json()

    client.patch(f"/api/students/{st['id']}", json={"cohort_override": "letter", "language": "en"}, headers=h)
    en = start("en")
    assert en["start_level"] == "letter" and en["next_item"]["id"].startswith("en-letter")
    client.post(f"/api/checkins/{en['id']}/abandon", headers=h)
    assert start("hi")["start_level"] == "paragraph"  # the Hindi group is untouched
    s = client.get(f"/api/students/{st['id']}", headers=h).json()
    assert (s["levels"]["en"]["cohort_override"], s["levels"]["hi"]["cohort_override"]) == ("letter", None)


def test_dashboard_groups_each_language_separately(client, script):
    h = login(client)
    cls, st = make_student(client, h, grade=2)
    run_in(client, h, st["id"], "hi", WORD_LEVEL, script)
    run_in(client, h, st["id"], "en", LETTER_LEVEL, script)

    def groups(query=""):
        d = client.get(f"/api/classes/{cls['id']}/dashboard{query}", headers=h).json()
        return d["language"], {c["cohort"]: [s["first_name"] for s in c["students"]] for c in d["cohorts"]}

    assert groups() == ("hi", {"letter": [], "word": ["Meena"], "paragraph": []})
    assert groups("?language=en") == ("en", {"letter": ["Meena"], "word": [], "paragraph": []})
    assert groups("?language=ta")[0] == "hi"  # not one of this class's reading tests: the class language
    assert client.get(f"/api/classes/{cls['id']}", headers=h).json()["languages"] == ["hi", "en"]


def test_offline_english_check_syncs_as_english(client):
    h = login(client)
    _, st = make_student(client, h, grade=2)
    c = client.post("/api/checkins", json={"student_id": st["id"], "language": "en", "local_id": "phone-1",
                                           "start_level": "letter"}, headers=h).json()
    assert (c["language"], c["start_level"]) == ("en", "letter") and c["next_item"]["id"].startswith("en-letter")


def test_english_activities_never_use_hindi_script_methods():
    patterns = {"matra_vowel_sign": 3, "conjunct": 2, "letter_recognition": 1}
    for cohort in ("letter", "word", "paragraph"):
        en = act.candidates(cohort, patterns, k=50, language="en")
        hi = act.candidates(cohort, patterns, k=50, language="hi")
        assert en and all(a.get("script") != "indic" for a in en), cohort
        assert hi and all(a.get("script") != "latin" for a in hi), cohort
    # A word group mixing up vowels: English phonics methods first (not the general ones with Hindi examples).
    top = act.candidates("word", {"matra_vowel_sign": 3}, language="en")
    assert all(a.get("script") == "latin" for a in top) and "vowel-change-chain" in [a["id"] for a in top]


def test_activity_is_made_for_the_language_of_the_group(client, script):
    h = login(client)
    cls, st = make_student(client, h, grade=2)
    run_in(client, h, st["id"], "en", LETTER_LEVEL, script)
    r = client.post(f"/api/classes/{cls['id']}/activities", json={"cohort": "letter", "language": "en"}, headers=h)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["language"] == "en" and act.entry(a["source_activity_id"]).get("script") != "indic"

    def listed(lang):
        return client.get(f"/api/classes/{cls['id']}/activities?cohort=letter&language={lang}", headers=h).json()

    assert [x["id"] for x in listed("en")] == [a["id"]] and listed("hi") == []


BETA = ("mr", "ta", "kn", "bn")


def test_beta_languages_run_the_same_reading_check(client, script):
    h = login(client)
    for lang in BETA:
        cls, st = make_student(client, h, grade=2, lang=lang)
        assert cls["languages"] == [lang, "en"]  # their own language and English, as in ASER
        c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
        assert (c["language"], c["start_level"]) == (lang, "word")
        assert c["next_item"]["id"].startswith(f"{lang}-word") and c["next_item"]["instructions"][lang]
        client.post(f"/api/checkins/{c['id']}/abandon", headers=h)


def test_longer_words_get_a_fair_speed_floor():
    # Tamil words are about twice as long as Hindi words: 8 correct words a minute is a fair Tamil pace,
    # a halting Hindi one.
    from app.content import get_item
    from app.speech.align import tokenize
    from app.speech.scorer import ItemScore

    def read(item_id: str, wcpm: float) -> ItemScore:
        item = get_item(item_id)
        words = [{"i": i, "ref": r, "label": "correct", "uncertain": False, "heard": {}, "labels": {}, "pa": None,
                  "start_ms": None, "end_ms": None, "teacher_correct": None}
                 for i, r in enumerate(tokenize(item.text, item.lang))]
        return ItemScore(item.id, item.level, item.lang, "scored", duration_ms=1,
                         reading_ms=int(len(words) * 60_000 / wcpm), words=words).evaluate()

    assert read("ta-para-a", 8).passed and not read("hi-para-a", 8).passed
    assert read("hi-para-a", 16).passed


def test_error_features_work_in_every_script():
    from app.llm.evidence import word_features

    assert word_features("पाणी", "पणी", "mr")["vowel_sign_only"]
    assert word_features("பால்", "பல்", "ta")["vowel_sign_only"]
    assert word_features("কাল", "কল", "bn")["vowel_sign_only"]
    kn = word_features("ಬೆಕ್ಕು", "ಬೆಕು", "kn")
    assert kn["has_conjunct"] and kn["conjunct_changed"]
    assert word_features("বন্ধু", "বনধু", "bn")["conjunct_changed"]
    assert word_features("আছে", None, "bn")["sight_word"] and word_features("কোথায়", None, "bn")["sight_word"]


def test_advice_for_other_indian_languages_has_no_hindi_only_terms():
    from app.llm import rules
    from tests.test_diagnosis import evidence_input

    out = rules.diagnose(evidence_input(("பால்", "பல்", False), ("மலை", "மல", False), lang="ta"), "Meena")
    assert out["error_patterns"][0] == "matra_vowel_sign"
    assert "barakhadi" not in out["summary"]["en"].lower() and "बारहखड़ी" not in out["summary"]["hi"]


DEVANAGARI = re.compile(r"[ऀ-ॿ]")
KANNADA = re.compile(r"[ಀ-೿]")


def test_a_regional_class_reads_its_results_in_its_own_language_and_english(client, script):
    # A Kannada class's teacher reads every diagnosis in Kannada and English, never in Hindi: its Kannada test and
    # its English test alike. Classes in a language the app has no interface in keep Hindi.
    assert [teacher_language(lang) for lang in ("hi", "mr", "kn", "ta", "bn", "en")] == ["hi", "mr", "kn", "ta", "bn", "hi"]
    h = login(client)
    _, st = make_student(client, h, grade=2, lang="kn")
    for lang in ("kn", "en"):
        done = run_in(client, h, st["id"], lang, {"word": {"wrong": 3}, "letter": {"wrong": 0}}, script)
        summary = done["diagnosis"]["summary"]
        assert done["main_language"] == "kn" and set(summary) == {"en", "kn"}, lang
        assert KANNADA.search(summary["kn"]) and not DEVANAGARI.search(summary["kn"]), lang


def test_rules_and_claude_write_in_the_teachers_language():
    from app.llm import diagnose as diag
    from app.llm import rules
    from tests.test_diagnosis import evidence_input

    for local, script_re in (("ta", re.compile(r"[஀-௿]")), ("bn", re.compile(r"[ঀ-৿]")),
                             ("mr", DEVANAGARI), ("kn", KANNADA)):
        inp = evidence_input(("sun", "sin", False), ("cat", "cut", False), lang="en") | {
            "teacher_language": {"code": local, "name": local}}
        out = rules.diagnose(inp, "Meena")
        assert set(out["summary"]) == {"en", local} and script_re.search(out["summary"][local]), local
    inp = evidence_input(("ಮರ", "ಮಾರ", False), lang="kn") | {"teacher_language": {"code": "kn", "name": "Kannada"}}
    out = diag.validate({
        "error_patterns": ["matra_vowel_sign"],
        "evidence": [{"pattern": "matra_vowel_sign", "item_id": "kn-para-a", "word_indices": [0],
                      "note_en": "Adds a vowel sign.", "note_local": "ಸ್ವರ ಚಿಹ್ನೆ ಸೇರಿಸುತ್ತಿದೆ."}],
        "word_notes": [], "summary_local": "ಮೀನಾ: ಸ್ವರ ಚಿಹ್ನೆಗಳಲ್ಲಿ ತಪ್ಪುಗಳು.", "summary_en": "Meena adds vowel signs.",
        "confidence": "medium",
    }, inp)
    assert out["summary"] == {"en": "Meena adds vowel signs.", "kn": "ಮೀನಾ: ಸ್ವರ ಚಿಹ್ನೆಗಳಲ್ಲಿ ತಪ್ಪುಗಳು."}
    assert out["evidence"][0]["note_kn"] == "ಸ್ವರ ಚಿಹ್ನೆ ಸೇರಿಸುತ್ತಿದೆ." and "note_hi" not in out["evidence"][0]


def test_a_regional_class_gets_its_activity_in_its_own_language(client, script):
    # Without Claude (no key, spend cap, offline) the bank entry itself is in Kannada for a Kannada class.
    h = login(client)
    cls, st = make_student(client, h, grade=2, lang="kn")
    run_in(client, h, st["id"], "kn", WORD_LEVEL, script)
    a = client.post(f"/api/classes/{cls['id']}/activities", json={"cohort": "word"}, headers=h).json()
    assert a["generated_by"] == "bank" and a["language"] == "kn"
    assert KANNADA.search(a["plan"]["title"]["kn"]) and all(KANNADA.search(s["kn"]) for s in a["plan"]["steps"])
    assert KANNADA.search(a["source"]["note_kn"])


def test_older_results_of_a_regional_class_are_rewritten_in_its_language(client, db, script):
    # Diagnoses written before a Kannada class's were in Kannada (they were in Hindi and English) are rewritten
    # at startup; Claude writes again the ones it had written.
    from app.llm import diagnose as diag

    h = login(client)
    _, st = make_student(client, h, grade=2, lang="kn")
    done = [run_in(client, h, st["id"], "kn", {"word": {"wrong": 3}, "letter": {"wrong": 0}}, script)
            for _ in range(2)]
    hindi_class = run_in(client, h, make_student(client, h)[1]["id"], "hi", WORD_LEVEL, script)
    for i, c in enumerate(done):
        d = db.get(Checkin, c["id"]).diagnosis
        d.summary, d.model = {"hi": "मीना को मात्राओं में कठिनाई है।", "en": "Meena drops vowel signs."}, (
            "rules" if i == 0 else "claude-opus-5-5")
    db.commit()

    again = diag.relocalize(db)
    assert [cid for cid, _ in again] == [done[1]["id"]]
    for c in done:
        d = db.get(Checkin, c["id"]).diagnosis
        db.refresh(d)
        assert set(d.summary) == {"en", "kn"} and d.model == "rules"
    assert set(db.get(Checkin, hindi_class["id"]).diagnosis.summary) == {"hi", "en"}  # untouched
    assert diag.relocalize(db) == []  # once only


def test_names_per_interface_language(client):
    h = login(client)
    cls = client.post("/api/classes", json={"name": "कक्षा 3", "names": {"en": "Class 3", "hi": "कक्षा 3"}, "grade": 3},
                      headers=h).json()
    assert cls["names"] == {"en": "Class 3", "hi": "कक्षा 3"}
    st = client.post(f"/api/classes/{cls['id']}/students",
                     json={"first_name": "मीना", "names": {"hi": "मीना", "en": " Meena ", "mr": ""}}, headers=h).json()
    assert st["names"] == {"hi": "मीना", "en": "Meena"}
    too_long = {"first_name": "Ravi", "names": {"en": "R" * 81}}
    assert client.post(f"/api/classes/{cls['id']}/students", json=too_long, headers=h).status_code == 422


def test_dashboard_points_at_the_check_waiting_for_confirmation(client, script):
    h = login(client)
    cls, st = make_student(client, h, grade=2)
    script.clear()
    script.update({"word": {"uncertain": (0, 1)}})  # two unsure words could flip the card
    c = client.post("/api/checkins", json={"student_id": st["id"]}, headers=h).json()
    c = upload(client, h, c)["checkin"]
    c = client.post(f"/api/checkins/{c['id']}/finish", headers=h).json()
    assert c["status"] == "needs_review"
    for lang in ("hi", "en"):  # whichever reading test the dashboard shows, one tap reaches the check
        d = client.get(f"/api/classes/{cls['id']}/dashboard?language={lang}", headers=h).json()
        kids = [s for g in d["cohorts"] for s in g["students"]] + d["not_assessed"]
        assert [s["review_checkin_id"] for s in kids] == [c["id"]]


def test_create_schema_adds_columns_to_tables_an_older_version_made(tmp_path):
    from sqlalchemy import create_engine, inspect, text

    from app.db import create_schema

    old = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with old.begin() as conn:
        conn.execute(text("CREATE TABLE classrooms (id VARCHAR(32) PRIMARY KEY, name VARCHAR(120))"))
        conn.execute(text("CREATE TABLE students (id VARCHAR(32) PRIMARY KEY, first_name VARCHAR(80))"))
    create_schema(old)
    create_schema(old)  # the next start finds nothing to add
    for table in ("classrooms", "students"):
        assert "names" in {c["name"] for c in inspect(old).get_columns(table)}
    old.dispose()


def test_older_databases_move_to_per_language_levels(db):
    # Before per-language levels: one level and one group on the student row.
    t = Teacher(login="old", name="Old", pin_hash="x")
    cls = Classroom(teacher=t, name="Class 2", grade=2, language="hi")
    s = Student(classroom=cls, first_name="Meena", provisional_level="letter", cohort_override="word")
    db.add_all([t, cls, s])
    db.flush()
    db.add(Checkin(student_id=s.id, language="hi", start_level="word", status="scored", level_final="letter"))
    db.commit()

    assert migrate_levels(db) == 1
    row = db.get(StudentLevel, (s.id, "hi"))
    assert (row.provisional_level, row.confirmed_level, row.cohort_override) == ("letter", None, "word")
    assert s.cohort_override is None  # moved, so clearing the group later sticks
    assert migrate_levels(db) == 0  # once only
