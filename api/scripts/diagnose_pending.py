"""Upgrade rule-based ("quick") diagnoses to Claude ones: each child's latest finished check-in only.

    cd api
    .venv/Scripts/python -m scripts.diagnose_pending --dry-run         # how many, estimated cost
    .venv/Scripts/python -m scripts.diagnose_pending --teacher demo    # do it for one teacher's classes

Used once when preparing the hosted demo (point DATABASE_URL at it). Every call goes through the same spend
caps and ledger as the app (about $0.02 per diagnosis with Claude Opus 5.5).
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.llm import budget
from app.llm import diagnose as diag
from app.models import Checkin, Classroom, Student, Teacher

EST_COST = 0.02


def pending(db, teacher_login: str | None) -> list[str]:
    q = select(Student).join(Classroom).join(Teacher)
    if teacher_login:
        q = q.where(Teacher.login == teacher_login)
    ids = []
    for s in db.scalars(q):
        done = [c for c in s.checkins if c.status in ("scored", "needs_review") and c.items]
        latest = max(done, key=lambda c: c.started_at, default=None)
        if latest is not None and (latest.diagnosis is None or latest.diagnosis.model == "rules"):
            ids.append(latest.id)
    return ids


async def run(ids: list[str]) -> None:
    for n, cid in enumerate(ids, 1):
        db = SessionLocal()
        try:
            reason = budget.blocked(db)
            c = db.get(Checkin, cid)
            if c.diagnosis is None:
                diag.refresh_rules(db, c)
        finally:
            db.close()
        if reason:
            print("stopped:", reason)
            return
        await diag.run_claude(cid)
        db = SessionLocal()
        model = db.get(Checkin, cid).diagnosis.model
        db.close()
        print(f"  {n}/{len(ids)} {cid[:8]} -> {model}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--teacher", help="only this teacher's classes (login)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if not settings.anthropic_api_key:
        sys.exit("ANTHROPIC_API_KEY is not set")
    settings.diagnosis_debounce_s = 0
    Base.metadata.create_all(bind=engine)  # adds the spend ledger to databases created before it existed
    db = SessionLocal()
    ids = pending(db, args.teacher)
    print(f"{len(ids)} check-ins on quick analysis · estimated ${len(ids) * EST_COST:.2f} · ledger {budget.status(db)}")
    db.close()
    if not args.dry_run and ids:
        asyncio.run(run(ids))
        db = SessionLocal()
        print("ledger now:", budget.status(db))


if __name__ == "__main__":
    main()
