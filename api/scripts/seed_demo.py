"""Seed the demo: test logins and a Grade 2 Hindi class with two weeks of check-in history.

    cd api
    .venv/Scripts/python -m scripts.seed_demo            # refuses if the demo teacher already exists
    .venv/Scripts/python -m scripts.seed_demo --reset    # drop and recreate every table first

Children are fictional (first names only). Their check-ins are synthetic: the item results look like real scored
readings (per-word labels and what was "heard", with a typical error pattern per child) and go through the same
ladder, level replay and rule-based diagnosis code as live check-ins. No audio and no vendor calls.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import timedelta

from app.auth import hash_pin
from app.content import Item, items, pick_item
from app.db import Base, SessionLocal, engine
from app.levels.aser_rules import LEVEL_ORDER, next_item_level
from app.llm import diagnose as diag
from app.models import Classroom, Student, Teacher, utcnow
from app.services import checkins as svc
from app.speech.align import graphemes, tokenize
from app.speech.scorer import ItemScore

LOGINS = [("demo", "डेमो शिक्षक / Demo Teacher", "1234"), ("judge", "Evaluator", "2026")]

# name, avatar, levels the two past check-ins should land on (None = no check-in), error profile
CHILDREN = [
    ("आरव", "🦁", ["beginner", "beginner"], "letter"),
    ("सना", "🐰", ["letter", "letter"], "letter"),
    ("इमरान", "🐯", ["letter", "word"], "matra"),
    ("दीया", "🦋", [None, "letter"], "letter"),
    ("मीना", "🌻", ["word", "word"], "matra"),
    ("रवि", "🐘", ["word", "word"], "blending"),
    ("कबीर", "🐢", ["word", "word"], "matra"),
    ("पूजा", "🐦", ["word", "word"], "guessing"),
    ("रोहन", "🐬", ["paragraph", "word"], "blending"),
    ("नेहा", "🌈", [None, "word"], "matra"),
    ("प्रिया", "🐼", ["word", "word"], "fluency"),  # accurate but halting: ASER does not count it as paragraph
    ("अर्जुन", "🦅", ["story", "story"], "matra"),
    ("काव्या", "🌙", ["paragraph", "paragraph"], "conjunct"),
    ("विक्रम", "🐆", ["paragraph", "story"], "matra"),
    ("अंजलि", "🌸", ["paragraph", "review"], "matra"),
    ("फ़रहान", "⭐", [None, None], "matra"),
]

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


def synthetic(item: Item, passed: bool, profile: str, rng: random.Random, vocab: list[str], *,
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
                heard, label = mutate(r, profile, item.level, rng, vocab), "sub"
        words.append({"i": i, "ref": r, "label": label, "uncertain": False,
                      "heard": {"sarvam": heard, "azure_stt": heard}, "labels": {"sarvam": label, "azure_stt": label},
                      "pa": None, "start_ms": None, "end_ms": None, "teacher_correct": None})
    if uncertain_extra:  # one word the two paths disagree on, enough to flip the paragraph
        k = next(i for i in range(len(ref)) if i not in wrong)
        words[k].update({"uncertain": True, "label": "correct",
                         "heard": {"sarvam": ref[k], "azure_stt": mutate(ref[k], profile, item.level, rng, vocab)},
                         "labels": {"sarvam": "correct", "azure_stt": "sub"}})
    halting = profile == "fluency" and item.level in ("paragraph", "story")
    reading_ms = int(len(ref) * (2600 if halting else rng.uniform(900, 1600)))
    return ItemScore(item.id, item.level, item.lang, "scored", duration_ms=reading_ms + 1500, reading_ms=reading_ms,
                     words=words, hesitations=4 if halting else rng.choice([0, 0, 1]), hesitation_source="audio",
                     primary="sarvam", paths={"sarvam": {"ok": True}, "azure_stt": {"ok": True}}).evaluate()


def run_checkin(db, teacher, student, target: str, profile: str, days_ago: int, rng, vocab) -> None:
    review = target == "review"
    target_level = "paragraph" if review else target
    c = svc.start(db, teacher, student.id, None, None)
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="drop and recreate all tables first")
    ap.add_argument("--if-empty", action="store_true", help="do nothing (exit 0) if the demo teacher exists")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.reset:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    if db.query(Teacher).filter(Teacher.login == "demo").first():
        if args.if_empty:
            print("demo data already present; nothing to do")
            return
        sys.exit("demo data already present (use --reset to start over)")

    rng = random.Random(args.seed)
    vocab = sorted({w for it in items("hi").values() for w in tokenize(it.text, "hi")})
    teachers = []
    for login, name, pin in LOGINS:
        t = Teacher(login=login, name=name, pin_hash=hash_pin(pin), ui_lang="hi")
        db.add(t)
        teachers.append(t)
    db.commit()

    for t in teachers:
        cls = Classroom(teacher_id=t.id, name="कक्षा 2 – अ", grade=2, language="hi")
        db.add(cls)
        db.commit()
        for name, avatar, targets, profile in CHILDREN:
            s = Student(classroom_id=cls.id, first_name=name, avatar=avatar, grade=2)
            db.add(s)
            db.commit()
            for target, days_ago in zip(targets, (14, 4)):
                if target:
                    run_checkin(db, t, s, target, profile, days_ago, rng, vocab)

    for login, _, pin in LOGINS:
        print(f"login: {login:6s} PIN: {pin}")
    for s in teachers[0].classrooms[0].students:
        print(f"  {s.avatar} {s.first_name:8s} provisional={s.provisional_level} confirmed={s.confirmed_level}")
    db.close()


if __name__ == "__main__":
    main()
