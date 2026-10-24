"""Check-in lifecycle: adaptive ASER ladder, item scoring, teacher review and overrides, level updates.

Levels are never edited in place: a student's provisional/confirmed levels are replayed from their finished
check-ins in order (two agreeing check-ins confirm; a teacher override sets both). So a late teacher correction
of any check-in leaves the history consistent.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..content import Item, available_languages, get_item, pick_item
from ..levels.aser_rules import (
    ITEM_LEVELS,
    LEVEL_ORDER,
    ItemOutcome,
    level_from_outcomes,
    next_item_level,
    start_level,
    update_levels,
)
from ..models import Checkin, ItemResult, LevelHistory, Student, Teacher, utcnow
from ..speech.align import tokenize
from ..speech.scorer import ItemScore, score_item

FINISHED = ("needs_review", "scored")


def owned_student(db: Session, teacher: Teacher, student_id: str) -> Student:
    s = db.get(Student, student_id)
    if s is None or s.classroom.teacher_id != teacher.id:
        raise HTTPException(404, "student not found")
    return s


def owned_checkin(db: Session, teacher: Teacher, checkin_id: str) -> Checkin:
    c = db.get(Checkin, checkin_id)
    if c is None or c.student.classroom.teacher_id != teacher.id:
        raise HTTPException(404, "check-in not found")
    return c


# ---------------------------------------------------------------- ladder


def scores(checkin: Checkin) -> list[ItemScore]:
    return [ItemScore.from_dict(r.result) for r in checkin.items]


def _recent_item_ids(db: Session, checkin: Checkin) -> set[str]:
    """Items from this check-in and the student's previous one, so the child does not re-read the same text."""
    prev = db.scalars(
        select(Checkin)
        .where(Checkin.student_id == checkin.student_id, Checkin.id != checkin.id, Checkin.status.in_(FINISHED))
        .order_by(Checkin.started_at.desc())
        .limit(1)
    ).first()
    ids = {r.item_id for r in checkin.items}
    if prev:
        ids |= {r.item_id for r in prev.items}
    return ids


def awaiting_review(checkin: Checkin) -> bool:
    """An item's uncertain words could flip it: the teacher confirms them before the ladder moves on, because the
    next rung depends on that item's pass/fail."""
    return checkin.status == "in_progress" and any(r.needs_review for r in checkin.items)


def placed_level(outcomes: list[ItemOutcome]) -> str | None:
    """ASER level from the items read, or None if they do not place the child: nothing passed and letters were
    never tried (e.g. a paragraph failed and the session ended) is not 'beginner'."""
    level = level_from_outcomes(outcomes)
    if level == "beginner" and not any(o.item_level == "letter" for o in outcomes):
        return None
    return level


def next_item(db: Session, checkin: Checkin) -> Item | None:
    if checkin.status != "in_progress" or awaiting_review(checkin):
        return None
    level = next_item_level([s.outcome() for s in scores(checkin)], checkin.start_level)
    return pick_item(checkin.language, level, _recent_item_ids(db, checkin)) if level else None


def start(db: Session, teacher: Teacher, student_id: str, language: str | None, local_id: str | None,
          ladder_start: str | None = None) -> Checkin:
    """`ladder_start` comes from a check-in run offline on the phone: the server keeps the phone's starting rung so
    the uploaded items line up with the same ladder."""
    student = owned_student(db, teacher, student_id)
    if local_id:
        existing = db.scalar(select(Checkin).where(Checkin.local_id == local_id))
        if existing is not None:
            return existing
    lang = language or student.home_lang or student.classroom.language
    if lang not in available_languages():
        raise HTTPException(422, f"no item bank for language {lang!r}")
    if ladder_start is not None and (local_id is None or ladder_start not in ITEM_LEVELS):
        raise HTTPException(422, "start_level is only for offline check-ins and must be an item level")
    c = Checkin(student_id=student.id, language=lang, local_id=local_id, status="in_progress",
                start_level=ladder_start or start_level(student.grade, student.confirmed_level))
    db.add(c)
    db.commit()
    return c


def _expect_item(db: Session, checkin: Checkin, item_id: str) -> Item:
    if checkin.status != "in_progress":
        raise HTTPException(409, f"check-in is {checkin.status}")
    if awaiting_review(checkin):
        raise HTTPException(409, "confirm the uncertain words first")
    try:
        item = get_item(item_id)
    except KeyError:
        raise HTTPException(422, f"unknown item {item_id!r}") from None
    expected = next_item(db, checkin)
    if expected is None:
        raise HTTPException(409, "the ladder is complete; finish the check-in")
    if item.lang != checkin.language or item.level != expected.level:
        raise HTTPException(409, f"expected a {expected.level} item in {checkin.language}")
    return item


def _store(db: Session, checkin: Checkin, item: Item, score: ItemScore, source: str,
           offline_marks: list[bool] | None = None) -> ItemResult:
    ir = ItemResult(checkin_id=checkin.id, position=len(checkin.items), item_id=item.id, item_level=item.level,
                    source=source, duration_ms=score.duration_ms or None, result=score.to_dict(),
                    passed=score.passed, needs_review=score.needs_review, offline_marks=offline_marks)
    db.add(ir)
    checkin.items.append(ir)
    if source == "offline_marks":
        checkin.source = "offline_marks"
    return ir


async def add_audio(db: Session, checkin: Checkin, item_id: str, data: bytes, suffix: str) -> tuple[ItemScore, ItemResult | None]:
    """Score one recorded item. On re-record / speech failure nothing is stored and the same item stays next."""
    item = _expect_item(db, checkin, item_id)
    score = await score_item(data, item, suffix=suffix, allow_gemini=settings.gemini_for_children)
    if score.status != "scored":
        return score, None
    ir = _store(db, checkin, item, score, "ai")
    if settings.keep_audio:
        folder = settings.speech_cache_dir.parent / "audio"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{checkin.id}_{ir.position}_{item.id}{suffix}"
        path.write_bytes(data)
        ir.audio_kept_path = str(Path(path).name)
    db.commit()
    return score, ir


def add_marks(db: Session, checkin: Checkin, item_id: str, marks: list[bool], duration_ms: int | None) -> ItemResult:
    """Teacher tap-to-mark (offline or when the speech services are down): one boolean per letter/word."""
    item = _expect_item(db, checkin, item_id)
    ref = tokenize(item.text, item.lang)
    if len(marks) != len(ref):
        raise HTTPException(422, f"expected {len(ref)} marks for {item.id}, got {len(marks)}")
    words = [{"i": i, "ref": r, "label": "correct" if m else "sub", "uncertain": False, "heard": {}, "labels": {},
              "pa": None, "start_ms": None, "end_ms": None, "teacher_correct": bool(m)}
             for i, (r, m) in enumerate(zip(ref, marks))]
    score = ItemScore(item_id=item.id, level=item.level, lang=item.lang, status="scored",
                      duration_ms=duration_ms or 0, reading_ms=duration_ms, words=words).evaluate()
    ir = _store(db, checkin, item, score, "offline_marks", offline_marks=list(marks))
    db.commit()
    return ir


async def attach_audio(db: Session, checkin: Checkin, ir: ItemResult, data: bytes, suffix: str) -> ItemScore:
    """Score the recording of an item that was tap-marked offline, after it syncs.

    The AI result replaces the marks-only result (so the diagnosis gets what was heard), but the teacher's mark is
    a second opinion on every word: wherever mark and AI disagree, the word becomes uncertain for the teacher to
    confirm, exactly like two speech paths disagreeing. The ladder that was run offline is left alone; if a
    disagreement could flip an item, the check-in goes to needs_review (or reopens) through the usual settling.
    """
    if ir.source != "offline_marks" or ir.offline_marks is None:
        raise HTTPException(409, "only tap-marked items take a later recording")
    if ir.result.get("ai_scored"):
        return ItemScore.from_dict(ir.result)  # already scored: a retried upload is a no-op
    item = get_item(ir.item_id)
    score = await score_item(data, item, suffix=suffix, allow_gemini=settings.gemini_for_children)
    if score.status != "scored":  # the marks stand; note why the recording did not help
        ir.result = {**ir.result, "audio_note": f"{score.status}: {score.reason}"}
        db.commit()
        return ItemScore.from_dict(ir.result)
    marks = ir.offline_marks
    for w, mark in zip(score.words, marks):
        w["teacher_mark"] = bool(mark)
        if bool(mark) != (w["label"] in ("correct", "self_correct")):
            w["uncertain"] = True
    score.ai_scored = True
    score.evaluate()
    ir.result, ir.passed, ir.needs_review = score.to_dict(), score.passed, score.needs_review
    if checkin.status in FINISHED or checkin.teacher_overrode:
        _settle(db, checkin)
    db.commit()
    return score


# ---------------------------------------------------------------- finishing, review, overrides


def _settle(db: Session, checkin: Checkin) -> None:
    """Decide what the finished check-in counts as.

    override -> scored with the teacher's level; an item still needs review -> needs_review, no level yet;
    the items do not place the child (a correction failed an item the ladder had passed) -> reopened
    (in_progress) so the next rung can be read; otherwise scored with the ASER level.
    """
    checkin.level_suggested = placed_level([s.outcome() for s in scores(checkin)])
    if checkin.teacher_overrode:
        checkin.status = "scored"
    elif any(r.needs_review for r in checkin.items):
        checkin.status, checkin.level_final = "needs_review", None
    elif checkin.level_suggested is None:
        checkin.status, checkin.level_final = "in_progress", None
    else:
        checkin.status, checkin.level_final = "scored", checkin.level_suggested
    checkin.scored_at = checkin.scored_at or utcnow()
    replay_levels(db, checkin.student, checkin, "teacher" if checkin.teacher_overrode else checkin.source)


def finish(db: Session, checkin: Checkin) -> Checkin:
    if checkin.status in FINISHED:
        return checkin
    if checkin.status != "in_progress":
        raise HTTPException(409, f"check-in is {checkin.status}")
    if not checkin.items:
        raise HTTPException(409, "no items were read")
    if not awaiting_review(checkin) and placed_level([s.outcome() for s in scores(checkin)]) is None:
        raise HTTPException(409, "these items do not place the child yet: read the next item or set the level")
    _settle(db, checkin)
    db.commit()
    return checkin


def review(db: Session, checkin: Checkin, marks: list[tuple[str, int, bool]]) -> Checkin:
    """Teacher taps: (item_result_id, word index, read correctly?). Any word may be corrected, not only uncertain ones."""
    by_id = {r.id: r for r in checkin.items}
    edited: dict[str, ItemScore] = {}
    for ir_id, i, correct in marks:
        if ir_id not in by_id:
            raise HTTPException(422, f"item result {ir_id} is not in this check-in")
        s = edited.setdefault(ir_id, ItemScore.from_dict(by_id[ir_id].result))
        if not 0 <= i < len(s.words):
            raise HTTPException(422, f"word index {i} out of range for {by_id[ir_id].item_id}")
        s.words[i]["teacher_correct"] = bool(correct)
    for ir_id, s in edited.items():
        s.evaluate()
        ir = by_id[ir_id]
        ir.result, ir.passed, ir.needs_review = s.to_dict(), s.passed, s.needs_review
    if checkin.status in FINISHED or checkin.teacher_overrode:
        _settle(db, checkin)
    db.commit()
    return checkin


def override(db: Session, checkin: Checkin, level: str | None) -> Checkin:
    """Teacher sets the level (None clears the override). Logged; the teacher's judgement always wins, including
    on a check-in the child could not finish."""
    if checkin.status == "abandoned" or not checkin.items:
        raise HTTPException(409, "nothing to override")
    if level is None:
        checkin.teacher_overrode = False
    else:
        if level not in LEVEL_ORDER:
            raise HTTPException(422, f"unknown level {level!r}")
        checkin.teacher_overrode, checkin.level_final = True, level
    _settle(db, checkin)
    db.commit()
    return checkin


def replay_levels(db: Session, student: Student, cause: Checkin | None = None, source: str = "ai") -> None:
    """Recompute provisional/confirmed from the student's counted check-ins, oldest first, and log the change.
    Queries the database rather than `student.checkins`, which may be a stale in-session collection."""
    db.flush()
    rows = db.scalars(select(Checkin).where(Checkin.student_id == student.id).order_by(Checkin.started_at))
    prov = conf = None
    for c in rows:
        if c.status != "scored" or c.level_final is None:
            continue
        if c.teacher_overrode:
            prov = conf = c.level_final
        else:
            prov, conf = update_levels(prov, conf, c.level_final)
    if (prov, conf) != (student.provisional_level, student.confirmed_level):
        student.provisional_level, student.confirmed_level = prov, conf
        db.add(LevelHistory(student_id=student.id, checkin_id=cause.id if cause else None,
                            provisional=prov, confirmed=conf, source=source))
