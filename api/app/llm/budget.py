"""Claude spend: every call's tokens and cost are logged, and calls stop at a total or daily cap.

The hackathon credit is finite and must last through the evaluation window, so the caps are hard: once one is
reached, diagnosis and activities fall back to their rule-based / bank versions and the app keeps working.
Local and hosted databases keep separate ledgers; set a small CLAUDE_BUDGET_USD locally.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import LlmUsage

# $ per million tokens: input, output, cache read, cache write (5-minute). Thinking tokens are billed as output.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-opus-5": (5.00, 25.00, 0.50, 6.25),
    "claude-opus-4-8": (5.00, 25.00, 0.50, 6.25),
    "claude-fable-5-1": (10.00, 50.00, 0.25, 12.50),
}
# A model we have no price for (e.g. a refusal fallback we did not anticipate): assume the most expensive tier.
UNKNOWN_PRICE = (10.00, 50.00, 1.00, 12.50)


def cost_usd(model: str, usage) -> float:
    p_in, p_out, p_read, p_write = PRICES.get(model, UNKNOWN_PRICE)
    tokens = (
        (getattr(usage, "input_tokens", 0) or 0) * p_in
        + (getattr(usage, "output_tokens", 0) or 0) * p_out
        + (getattr(usage, "cache_read_input_tokens", 0) or 0) * p_read
        + (getattr(usage, "cache_creation_input_tokens", 0) or 0) * p_write
    )
    return tokens / 1_000_000


def record(db: Session, purpose: str, model: str, usage, ref_id: str | None = None,
           stop_reason: str | None = None) -> LlmUsage:
    row = LlmUsage(
        purpose=purpose,
        model=model,
        ref_id=ref_id,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        cost_usd=cost_usd(model, usage),
        stop_reason=stop_reason,
    )
    db.add(row)
    db.commit()
    return row


def spent(db: Session, since: datetime | None = None) -> float:
    q = select(func.coalesce(func.sum(LlmUsage.cost_usd), 0.0))
    if since is not None:
        q = q.where(LlmUsage.at >= since)
    return float(db.scalar(q) or 0.0)


def _today() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def blocked(db: Session) -> str | None:
    """Why Claude must not be called now, or None if it may."""
    total = spent(db)
    if total >= settings.claude_budget_usd:
        return f"total Claude budget reached (${total:.2f} of ${settings.claude_budget_usd:.2f})"
    today = spent(db, _today())
    if today >= settings.claude_daily_budget_usd:
        return f"daily Claude budget reached (${today:.2f} of ${settings.claude_daily_budget_usd:.2f})"
    return None


def status(db: Session) -> dict:
    return {
        "spent_usd": round(spent(db), 4),
        "today_usd": round(spent(db, _today()), 4),
        "cap_usd": settings.claude_budget_usd,
        "daily_cap_usd": settings.claude_daily_budget_usd,
        "available": blocked(db) is None,
    }
