"""Database models. IDs are uuid4 hex strings so SQLite (dev) and Postgres (prod) behave the same."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)  # set at sign-up; one account per email
    pin_hash: Mapped[str] = mapped_column(String(128))
    ui_lang: Mapped[str] = mapped_column(String(8), default="hi")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    classrooms: Mapped[list[Classroom]] = relationship(back_populates="teacher", order_by="Classroom.name")


class Classroom(Base):
    __tablename__ = "classrooms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    grade: Mapped[int] = mapped_column(Integer, default=2)
    language: Mapped[str] = mapped_column(String(8), default="hi")  # default assessment language
    names: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # the name per interface language, if given

    teacher: Mapped[Teacher] = relationship(back_populates="classrooms")
    students: Mapped[list[Student]] = relationship(back_populates="classroom", order_by="Student.first_name")


class Student(Base):
    __tablename__ = "students"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    classroom_id: Mapped[str] = mapped_column(ForeignKey("classrooms.id"), index=True)
    first_name: Mapped[str] = mapped_column(String(80))  # pseudonymous: first name + avatar only
    # The same first name per interface language when the teacher gives both spellings ({"en": "Meena", "hi": "मीना"}).
    names: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    avatar: Mapped[str] = mapped_column(String(32), default="🙂")
    grade: Mapped[int] = mapped_column(Integer, default=2)
    home_lang: Mapped[str | None] = mapped_column(String(8), nullable=True)  # None = the class language
    # One level per child, from before levels were kept per language: read only to migrate older databases
    # (services.checkins.migrate_levels). Levels and groups live in StudentLevel.
    provisional_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confirmed_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cohort_override: Mapped[str | None] = mapped_column(String(16), nullable=True)

    classroom: Mapped[Classroom] = relationship(back_populates="students")
    checkins: Mapped[list[Checkin]] = relationship(back_populates="student", order_by="Checkin.started_at")
    levels: Mapped[list[StudentLevel]] = relationship(back_populates="student", cascade="all, delete-orphan")

    @property
    def main_language(self) -> str:
        """The language of the child's regional reading test; English is tested alongside it."""
        return self.home_lang or self.classroom.language

    def level_in(self, language: str) -> StudentLevel | None:
        return next((row for row in self.levels if row.language == language), None)


class StudentLevel(Base):
    """A child's reading level and group in one language. ASER tests the regional language and English
    separately, so each language has its own check-ins, level and TaRL group."""

    __tablename__ = "student_levels"

    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    language: Mapped[str] = mapped_column(String(8), primary_key=True)
    provisional_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confirmed_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cohort_override: Mapped[str | None] = mapped_column(String(16), nullable=True)  # teacher moved the child

    student: Mapped[Student] = relationship(back_populates="levels")


class Checkin(Base):
    __tablename__ = "checkins"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    local_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)  # idempotency key (PWA queue)
    language: Mapped[str] = mapped_column(String(8))
    start_level: Mapped[str] = mapped_column(String(16))  # where the adaptive ladder began
    # The teacher chose the child's group: the check reads only that level's card (start_level), no other level.
    fixed_level: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    scored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # in_progress | needs_review (uncertain words could change the result) | scored | abandoned
    status: Mapped[str] = mapped_column(String(16), default="in_progress", index=True)
    source: Mapped[str] = mapped_column(String(16), default="ai")  # ai | offline_marks
    level_suggested: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ASER rules on the items
    level_final: Mapped[str | None] = mapped_column(String(16), nullable=True)  # what counts (teacher override wins)
    teacher_overrode: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    student: Mapped[Student] = relationship(back_populates="checkins")
    items: Mapped[list[ItemResult]] = relationship(back_populates="checkin", order_by="ItemResult.position")
    diagnosis: Mapped[Diagnosis | None] = relationship(back_populates="checkin", uselist=False)


class ItemResult(Base):
    __tablename__ = "item_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    checkin_id: Mapped[str] = mapped_column(ForeignKey("checkins.id"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    item_id: Mapped[str] = mapped_column(String(64))
    item_level: Mapped[str] = mapped_column(String(16))  # letter | word | paragraph | story
    source: Mapped[str] = mapped_column(String(16), default="ai")  # ai | offline_marks
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The full ItemScore (app.speech.scorer): per-word labels from every path, counts, pauses, WCPM, path outputs.
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    offline_marks: Mapped[list | None] = mapped_column(JSON, nullable=True)  # teacher tap-to-mark, if any
    # The meaning step after a word card: [{"word", "correct"}] for the words the child was shown pictures for.
    meaning: Mapped[list | None] = mapped_column(JSON, nullable=True)
    audio_kept_path: Mapped[str | None] = mapped_column(String(255), nullable=True)  # consented eval set only

    checkin: Mapped[Checkin] = relationship(back_populates="items")
    audio: Mapped[ItemAudio | None] = relationship(back_populates="item_result", uselist=False)


class ItemAudio(Base):
    """The child's recording of one item, kept so the teacher can listen again (playback-friendly MP3).
    Deleted automatically after AUDIO_RETENTION_DAYS, or by the teacher at any time."""

    __tablename__ = "item_audio"

    item_result_id: Mapped[str] = mapped_column(ForeignKey("item_results.id"), primary_key=True)
    mime: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)  # loaded only when played
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    item_result: Mapped[ItemResult] = relationship(back_populates="audio")


class Diagnosis(Base):
    __tablename__ = "diagnoses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    checkin_id: Mapped[str] = mapped_column(ForeignKey("checkins.id"), unique=True, index=True)
    error_patterns: Mapped[list] = mapped_column(JSON, default=list)  # ordered, most important first
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)  # {"hi": "...", "en": "..."}
    confidence: Mapped[str] = mapped_column(String(8), default="low")  # low | medium | high
    model: Mapped[str] = mapped_column(String(64))  # claude model id, or "rules" for the offline fallback
    prompt_version: Mapped[str] = mapped_column(String(16))
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    checkin: Mapped[Checkin] = relationship(back_populates="diagnosis")


class LevelHistory(Base):
    __tablename__ = "level_history"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    checkin_id: Mapped[str | None] = mapped_column(ForeignKey("checkins.id"), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    provisional: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confirmed: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # ai | offline_marks | teacher


class LlmUsage(Base):
    """One Claude call: tokens and cost, for the spend caps (app/llm/budget.py) and for reporting."""

    __tablename__ = "llm_usage"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    purpose: Mapped[str] = mapped_column(String(24))  # diagnosis | activity | activity_review
    model: Mapped[str] = mapped_column(String(64))
    ref_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # check-in or activity id
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    stop_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)


class GeneratedActivity(Base):
    __tablename__ = "generated_activities"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    classroom_id: Mapped[str] = mapped_column(ForeignKey("classrooms.id"), index=True)
    cohort: Mapped[str] = mapped_column(String(16))  # letter | word | paragraph
    language: Mapped[str] = mapped_column(String(8))
    source_activity_id: Mapped[str] = mapped_column(String(64))
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    validation: Mapped[dict] = mapped_column(JSON, default=dict)
    accepted: Mapped[bool] = mapped_column(Boolean, default=True)  # false = validator rejected, raw bank entry served
    teacher_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
