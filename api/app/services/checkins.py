"""Check-in lifecycle: adaptive ASER ladder, item scoring, teacher review and overrides, level updates.

Levels are never edited in place: a student's provisional/confirmed levels are replayed from their finished
check-ins in order (two agreeing check-ins confirm; a teacher override sets both). So a late teacher correction
of any check-in leaves the history consistent. Each language is replayed on its own: an English check-in moves
only the English level.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..content import Item, available_languages, get_item, pick_item
from ..levels.aser_rules import (
    ITEM_LEVELS,
    LEVEL_ORDER,
    ItemOutcome,
    level_from_outcomes,
    next_item_level,
    one_more_level,
    skipped_outcome,
    start_level,
    update_levels,
)
from ..models import Checkin, ItemAudio, ItemResult, LevelHistory, Student, StudentLevel, Teacher, utcnow
from ..speech import audio as audio_mod
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


def outcomes(checkin: Checkin) -> list[ItemOutcome]:
    """What each card counts as on the ladder: the scored reading, or a skip (which counts for nothing)."""
    return [skipped_outcome(r.item_level) if r.source == "skipped"
            else ItemScore.from_dict(r.result).outcome() for r in checkin.items]


RECENT_CHECKS = 3  # a child does not get a card (or a letter or word) they read in their last three checks


def _recent_reads(db: Session, checkin: Checkin, level: str) -> tuple[set[str], set[str]]:
    """What the child should not get at this rung: the cards they read in this check and their last three in this
    language (a skipped card was never read, so it may come back), the letters or words on those cards, and the card
    the child checked just before them in the class read at this level (they may have heard it)."""
    prev = db.scalars(
        select(Checkin)
        .where(Checkin.student_id == checkin.student_id, Checkin.id != checkin.id, Checkin.status.in_(FINISHED),
               Checkin.language == checkin.language)
        .order_by(Checkin.started_at.desc())
        .limit(RECENT_CHECKS)
    ).all()
    read = [r for c in (checkin, *prev) for r in c.items if r.source != "skipped"]
    ids = {r.item_id for r in read}
    units: set[str] = set()
    for r in read:
        if r.item_level == level:
            try:
                units |= set(get_item(r.item_id).units or ())
            except KeyError:
                pass  # a card no longer in the bank
    neighbour = db.scalar(
        select(ItemResult.item_id).join(Checkin, ItemResult.checkin_id == Checkin.id).join(Student)
        .where(Student.classroom_id == checkin.student.classroom_id, Checkin.student_id != checkin.student_id,
               Checkin.language == checkin.language, ItemResult.item_level == level,
               Checkin.started_at <= checkin.started_at)
        .order_by(Checkin.started_at.desc(), ItemResult.position.desc())
        .limit(1)
    )
    if neighbour:
        ids.add(neighbour)
    return ids, units


def awaiting_review(checkin: Checkin) -> bool:
    """An item's uncertain words could flip it: the teacher confirms them before the ladder moves on, because the
    next rung depends on that item's pass/fail."""
    return checkin.status == "in_progress" and any(r.needs_review for r in checkin.items)


def placed_level(outcomes: list[ItemOutcome]) -> str | None:
    """ASER level from the items read, or None if they do not place the child: nothing passed and letters were
    never tried (e.g. a paragraph failed and the session ended) is not 'beginner'."""
    level = level_from_outcomes(outcomes)
    if level == "beginner" and not any(o.item_level == "letter" and o.skipped is None for o in outcomes):
        return None
    return level


def next_item(db: Session, checkin: Checkin, one_more: bool = False) -> Item | None:
    """The card the ladder asks for next; `one_more`: the one more card the teacher may give after the ladder ended
    on a fail (aser_rules.one_more_level)."""
    if checkin.status != "in_progress" or awaiting_review(checkin):
        return None
    rule = one_more_level if one_more else next_item_level
    level = rule(outcomes(checkin), checkin.start_level, fixed=bool(checkin.fixed_level))
    if not level:
        return None
    # Seeded by the check and its position: asked again, the check gets the same card back.
    ids, units = _recent_reads(db, checkin, level)
    return pick_item(checkin.language, level, ids, seed=f"{checkin.id}:{len(checkin.items)}", avoid_units=units)


def _start_for(student, lang: str) -> tuple[str, bool]:
    """Where a new check in `lang` begins, and whether it reads only that level (the teacher chose the group)."""
    row = student.level_in(lang)
    last = (row.confirmed_level or row.provisional_level) if row else None
    group = row.cohort_override if row else None
    others = [r.confirmed_level or r.provisional_level for r in student.levels if r.language != lang]
    return start_level(student.grade, last, group, [lv for lv in others if lv]), group is not None


def refresh_start(db: Session, checkin: Checkin) -> None:
    """An unfinished check follows the teacher's current choice when it is opened again ("Not finished"); a phone's
    offline check keeps its own ladder.

    Nothing read yet (no card, or only skipped ones, which count for nothing): it starts over under the current rule,
    the skips cleared. Cards already read: if the teacher has since chosen the group, the check gives that group's
    card next (unless it was already tried) and then ends; the level still comes from every card read."""
    if checkin.status != "in_progress" or checkin.local_id:
        return
    level, fixed = _start_for(checkin.student, checkin.language)
    read = [r for r in checkin.items if r.source != "skipped"]
    changed = False
    if not read:
        for r in list(checkin.items):  # skips only: nothing to keep
            db.delete(r)
            changed = True
        if (checkin.start_level, bool(checkin.fixed_level)) != (level, fixed):
            checkin.start_level, checkin.fixed_level = level, fixed
            changed = True
    elif fixed and (checkin.start_level, bool(checkin.fixed_level)) != (level, True):
        checkin.start_level, checkin.fixed_level = level, True
        changed = True
    if changed:
        db.commit()
        db.expire(checkin, ["items"])


def start(db: Session, teacher: Teacher, student_id: str, language: str | None, local_id: str | None,
          ladder_start: str | None = None, fixed_level: bool = False, started_at: datetime | None = None) -> Checkin:
    """`ladder_start` (and `fixed_level`) come from a check-in run offline on the phone: the server keeps the phone's
    starting rung so the uploaded items line up with the same ladder. `started_at` (offline too): when the check was
    done on the phone, so it is dated that day and counts in its place among the child's checks, not when it was sent
    (never later than now, and a year at most)."""
    student = owned_student(db, teacher, student_id)
    if local_id:
        existing = db.scalar(select(Checkin).where(Checkin.local_id == local_id))
        if existing is not None:
            return existing
    lang = language or student.main_language
    if lang not in available_languages():
        raise HTTPException(422, f"no item bank for language {lang!r}")
    if ladder_start is not None and (local_id is None or ladder_start not in ITEM_LEVELS):
        raise HTTPException(422, "start_level is only for offline check-ins and must be an item level")
    level, fixed = (ladder_start, fixed_level) if ladder_start else _start_for(student, lang)
    when = None
    if local_id and started_at is not None:
        started_at = started_at if started_at.tzinfo else started_at.replace(tzinfo=timezone.utc)
        if started_at > utcnow() - timedelta(days=365):
            when = min(started_at, utcnow())
    c = Checkin(student_id=student.id, language=lang, local_id=local_id, status="in_progress",
                start_level=level, fixed_level=fixed, **({"started_at": when} if when else {}))
    db.add(c)
    db.commit()
    return c


def _expect_item(db: Session, checkin: Checkin, item_id: str, one_more: bool = False) -> Item:
    if checkin.status != "in_progress":
        raise HTTPException(409, f"check-in is {checkin.status}")
    if awaiting_review(checkin):
        raise HTTPException(409, "confirm the uncertain words first")
    try:
        item = get_item(item_id)
    except KeyError:
        raise HTTPException(422, f"unknown item {item_id!r}") from None
    expected = next_item(db, checkin, one_more)
    if expected is None:
        raise HTTPException(409, "no more card to give; finish the check-in" if one_more
                            else "the ladder is complete; finish the check-in")
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


def purge_audio(db: Session) -> int:
    """Delete recordings older than the retention period (all of them if retention is 0)."""
    cutoff = utcnow() - timedelta(days=max(settings.audio_retention_days, 0))
    return db.execute(delete(ItemAudio).where(ItemAudio.created_at < cutoff)).rowcount or 0


def delete_audio(db: Session, checkin: Checkin) -> int:
    ids = [r.id for r in checkin.items]
    n = db.execute(delete(ItemAudio).where(ItemAudio.item_result_id.in_(ids))).rowcount or 0
    db.commit()
    db.expire_all()
    return n


async def _keep_recording(db: Session, ir: ItemResult, data: bytes, suffix: str) -> None:
    """Playback copy for the teacher. Best effort: scoring has already succeeded, replay is a convenience."""
    if settings.audio_retention_days <= 0:
        return
    try:
        mp3 = await asyncio.to_thread(audio_mod.to_mp3, data, suffix)
    except audio_mod.AudioError:
        return
    if ir.audio is None:
        ir.audio = ItemAudio(item_result_id=ir.id, mime="audio/mpeg", size=len(mp3), data=mp3)
    else:
        ir.audio.data, ir.audio.size, ir.audio.created_at = mp3, len(mp3), utcnow()
    purge_audio(db)


async def add_audio(db: Session, checkin: Checkin, item_id: str, data: bytes, suffix: str) -> tuple[ItemScore, ItemResult | None]:
    """Score one recorded item. On re-record / speech failure nothing is stored and the same item stays next."""
    item = _expect_item(db, checkin, item_id)
    score = await score_item(data, item, suffix=suffix, allow_gemini=settings.gemini_for_children)
    if score.status != "scored":
        return score, None
    ir = _store(db, checkin, item, score, "ai")
    db.flush()  # assigns ir.id
    await _keep_recording(db, ir, data, suffix)
    if settings.keep_audio:
        folder = settings.speech_cache_dir.parent / "audio"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{checkin.id}_{ir.position}_{item.id}{suffix}"
        path.write_bytes(data)
        ir.audio_kept_path = str(Path(path).name)
    db.commit()
    return score, ir


def _signature(teacher_id: str, item_id: str, score_json: str) -> str:
    msg = f"{teacher_id}|{item_id}|{score_json}".encode("utf-8")
    return hmac.new(settings.jwt_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


async def preview_score(teacher: Teacher, item_id: str, data: bytes, suffix: str) -> tuple[ItemScore, str | None, str | None]:
    """Score one card's recording for a check running on the phone, without creating a check: the phone shows the
    AI's marks for the teacher to confirm and keeps the result. Returns (score, score_json, signature). The phone
    sends `score_json` and its signature back with the teacher's marks when the check syncs, so the recording is
    never paid for twice and the phone cannot make up an AI result. Nothing is signed unless it was scored."""
    try:
        item = get_item(item_id)
    except KeyError:
        raise HTTPException(422, f"unknown item {item_id!r}") from None
    # Preview retries must reuse paid results in every environment. This is separate from the
    # optional vendor response cache used by the other scoring paths.
    key = hashlib.sha256(data + json.dumps([item_id, suffix]).encode()).hexdigest()
    stored = settings.speech_cache_dir / "preview" / f"{key}.json"
    try:
        score = ItemScore.from_dict(json.loads(stored.read_text(encoding="utf-8")))
    except FileNotFoundError:
        score = await score_item(data, item, suffix=suffix, allow_gemini=settings.gemini_for_children)
        if score.status == "scored":
            stored.parent.mkdir(parents=True, exist_ok=True)
            # Readers never see partially written JSON.
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=stored.parent, delete=False) as out:
                temporary = out.name
                json.dump(score.to_dict(), out, ensure_ascii=False)
            try:
                os.replace(temporary, stored)
            finally:
                Path(temporary).unlink(missing_ok=True)
    if score.status != "scored":
        return score, None, None
    score_json = json.dumps(score.to_dict(), ensure_ascii=False, separators=(",", ":"))
    return score, score_json, _signature(teacher.id, item_id, score_json)


def _verified_ai(teacher_id: str, item_id: str, score_json: str | None, sig: str | None) -> ItemScore | None:
    if not score_json and not sig:
        return None
    if not score_json or not sig or not hmac.compare_digest(_signature(teacher_id, item_id, score_json), sig):
        raise HTTPException(422, "the AI result sent with these marks is not one this server made")
    return ItemScore.from_dict(json.loads(score_json))


def add_marks(db: Session, checkin: Checkin, item_id: str, marks: list[bool], duration_ms: int | None,
              hesitations: int | None = None, ai_json: str | None = None, ai_sig: str | None = None,
              one_more: bool = False) -> ItemResult:
    """Teacher tap-to-mark (offline or when the speech services are down): one boolean per letter/word.
    `duration_ms` and `hesitations` come from the phone's own measure of the recording (reading time and long
    pauses, the same rules as `speech.audio`), so the server's ladder lands where the phone's did.

    With `ai_json`/`ai_sig` (a result from `preview_score`): the AI marked the card on the phone and the teacher
    confirmed or changed each word before saving. The AI result is kept (what was heard, word timings) with the
    teacher's mark settling every word, and the card is stored as AI-scored: its recording, uploaded after, is kept
    for replay but not scored again."""
    item = _expect_item(db, checkin, item_id, one_more)
    ref = tokenize(item.text, item.lang)
    if len(marks) != len(ref):
        raise HTTPException(422, f"expected {len(ref)} marks for {item.id}, got {len(marks)}")
    ai = _verified_ai(checkin.student.classroom.teacher_id, item_id, ai_json, ai_sig)
    if ai is not None:
        if ai.item_id != item.id or len(ai.words) != len(marks):
            raise HTTPException(422, "the AI result is for another card")
        for w, m in zip(ai.words, marks):
            w["teacher_mark"] = bool(m)
            w["teacher_correct"] = bool(m)  # the teacher saw the AI's mark and settled the word
            w["uncertain"] = False
        # The phone ran the ladder on its own measure of reading time and pauses: the server counts the same, or
        # a passage near a threshold could pass on one side and fail on the other and the cards would not line up.
        # (The AI's word timings stay in the words, for replay.)
        if duration_ms:
            ai.reading_ms = duration_ms
        if hesitations is not None:
            ai.hesitations, ai.hesitation_source = hesitations, "phone"
        ai.ai_scored = True
        ai.retry = one_more
        ir = _store(db, checkin, item, ai.evaluate(), "ai", offline_marks=list(marks))
        db.commit()
        return ir
    words = [{"i": i, "ref": r, "label": "correct" if m else "sub", "uncertain": False, "heard": {}, "labels": {},
              "pa": None, "start_ms": None, "end_ms": None, "teacher_correct": bool(m)}
             for i, (r, m) in enumerate(zip(ref, marks))]
    score = ItemScore(item_id=item.id, level=item.level, lang=item.lang, status="scored",
                      duration_ms=duration_ms or 0, reading_ms=duration_ms, words=words,
                      hesitations=hesitations, hesitation_source="phone" if hesitations is not None else None,
                      retry=one_more).evaluate()
    ir = _store(db, checkin, item, score, "offline_marks", offline_marks=list(marks))
    db.commit()
    return ir


def skip_item(db: Session, checkin: Checkin, item_id: str) -> ItemResult:
    """The teacher skips the card instead of making the child read it. It counts for nothing: not a pass, not a
    fail; no words, no recording, nothing for the diagnosis. The ladder moves to the nearest card not tried yet."""
    item = _expect_item(db, checkin, item_id)
    result = {"item_id": item.id, "level": item.level, "lang": item.lang, "status": "skipped", "skipped": True,
              "words": [], "extras": [], "counts": {"total": 0, "correct": 0, "errors": 0}, "hesitations": None,
              "wcpm": None, "passed": None, "needs_review": False}
    ir = ItemResult(checkin_id=checkin.id, position=len(checkin.items), item_id=item.id, item_level=item.level,
                    source="skipped", result=result, passed=None, needs_review=False)
    db.add(ir)
    checkin.items.append(ir)
    db.commit()
    return ir


async def attach_audio(db: Session, checkin: Checkin, ir: ItemResult, data: bytes, suffix: str) -> ItemScore:
    """Score the recording of an item that was tap-marked offline, after it syncs.

    The AI result replaces the marks-only result (so the diagnosis gets what was heard), but the teacher's mark is
    a second opinion on every word: wherever mark and AI disagree, the word becomes uncertain for the teacher to
    confirm, exactly like two speech paths disagreeing. The ladder that was run offline is left alone; if a
    disagreement could flip an item, the check-in goes to needs_review (or reopens) through the usual settling.
    """
    if ir.offline_marks is None:
        raise HTTPException(409, "only cards marked on the phone take a later recording")
    if ir.result.get("ai_scored"):
        # Scored already (on the phone, before the teacher confirmed it, or by an earlier upload): keep the
        # recording for replay if it is not kept yet, never score it again.
        if ir.audio is None:
            await _keep_recording(db, ir, data, suffix)
            db.commit()
        return ItemScore.from_dict(ir.result)
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
    await _keep_recording(db, ir, data, suffix)
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
    checkin.level_suggested = placed_level(outcomes(checkin))
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
    if not awaiting_review(checkin) and placed_level(outcomes(checkin)) is None:
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


def level_row(student: Student, language: str) -> StudentLevel:
    row = student.level_in(language)
    if row is None:
        row = StudentLevel(language=language)
        student.levels.append(row)
    return row


def replay_levels(db: Session, student: Student, cause: Checkin | None = None, source: str = "ai",
                  language: str | None = None, log: bool = True) -> None:
    """Recompute one language's provisional/confirmed from the student's counted check-ins in that language (the
    language of `cause` by default), oldest first, and log the change. Queries the database rather than
    `student.checkins`, which may be a stale in-session collection."""
    lang = language or (cause.language if cause else student.main_language)
    db.flush()
    rows = db.scalars(select(Checkin).where(Checkin.student_id == student.id, Checkin.language == lang)
                      .order_by(Checkin.started_at))
    prov = conf = None
    for c in rows:
        if c.status != "scored" or c.level_final is None:
            continue
        if c.teacher_overrode:
            prov = conf = c.level_final
        else:
            prov, conf = update_levels(prov, conf, c.level_final)
    row = student.level_in(lang)
    if (prov, conf) != ((row.provisional_level, row.confirmed_level) if row else (None, None)):
        row = row or level_row(student, lang)
        row.provisional_level, row.confirmed_level = prov, conf
        if log:
            db.add(LevelHistory(student_id=student.id, checkin_id=cause.id if cause else None,
                                provisional=prov, confirmed=conf, source=source))


def migrate_levels(db: Session) -> int:
    """Databases from before per-language levels kept one level and group per child. Give each language a child has
    check-ins in its own level row (replayed from those check-ins) and move the teacher's group choice to the
    child's main language. Runs at startup (hackathon scale: every child is looked at); a no-op once done.
    Returns how many children changed."""
    changed = 0
    for s in db.scalars(select(Student)).all():
        rows_before = len(s.levels)
        for lang in sorted({c.language for c in s.checkins} - {row.language for row in s.levels}):
            replay_levels(db, s, language=lang, log=False)
        moved = s.cohort_override is not None
        if moved:
            level_row(s, s.main_language).cohort_override = s.cohort_override
            s.cohort_override = None  # moved, so a group the teacher clears later stays cleared
        changed += moved or len(s.levels) != rows_before
    db.commit()
    return changed
