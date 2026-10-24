"""Teacher login: login name + numeric PIN -> 30-day JWT. One role (teacher); children never log in."""

from __future__ import annotations

from datetime import timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import DEV_JWT_SECRET, settings
from .db import get_db
from .models import Teacher, utcnow

TOKEN_DAYS = 30
_bearer = HTTPBearer(auto_error=False)


def check_secret() -> None:
    if settings.app_env == "prod" and settings.jwt_secret == DEV_JWT_SECRET:
        raise RuntimeError("JWT_SECRET must be set in production")


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), pin_hash.encode())
    except ValueError:
        return False


def make_token(teacher_id: str) -> str:
    payload = {"sub": teacher_id, "exp": utcnow() + timedelta(days=TOKEN_DAYS)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def current_teacher(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> Teacher:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "login required",
                                 headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise unauthorized from None
    teacher = db.get(Teacher, payload.get("sub"))
    if teacher is None:
        raise unauthorized
    return teacher
