"""Each child is tested in their regional language and in English, as in ASER: separate ladders, levels and groups."""

from app.content import reading_languages
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
    assert reading_languages("mr") == ["en"]  # no Marathi item bank yet


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
