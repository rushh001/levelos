from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_teacher
from ..content import reading_languages
from ..db import get_db
from ..levels.aser_rules import COHORTS
from ..llm import activities as act
from ..llm import budget
from ..models import Classroom, GeneratedActivity, Teacher
from .classes import owned_class

router = APIRouter(prefix="/api", tags=["activities"])


class GenerateIn(BaseModel):
    cohort: str
    language: str | None = None  # the reading test the group comes from (default: the class language)


def reading_language(cls: Classroom, language: str | None) -> str:
    langs = reading_languages(cls.language) or [cls.language]
    return language if language in langs else langs[0]


class RatingIn(BaseModel):
    rating: int = Field(ge=1, le=5)


def activity_out(g: GeneratedActivity) -> dict:
    a = act.entry(g.source_activity_id)
    return {
        "id": g.id,
        "cohort": g.cohort,
        "language": g.language,
        "source_activity_id": g.source_activity_id,
        "source": act.source_of(a) if a else None,
        "plan": g.plan,
        "accepted": g.accepted,
        "generated_by": g.validation.get("generated_by", "bank"),
        "teacher_rating": g.teacher_rating,
        "created_at": g.created_at.isoformat(),
    }


@router.post("/classes/{class_id}/activities", status_code=201)
async def generate(class_id: str, body: GenerateIn, teacher: Teacher = Depends(current_teacher),
                   db: Session = Depends(get_db)) -> dict:
    if body.cohort not in COHORTS:
        raise HTTPException(422, f"cohort must be one of {COHORTS}")
    cls = owned_class(db, teacher, class_id)
    lang = reading_language(cls, body.language)
    ctx = act.cohort_context(db, cls, body.cohort, lang)
    result = await act.generate(
        ctx, blocked=budget.blocked(db),
        on_usage=lambda purpose, model, usage, stop: budget.record(db, purpose, model, usage, cls.id, stop))
    g = GeneratedActivity(classroom_id=cls.id, cohort=body.cohort, language=lang,
                          source_activity_id=result["source_activity_id"], plan=result["plan"],
                          validation={**result["validation"], "generated_by": result["generated_by"],
                                      "context": ctx, "prompt_version": act.PROMPT_VERSION},
                          accepted=result["accepted"])
    db.add(g)
    db.commit()
    return activity_out(g)


@router.get("/classes/{class_id}/activities")
def list_activities(class_id: str, cohort: str | None = None, language: str | None = None,
                    teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> list[dict]:
    cls = owned_class(db, teacher, class_id)
    q = select(GeneratedActivity).where(GeneratedActivity.classroom_id == cls.id,
                                        GeneratedActivity.language == reading_language(cls, language))
    if cohort:
        q = q.where(GeneratedActivity.cohort == cohort)
    return [activity_out(g) for g in db.scalars(q.order_by(GeneratedActivity.created_at.desc()).limit(10))]


@router.post("/activities/{activity_id}/rating")
def rate(activity_id: str, body: RatingIn, teacher: Teacher = Depends(current_teacher),
         db: Session = Depends(get_db)) -> dict:
    g = db.get(GeneratedActivity, activity_id)
    if g is None:
        raise HTTPException(404, "activity not found")
    owned_class(db, teacher, g.classroom_id)
    g.teacher_rating = body.rating
    db.commit()
    return activity_out(g)
