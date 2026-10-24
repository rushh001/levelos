from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_teacher, make_token, verify_pin
from ..db import get_db
from ..models import Teacher
from ..serialize import teacher_out

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    pin: str = Field(min_length=4, max_length=12)


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)) -> dict:
    teacher = db.scalar(select(Teacher).where(Teacher.login == body.login.strip().lower()))
    if teacher is None or not verify_pin(body.pin, teacher.pin_hash):
        raise HTTPException(401, "wrong login or PIN")
    return {"token": make_token(teacher.id), "teacher": teacher_out(teacher)}


@router.get("/me")
def me(teacher: Teacher = Depends(current_teacher)) -> dict:
    return teacher_out(teacher)
