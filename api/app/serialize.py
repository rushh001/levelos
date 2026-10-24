"""Model -> JSON shapes for the API."""

from __future__ import annotations

from .content import Item, instructions
from .levels.aser_rules import cohort_for_level, effective_level
from .models import Checkin, Classroom, Diagnosis, ItemResult, Student, Teacher


def teacher_out(t: Teacher) -> dict:
    return {"id": t.id, "login": t.login, "name": t.name, "ui_lang": t.ui_lang}


def student_out(s: Student) -> dict:
    level, confirmed = effective_level(s.provisional_level, s.confirmed_level)
    finished = [c for c in s.checkins if c.status in ("scored", "needs_review")]
    last = finished[-1] if finished else None
    return {
        "id": s.id,
        "first_name": s.first_name,
        "avatar": s.avatar,
        "grade": s.grade,
        "home_lang": s.home_lang,
        "assessment_language": s.home_lang or s.classroom.language,
        "provisional_level": s.provisional_level,
        "confirmed_level": s.confirmed_level,
        "level": level,
        "level_confirmed": confirmed,
        "cohort": s.cohort_override or cohort_for_level(level),
        "cohort_override": s.cohort_override,
        "checkins": len(finished),
        "last_checkin_at": last.started_at.isoformat() if last else None,
        "pending_review": any(c.status == "needs_review" for c in s.checkins),
        "patterns": (last.diagnosis.error_patterns if last and last.diagnosis else []),
    }


def classroom_out(c: Classroom, *, students: bool = False) -> dict:
    out = {"id": c.id, "name": c.name, "grade": c.grade, "language": c.language, "students_count": len(c.students)}
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
