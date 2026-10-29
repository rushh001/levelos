import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_teacher, hash_pin, make_token, verify_pin
from ..content import languages
from ..db import get_db
from ..models import Teacher
from ..serialize import teacher_out

router = APIRouter(prefix="/api", tags=["auth"])

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    pin: str = Field(min_length=4, max_length=12)


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    pin: str = Field(min_length=4, max_length=8)
    ui_lang: str | None = None  # the language the sign-up screen was in


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)) -> dict:
    teacher = db.scalar(select(Teacher).where(Teacher.login == "".join(body.login.split()).lower()))
    if teacher is None or not verify_pin(body.pin, teacher.pin_hash):
        raise HTTPException(401, "wrong login or PIN")
    return {"token": make_token(teacher.id), "teacher": teacher_out(teacher)}


def new_login_id(db: Session) -> str:
    """A 6-digit login ID no teacher has yet (100000-999999)."""
    for _ in range(100):
        code = str(100000 + secrets.randbelow(900000))
        if db.scalar(select(Teacher.id).where(Teacher.login == code)) is None:
            return code
    raise HTTPException(503, "could not find a free login ID; please try again")


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db)) -> dict:
    """A teacher creates an account with a name, an email and a PIN, and is given a unique 6-digit login ID (shown
    once on screen; the teacher logs in with it and the PIN). One account per email."""
    name = " ".join(body.name.split())
    email = body.email.strip().lower()
    if not name:
        raise HTTPException(422, "enter your name")
    if not EMAIL.match(email):
        raise HTTPException(422, "enter a valid email address")
    if not body.pin.isdigit():
        raise HTTPException(422, "the PIN must be 4 to 8 digits")
    if db.scalar(select(Teacher.id).where(func.lower(Teacher.email) == email)) is not None:
        raise HTTPException(409, "an account with this email already exists")
    ui = body.ui_lang if body.ui_lang in {"en"} | {c for c, cfg in languages().items() if cfg.get("ui")} else "en"
    t = Teacher(login=new_login_id(db), name=name, email=email, pin_hash=hash_pin(body.pin), ui_lang=ui)
    db.add(t)
    db.commit()
    return {"token": make_token(t.id), "teacher": teacher_out(t), "login": t.login}


@router.get("/me")
def me(teacher: Teacher = Depends(current_teacher)) -> dict:
    return teacher_out(teacher)
