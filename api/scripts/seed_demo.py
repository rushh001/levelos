"""Seed the demo: test logins and a Grade 2 class (Hindi + English reading) with two weeks of check-in history.

    cd api
    .venv/Scripts/python -m scripts.seed_demo             # refuses if the demo teacher already exists
    .venv/Scripts/python -m scripts.seed_demo --reset     # drop and recreate every table first
    .venv/Scripts/python -m scripts.seed_demo --if-empty  # on deploy: seed once; later only adds what is missing

Children are fictional (first names only). Each is tested in Hindi and in English, as in ASER. Their check-ins are
synthetic: the item results look like real scored readings (per-word labels and what was "heard", with a typical
error pattern per child and language) and go through the same ladder, level replay and rule-based diagnosis code
as live check-ins. No audio and no vendor calls.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import timedelta

from app.auth import hash_pin
from app.content import Item, items, pick_item
from app.db import Base, SessionLocal, create_schema, engine
from app.levels.aser_rules import LEVEL_ORDER, next_item_level
from app.llm import diagnose as diag
from app.models import Classroom, Student, Teacher, utcnow
from app.services import checkins as svc
from app.speech.align import graphemes, tokenize
from app.speech.scorer import ItemScore

LOGINS = [("demo", "डेमो शिक्षक / Demo Teacher", "1234"), ("judge", "Evaluator", "2026")]

# name, avatar, then per language: levels the two past check-ins should land on (None = no check-in), error profile.
# English is these children's second language, so most read it at a lower level than Hindi.
CHILDREN = [
    ("आरव", "🦁", ["beginner", "beginner"], "letter", ["beginner", "beginner"], "letter"),
    ("सना", "🐰", ["letter", "letter"], "letter", ["beginner", "letter"], "letter"),
    ("इमरान", "🐯", ["letter", "word"], "matra", ["letter", "letter"], "letter"),
    ("दीया", "🦋", [None, "letter"], "letter", [None, "beginner"], "letter"),
    ("मीना", "🌻", ["word", "word"], "matra", ["letter", "word"], "vowel"),
    ("रवि", "🐘", ["word", "word"], "blending", ["letter", "letter"], "blending"),
    ("कबीर", "🐢", ["word", "word"], "matra", ["word", "word"], "vowel"),
    ("पूजा", "🐦", ["word", "word"], "guessing", ["word", "word"], "guessing"),
    ("रोहन", "🐬", ["paragraph", "word"], "blending", ["word", "word"], "blending"),
    ("नेहा", "🌈", [None, "word"], "matra", [None, "letter"], "vowel"),
    # accurate but halting: ASER does not count it as paragraph
    ("प्रिया", "🐼", ["word", "word"], "fluency", ["word", "word"], "fluency"),
    ("अर्जुन", "🦅", ["story", "story"], "matra", ["paragraph", "paragraph"], "sight"),
    ("काव्या", "🌙", ["paragraph", "paragraph"], "conjunct", ["word", "paragraph"], "sight"),
    ("विक्रम", "🐆", ["paragraph", "story"], "matra", ["paragraph", "paragraph"], "vowel"),
    ("अंजलि", "🌸", ["paragraph", "review"], "matra", ["word", "word"], "guessing"),
    ("फ़रहान", "⭐", [None, None], "matra", [None, None], "vowel"),
]
DAYS_AGO = {"hi": (14, 4), "en": (13, 3)}
# Each name in the other script, so the class reads naturally whichever language the app is in.
NAMES_EN = {"आरव": "Aarav", "सना": "Sana", "इमरान": "Imran", "दीया": "Diya", "मीना": "Meena", "रवि": "Ravi",
            "कबीर": "Kabir", "पूजा": "Pooja", "रोहन": "Rohan", "नेहा": "Neha", "प्रिया": "Priya", "अर्जुन": "Arjun",
            "काव्या": "Kavya", "विक्रम": "Vikram", "अंजलि": "Anjali", "फ़रहान": "Farhan"}
CLASS_NAME = "कक्षा 2 – अ"
CLASS_NAMES = {"hi": CLASS_NAME, "en": "Class 2 – A"}

CONFUSABLE = {"ब": "व", "व": "ब", "घ": "ध", "ध": "घ", "म": "भ", "भ": "म", "स": "श", "श": "स", "न": "ल", "ल": "न",
              "प": "फ", "ग": "म", "त": "न", "क": "फ", "र": "व", "ह": "ढ", "ज": "ञ", "द": "ड", "च": "ज"}
MATRA_SWAP = {"ा": "", "ी": "ि", "ि": "ी", "ू": "ु", "ु": "ू", "े": "ै", "ै": "े", "ो": "ौ", "ौ": "ो"}


def mutate(word: str, profile: str, level: str, rng: random.Random, vocab: list[str]) -> str | None:
    if level == "letter" or profile == "letter":
        return CONFUSABLE.get(word, "क" if word != "क" else "फ")
    g = graphemes(word)
    if profile == "conjunct" and "्" in word:
        i = word.index("्")
        return word[:i] + word[i + 2:]
    if profile == "blending" and len(g) >= 3:
        return g[0] + "".join(g[2:])
    if profile == "blending" and len(g) == 2:
        return g[0] + "न" + g[1]
    if profile == "guessing":
        same_start = [v for v in vocab if v != word and graphemes(v)[:1] == g[:1]]
        if same_start:
            return rng.choice(same_start)
    for ch, rep in MATRA_SWAP.items():
        if ch in word:
            return word.replace(ch, rep, 1)
    return word + "ा"


EN_CONFUSABLE = {"b": "d", "d": "b", "p": "q", "q": "p", "m": "n", "n": "m", "u": "n", "h": "n", "g": "q", "e": "a",
                 "a": "e", "o": "a", "c": "e", "r": "n", "l": "i", "s": "z", "t": "f"}
EN_VOWEL_SWAP = {"a": "u", "u": "a", "e": "i", "i": "e", "o": "a"}
EN_SIGHT_SLIPS = {"the": "then", "was": "saw", "said": "sad", "they": "then", "there": "three", "where": "were",
                  "what": "that", "of": "off", "every": "very", "her": "here", "his": "is"}


def mutate_en(word: str, profile: str, level: str, rng: random.Random, vocab: list[str]) -> str | None:
    """Typical early-reader slips in English, shaped like the evidence rules read them (app/llm/evidence.py)."""
    w = word.lower()
    if level == "letter":
        return EN_CONFUSABLE.get(w, "b" if w != "b" else "d")
    if profile == "letter":  # b/d, p/q, m/n on the first letter of a word
        return EN_CONFUSABLE.get(w[0], "b") + w[1:]
    if profile == "sight" and w in EN_SIGHT_SLIPS:
        return EN_SIGHT_SLIPS[w]
    if profile == "blending":  # first and last sound right, the middle lost or an extra sound added
        return w[0] + w[2:] if len(w) >= 4 else w[0] + "r" + w[1:]
    if profile == "guessing":
        same_start = [v for v in vocab if v != w and v[:1] == w[:1]]
        if same_start:
            return rng.choice(same_start)
    for i, ch in enumerate(w):
        if ch in EN_VOWEL_SWAP:
            return w[:i] + EN_VOWEL_SWAP[ch] + w[i + 1:]
    return w + "s"


def mutate_for(item: Item, word: str, profile: str, rng: random.Random, vocab: dict[str, list[str]]) -> str | None:
    if item.lang == "en":
        return mutate_en(word, profile, item.level, rng, vocab["en"])
    return mutate(word, profile, item.level, rng, vocab[item.lang])


def synthetic(item: Item, passed: bool, profile: str, rng: random.Random, vocab: dict[str, list[str]], *,
              uncertain_extra: bool = False) -> ItemScore:
    ref = tokenize(item.text, item.lang)
    if item.level in ("letter", "word"):
        n_wrong = rng.choice([0, 1]) if passed else rng.choice([2, 3])
    elif profile == "fluency":
        n_wrong = rng.choice([0, 1])
    else:
        n_wrong = rng.choice([1, 2]) if passed else rng.choice([5, 6])
    if uncertain_extra:
        n_wrong = 3
    wrong = set(rng.sample(range(len(ref)), n_wrong))
    words = []
    for i, r in enumerate(ref):
        heard = r
        label = "correct"
        if i in wrong:
            if rng.random() < 0.15 and item.level in ("paragraph", "story"):
                heard, label = None, "omit"
            else:
                heard, label = mutate_for(item, r, profile, rng, vocab), "sub"
        words.append({"i": i, "ref": r, "label": label, "uncertain": False,
                      "heard": {"sarvam": heard, "azure_stt": heard}, "labels": {"sarvam": label, "azure_stt": label},
                      "pa": None, "start_ms": None, "end_ms": None, "teacher_correct": None})
    if uncertain_extra:  # one word the two paths disagree on, enough to flip the paragraph
        k = next(i for i in range(len(ref)) if i not in wrong)
        words[k].update({"uncertain": True, "label": "correct",
                         "heard": {"sarvam": ref[k], "azure_stt": mutate_for(item, ref[k], profile, rng, vocab)},
                         "labels": {"sarvam": "correct", "azure_stt": "sub"}})
    halting = profile == "fluency" and item.level in ("paragraph", "story")
    reading_ms = int(len(ref) * (2600 if halting else rng.uniform(900, 1600)))
    return ItemScore(item.id, item.level, item.lang, "scored", duration_ms=reading_ms + 1500, reading_ms=reading_ms,
                     words=words, hesitations=4 if halting else rng.choice([0, 0, 1]), hesitation_source="audio",
                     primary="azure_stt" if item.lang == "en" else "sarvam",
                     paths={"sarvam": {"ok": True}, "azure_stt": {"ok": True}}).evaluate()


def run_checkin(db, teacher, student, language: str, target: str, profile: str, days_ago: int, rng, vocab) -> None:
    review = target == "review"
    target_level = "paragraph" if review else target
    c = svc.start(db, teacher, student.id, language, None)
    c.started_at = utcnow() - timedelta(days=days_ago, hours=rng.randint(0, 4))
    while True:
        outcomes = [s.outcome() for s in svc.scores(c)]
        level = next_item_level(outcomes, c.start_level)
        if level is None:
            break
        item = pick_item(c.language, level, svc._recent_item_ids(db, c))
        passed = LEVEL_ORDER[level] <= LEVEL_ORDER[target_level]
        flip = review and level == "paragraph"
        score = synthetic(item, passed, profile, rng, vocab, uncertain_extra=flip)
        svc._store(db, c, item, score, "ai")
        db.commit()
        if flip:
            break  # the teacher has not confirmed the uncertain word yet
    svc.finish(db, c)
    c.scored_at = c.started_at + timedelta(minutes=3)
    diag.refresh_rules(db, c)
    db.commit()


def seed_history(db, teacher, student, spec, languages, rng, vocab) -> None:
    plan = {"hi": (spec[2], spec[3]), "en": (spec[4], spec[5])}
    for lang in languages:
        targets, profile = plan[lang]
        for target, days_ago in zip(targets, DAYS_AGO[lang]):
            if target:
                run_checkin(db, teacher, student, lang, target, profile, days_ago, rng, vocab)


def upgrade_demo(db, rng, vocab) -> int:
    """A demo seeded by an earlier version: give each demo child the past check-ins of any language they have none
    in yet, and the class and children their English names. Children a teacher added later, languages already
    tested and names already set are left alone. Returns how many children changed."""
    specs = {spec[0]: spec for spec in CHILDREN}
    updated = 0
    for t in db.query(Teacher).filter(Teacher.login.in_([login for login, _, _ in LOGINS])).all():
        for cls in t.classrooms:
            if cls.name == CLASS_NAME and not cls.names:
                cls.names = dict(CLASS_NAMES)
            for s in cls.students:
                spec = specs.get(s.first_name)
                if spec is None:
                    continue
                changed = not s.names
                if changed:
                    s.names = {"hi": s.first_name, "en": NAMES_EN[s.first_name]}
                plan = {"hi": spec[2], "en": spec[4]}
                missing = [lang for lang, targets in plan.items()
                           if any(targets) and not any(c.language == lang for c in s.checkins)]
                if missing:
                    seed_history(db, t, s, spec, missing, rng, vocab)
                updated += changed or bool(missing)
    db.commit()
    return updated


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="drop and recreate all tables first")
    ap.add_argument("--if-empty", action="store_true", help="do nothing (exit 0) if the demo teacher exists")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.reset:
        Base.metadata.drop_all(bind=engine)
    create_schema()
    db = SessionLocal()
    rng = random.Random(args.seed)
    vocab = {lang: sorted({w for it in items(lang).values() for w in tokenize(it.text, lang)}) for lang in ("hi", "en")}
    if db.query(Teacher).filter(Teacher.login == "demo").first():
        if not args.if_empty:
            sys.exit("demo data already present (use --reset to start over)")
        svc.migrate_levels(db)
        updated = upgrade_demo(db, rng, vocab)
        print(f"demo data already present; brought {updated} children up to date" if updated
              else "demo data already present; nothing to do")
        return

    teachers = []
    for login, name, pin in LOGINS:
        t = Teacher(login=login, name=name, pin_hash=hash_pin(pin), ui_lang="en")
        db.add(t)
        teachers.append(t)
    db.commit()

    for t in teachers:
        cls = Classroom(teacher_id=t.id, name=CLASS_NAME, names=dict(CLASS_NAMES), grade=2, language="hi")
        db.add(cls)
        db.commit()
        for spec in CHILDREN:
            s = Student(classroom_id=cls.id, first_name=spec[0], names={"hi": spec[0], "en": NAMES_EN[spec[0]]},
                        avatar=spec[1], grade=2)
            db.add(s)
            db.commit()
            seed_history(db, t, s, spec, ("hi", "en"), rng, vocab)

    for login, _, pin in LOGINS:
        print(f"login: {login:6s} PIN: {pin}")
    for s in teachers[0].classrooms[0].students:
        levels = "  ".join(f"{row.language}: {row.provisional_level}/{row.confirmed_level}" for row in s.levels)
        print(f"  {s.avatar} {s.first_name:8s} {levels}")
    db.close()


if __name__ == "__main__":
    main()
