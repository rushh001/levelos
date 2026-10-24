from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_teacher
from ..content import available_languages
from ..db import get_db
from ..levels.aser_rules import COHORTS
from ..models import Classroom, LevelHistory, Student, Teacher
from ..serialize import checkin_out, classroom_out, student_out
from ..services.checkins import owned_student

router = APIRouter(prefix="/api", tags=["classes"])


def owned_class(db: Session, teacher: Teacher, class_id: str) -> Classroom:
    c = db.get(Classroom, class_id)
    if c is None or c.teacher_id != teacher.id:
        raise HTTPException(404, "class not found")
    return c


def _check_lang(lang: str | None) -> None:
    if lang is not None and lang not in available_languages():
        raise HTTPException(422, f"no item bank for language {lang!r}")


class ClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    grade: int = Field(ge=1, le=8)
    language: str = "hi"


class ClassPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    grade: int | None = Field(default=None, ge=1, le=8)
    language: str | None = None


class StudentIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    avatar: str = Field(default="🙂", max_length=32)
    grade: int | None = Field(default=None, ge=1, le=8)
    home_lang: str | None = None


class StudentPatch(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    avatar: str | None = Field(default=None, max_length=32)
    grade: int | None = Field(default=None, ge=1, le=8)
    home_lang: str | None = None
    cohort_override: str | None = None
    clear_cohort_override: bool = False


@router.get("/classes")
def list_classes(teacher: Teacher = Depends(current_teacher)) -> list[dict]:
    return [classroom_out(c) for c in teacher.classrooms]


@router.post("/classes", status_code=201)
def create_class(body: ClassIn, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    _check_lang(body.language)
    c = Classroom(teacher_id=teacher.id, name=body.name.strip(), grade=body.grade, language=body.language)
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
        setattr(c, k, v)
    db.commit()
    return classroom_out(c, students=True)


@router.post("/classes/{class_id}/students", status_code=201)
def add_student(class_id: str, body: StudentIn, teacher: Teacher = Depends(current_teacher),
                db: Session = Depends(get_db)) -> dict:
    c = owned_class(db, teacher, class_id)
    _check_lang(body.home_lang)
    s = Student(classroom_id=c.id, first_name=body.first_name.strip(), avatar=body.avatar,
                grade=body.grade or c.grade, home_lang=body.home_lang)
    db.add(s)
    db.commit()
    return student_out(s)


@router.get("/students/{student_id}")
def get_student(student_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    s = owned_student(db, teacher, student_id)
    history = db.query(LevelHistory).filter(LevelHistory.student_id == s.id).order_by(LevelHistory.at).all()
    return {
        **student_out(s),
        "class_id": s.classroom_id,
        "checkins_list": [checkin_out(c) for c in reversed(s.checkins) if c.status != "abandoned"],
        "level_history": [{"at": h.at.isoformat(), "provisional": h.provisional, "confirmed": h.confirmed,
                           "source": h.source, "checkin_id": h.checkin_id} for h in history],
    }


@router.patch("/students/{student_id}")
def patch_student(student_id: str, body: StudentPatch, teacher: Teacher = Depends(current_teacher),
                  db: Session = Depends(get_db)) -> dict:
    s = owned_student(db, teacher, student_id)
    _check_lang(body.home_lang)
    if body.cohort_override is not None and body.cohort_override not in COHORTS:
        raise HTTPException(422, f"cohort must be one of {COHORTS}")
    for k, v in body.model_dump(exclude_none=True, exclude={"clear_cohort_override"}).items():
        setattr(s, k, v)
    if body.clear_cohort_override:
        s.cohort_override = None
    db.commit()
    return student_out(s)


@router.get("/classes/{class_id}/dashboard")
def dashboard(class_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    """The class regrouped into TaRL cohorts by effective level (confirmed, else provisional and flagged)."""
    c = owned_class(db, teacher, class_id)
    students = [student_out(s) for s in c.students]
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
        "cohorts": cohorts,
        "not_assessed": groups["not_assessed"],
        "pending_review": [s["id"] for s in students if s["pending_review"]],
    }
