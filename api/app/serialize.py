"""Model -> JSON shapes for the API."""

from __future__ import annotations

from .content import Item, instructions, reading_languages
from .levels.aser_rules import cohort_for_level, effective_level
from .models import Checkin, Classroom, Diagnosis, ItemResult, Student, Teacher


def teacher_out(t: Teacher) -> dict:
    return {"id": t.id, "login": t.login, "name": t.name, "ui_lang": t.ui_lang}


def level_out(s: Student, language: str) -> dict:
    row = s.level_in(language)
    level, confirmed = effective_level(row.provisional_level if row else None, row.confirmed_level if row else None)
    override = row.cohort_override if row else None
    return {
        "provisional_level": row.provisional_level if row else None,
        "confirmed_level": row.confirmed_level if row else None,
        "level": level,
        "level_confirmed": confirmed,
        "cohort": override or cohort_for_level(level),
        "cohort_override": override,
    }


def student_languages(s: Student) -> list[str]:
    return reading_languages(s.main_language) or [s.main_language]


def student_out(s: Student, language: str | None = None) -> dict:
    """Level, group, check-in count and latest diagnosis in one reading language (`language` if the child is tested
    in it, else their main language); `levels` has every language the child is tested in."""
    langs = student_languages(s)
    lang = language if language in langs else langs[0]
    finished = [c for c in s.checkins if c.status in ("scored", "needs_review") and c.language == lang]
    last = finished[-1] if finished else None
    review = next((c for c in reversed(s.checkins) if c.status == "needs_review"), None)
    return {
        "id": s.id,
        "first_name": s.first_name,
        "names": s.names or {},
        "avatar": s.avatar,
        "grade": s.grade,
        "home_lang": s.home_lang,
        "assessment_language": s.main_language,
        "language": lang,
        "languages": langs,
        **level_out(s, lang),
        "levels": {code: level_out(s, code) for code in langs},
        "checkins": len(finished),
        "last_checkin_at": last.started_at.isoformat() if last else None,
        "pending_review": review is not None,
        "review_checkin_id": review.id if review else None,  # the check waiting for the teacher's confirmation
        "patterns": (last.diagnosis.error_patterns if last and last.diagnosis else []),
    }


def classroom_out(c: Classroom, *, students: bool = False) -> dict:
    out = {"id": c.id, "name": c.name, "names": c.names or {}, "grade": c.grade, "language": c.language,
           "languages": reading_languages(c.language) or [c.language], "students_count": len(c.students)}
    if students:
        out["students"] = [student_out(s) for s in c.students]
    return out


def item_out(item: Item | None) -> dict | None:
    if item is None:
        return None
    return {**item.public(), "instructions": instructions(item.lang).get(item.level, {})}


def item_result_out(ir: ItemResult) -> dict:
    return {
        "id": ir.id,
        "position": ir.position,
        "item_id": ir.item_id,
        "item_level": ir.item_level,
        "source": ir.source,
        "passed": ir.passed,
        "needs_review": ir.needs_review,
        "has_audio": ir.audio is not None,
        "result": ir.result,
    }


def diagnosis_out(d: Diagnosis | None) -> dict | None:
    if d is None:
        return None
    return {"error_patterns": d.error_patterns, "evidence": d.evidence, "summary": d.summary,
            "confidence": d.confidence, "model": d.model, "created_at": d.created_at.isoformat()}


def checkin_out(c: Checkin, next_item: Item | None = None) -> dict:
    return {
        "id": c.id,
        "student_id": c.student_id,
        "local_id": c.local_id,
        "language": c.language,
        "main_language": c.student.main_language,  # the child's regional test: the app's other language
        "status": c.status,
        "source": c.source,
        "start_level": c.start_level,
        "level_suggested": c.level_suggested,
        "level_final": c.level_final,
        "teacher_overrode": c.teacher_overrode,
        "started_at": c.started_at.isoformat(),
        "scored_at": c.scored_at.isoformat() if c.scored_at else None,
        "items": [item_result_out(r) for r in c.items],
        # The teacher must confirm the uncertain words of an item before the ladder can move on.
        "awaiting_review": c.status == "in_progress" and any(r.needs_review for r in c.items),
        "next_item": item_out(next_item),
        "diagnosis": diagnosis_out(c.diagnosis),
    }
