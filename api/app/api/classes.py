from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import current_teacher
from ..content import available_languages, reading_languages
from ..db import get_db
from ..levels.aser_rules import COHORTS
from ..models import (Checkin, Classroom, Diagnosis, GeneratedActivity, ItemAudio, ItemResult, LevelHistory, Student,
                      StudentLevel, Teacher)
from ..serialize import checkin_out, classroom_out, iso, student_out
from ..services.checkins import level_row, owned_student

router = APIRouter(prefix="/api", tags=["classes"])


def owned_class(db: Session, teacher: Teacher, class_id: str) -> Classroom:
    c = db.get(Classroom, class_id)
    if c is None or c.teacher_id != teacher.id:
        raise HTTPException(404, "class not found")
    return c


def _check_lang(lang: str | None) -> None:
    if lang is not None and lang not in available_languages():
        raise HTTPException(422, f"no item bank for language {lang!r}")


Names = dict[str, str]  # the same name per interface language, e.g. {"en": "Meena", "hi": "मीना"}


def _names(names: Names | None, limit: int) -> Names | None:
    if names is None:
        return None
    clean = {lang: n.strip() for lang, n in names.items() if isinstance(n, str) and n.strip()}
    if any(len(lang) > 8 or len(n) > limit for lang, n in clean.items()):
        raise HTTPException(422, f"names must be at most {limit} characters")
    return clean or None


class ClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    names: Names | None = None
    grade: int = Field(ge=1, le=8)
    language: str = "hi"
    local_id: str | None = Field(default=None, max_length=64)  # made offline: the phone may send it more than once


class ClassPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    names: Names | None = None
    grade: int | None = Field(default=None, ge=1, le=8)
    language: str | None = None


class StudentIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    names: Names | None = None
    avatar: str = Field(default="🙂", max_length=32)
    grade: int | None = Field(default=None, ge=1, le=8)
    home_lang: str | None = None
    local_id: str | None = Field(default=None, max_length=64)  # made offline: the phone may send it more than once


class StudentPatch(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    names: Names | None = None
    avatar: str | None = Field(default=None, max_length=32)
    grade: int | None = Field(default=None, ge=1, le=8)
    home_lang: str | None = None
    cohort_override: str | None = None
    clear_cohort_override: bool = False
    language: str | None = None  # which reading test the group applies to (default: the child's main language)


@router.get("/classes")
def list_classes(teacher: Teacher = Depends(current_teacher)) -> list[dict]:
    return [classroom_out(c) for c in teacher.classrooms]


@router.post("/classes", status_code=201)
def create_class(body: ClassIn, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    _check_lang(body.language)
    if body.local_id:  # sent again (the app closed mid-sync): the class it already made
        made = db.query(Classroom).filter_by(teacher_id=teacher.id, local_id=body.local_id).first()
        if made:
            return classroom_out(made, students=True)
    c = Classroom(teacher_id=teacher.id, name=body.name.strip(), names=_names(body.names, 120), grade=body.grade,
                  language=body.language, local_id=body.local_id)
    db.add(c)
    db.commit()
    return classroom_out(c, students=True)


@router.get("/classes/{class_id}")
def get_class(class_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    return classroom_out(owned_class(db, teacher, class_id), students=True)


@router.patch("/classes/{class_id}")
def patch_class(class_id: str, body: ClassPatch, teacher: Teacher = Depends(current_teacher),
                db: Session = Depends(get_db)) -> dict:
    c = owned_class(db, teacher, class_id)
    _check_lang(body.language)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, _names(v, 120) if k == "names" else v)
    db.commit()
    return classroom_out(c, students=True)


@router.delete("/classes/{class_id}")
def delete_class(class_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    """The class, its children and everything recorded about them (checks, recordings, levels, activities). The Claude
    spend ledger is kept, as the spend caps count it."""
    c = owned_class(db, teacher, class_id)
    if c.shared_demo:
        raise HTTPException(403, "the shared demo class cannot be deleted")
    students = select(Student.id).where(Student.classroom_id == c.id)
    checkins = select(Checkin.id).where(Checkin.student_id.in_(students))
    items = select(ItemResult.id).where(ItemResult.checkin_id.in_(checkins))
    for stmt in (
        delete(ItemAudio).where(ItemAudio.item_result_id.in_(items)),
        delete(ItemResult).where(ItemResult.checkin_id.in_(checkins)),
        delete(Diagnosis).where(Diagnosis.checkin_id.in_(checkins)),
        delete(LevelHistory).where(LevelHistory.student_id.in_(students)),
        delete(Checkin).where(Checkin.student_id.in_(students)),
        delete(StudentLevel).where(StudentLevel.student_id.in_(students)),
        delete(Student).where(Student.classroom_id == c.id),
        delete(GeneratedActivity).where(GeneratedActivity.classroom_id == c.id),
        delete(Classroom).where(Classroom.id == c.id),
    ):
        db.execute(stmt.execution_options(synchronize_session=False))
    db.commit()
    return {"ok": True}


@router.post("/classes/{class_id}/students", status_code=201)
def add_student(class_id: str, body: StudentIn, teacher: Teacher = Depends(current_teacher),
                db: Session = Depends(get_db)) -> dict:
    c = owned_class(db, teacher, class_id)
    _check_lang(body.home_lang)
    if body.local_id:  # sent again (the app closed mid-sync): the child it already added
        made = db.query(Student).filter_by(classroom_id=c.id, local_id=body.local_id).first()
        if made:
            return student_out(made)
    s = Student(classroom_id=c.id, first_name=body.first_name.strip(), names=_names(body.names, 80),
                avatar=body.avatar, grade=body.grade or c.grade, home_lang=body.home_lang, local_id=body.local_id)
    db.add(s)
    db.commit()
    return student_out(s)


@router.get("/students/{student_id}")
def get_student(student_id: str, language: str | None = None, teacher: Teacher = Depends(current_teacher),
                db: Session = Depends(get_db)) -> dict:
    s = owned_student(db, teacher, student_id)
    history = db.query(LevelHistory).filter(LevelHistory.student_id == s.id).order_by(LevelHistory.at).all()
    return {
        **student_out(s, language),
        "class_id": s.classroom_id,
        "checkins_list": [checkin_out(c) for c in reversed(s.checkins) if c.status != "abandoned"],
        "level_history": [{"at": iso(h.at), "provisional": h.provisional, "confirmed": h.confirmed,
                           "source": h.source, "checkin_id": h.checkin_id} for h in history],
    }


@router.patch("/students/{student_id}")
def patch_student(student_id: str, body: StudentPatch, teacher: Teacher = Depends(current_teacher),
                  db: Session = Depends(get_db)) -> dict:
    s = owned_student(db, teacher, student_id)
    _check_lang(body.home_lang)
    _check_lang(body.language)
    if body.cohort_override is not None and body.cohort_override not in COHORTS:
        raise HTTPException(422, f"cohort must be one of {COHORTS}")
    for k, v in body.model_dump(exclude_none=True,
                                exclude={"cohort_override", "clear_cohort_override", "language"}).items():
        setattr(s, k, _names(v, 80) if k == "names" else v)
    lang = body.language or s.main_language
    if body.cohort_override is not None:
        level_row(s, lang).cohort_override = body.cohort_override
    if body.clear_cohort_override and (row := s.level_in(lang)) is not None:
        row.cohort_override = None
    db.commit()
    return student_out(s, lang)


@router.get("/classes/{class_id}/dashboard")
def dashboard(class_id: str, language: str | None = None, teacher: Teacher = Depends(current_teacher),
              db: Session = Depends(get_db)) -> dict:
    """The class regrouped into TaRL cohorts by effective level (confirmed, else provisional and flagged) in one
    reading language (default: the class language)."""
    c = owned_class(db, teacher, class_id)
    langs = reading_languages(c.language) or [c.language]
    lang = language if language in langs else langs[0]
    students = [student_out(s, lang) for s in c.students]
    groups: dict[str, list[dict]] = {k: [] for k in (*COHORTS, "not_assessed")}
    for s in students:
        groups[s["cohort"] or "not_assessed"].append(s)
    cohorts = []
    for key in COHORTS:
        members = groups[key]
        tally: dict[str, int] = {}
        for s in members:
            for p in s["patterns"][:2]:
                tally[p] = tally.get(p, 0) + 1
        cohorts.append({
            "cohort": key,
            "students": members,
            "confirmed": sum(1 for s in members if s["level_confirmed"]),
            "dominant_patterns": sorted(tally, key=lambda p: -tally[p])[:3],
            "pattern_counts": tally,
        })
    return {
        "class": classroom_out(c),
        "language": lang,
        "cohorts": cohorts,
        "not_assessed": groups["not_assessed"],
        "pending_review": [s["id"] for s in students if s["pending_review"]],
    }
