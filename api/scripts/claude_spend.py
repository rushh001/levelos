"""Claude spend from the ledger (llm_usage): totals, per purpose, per day, average cost per call.

    cd api
    .venv/Scripts/python -m scripts.claude_spend                      # this machine's database
    DATABASE_URL=<neon url> .venv/Scripts/python -m scripts.claude_spend   # the hosted demo's database

Each database has its own ledger; add them up (plus any use outside LevelOS) against the $500 credit.
"""

from __future__ import annotations

import sys

from sqlalchemy import func, select

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.llm import budget
from app.models import LlmUsage


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    s = budget.status(db)
    print(f"Spent ${s['spent_usd']:.4f} of ${s['cap_usd']:.2f} (today ${s['today_usd']:.4f} of "
          f"${s['daily_cap_usd']:.2f}) · Claude {'available' if s['available'] else 'BLOCKED'} · db {settings.database_url.split('@')[-1]}")
    rows = db.execute(select(LlmUsage.purpose, LlmUsage.model, func.count(), func.sum(LlmUsage.cost_usd),
                             func.sum(LlmUsage.input_tokens), func.sum(LlmUsage.output_tokens))
                      .group_by(LlmUsage.purpose, LlmUsage.model)).all()
    for purpose, model, n, cost, tin, tout in rows:
        print(f"  {purpose:16s} {model:18s} {n:5d} calls  ${cost:.4f}  (avg ${cost / n:.4f}; {tin // n} in / {tout // n} out)")
    days = db.execute(select(func.date(LlmUsage.at), func.count(), func.sum(LlmUsage.cost_usd))
                      .group_by(func.date(LlmUsage.at)).order_by(func.date(LlmUsage.at))).all()
    for day, n, cost in days:
        print(f"  {day}  {n:5d} calls  ${cost:.4f}")


if __name__ == "__main__":
    main()
