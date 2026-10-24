"""Error-pattern diagnosis for a finished check-in.

Flow: the rule-based diagnosis is stored at once (instant, offline-capable); if a Claude key is configured, Claude's
diagnosis is computed in the background and replaces it. Claude sees only structured evidence (no audio, no level
decision to make) and must answer in a fixed JSON schema; every citation is then checked against the evidence and
anything that does not check out is dropped. If nothing valid survives, the rule-based diagnosis stays.
"""

from __future__ import annotations

import asyncio
import json
import logging

import anthropic
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..models import Checkin, Diagnosis
from . import budget, rules
from .evidence import build_input, input_hash
from .patterns import ITEM_LEVEL_PATTERNS, PATTERNS
from .prompts import DIAGNOSIS_SYSTEM, PROMPT_VERSION

log = logging.getLogger(__name__)

DIAGNOSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "error_patterns": {"type": "array", "items": {"type": "string", "enum": PATTERNS}},
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "enum": PATTERNS},
                    "item_id": {"type": "string"},
                    "word_indices": {"type": "array", "items": {"type": "integer"}},
                    "note_en": {"type": "string"},
                    "note_hi": {"type": "string"},
                },
                "required": ["pattern", "item_id", "word_indices", "note_en", "note_hi"],
                "additionalProperties": False,
            },
        },
        "word_notes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"item_id": {"type": "string"}, "i": {"type": "integer"},
                               "real_word": {"type": "boolean"}},
                "required": ["item_id", "i", "real_word"],
                "additionalProperties": False,
            },
        },
        "summary_hi": {"type": "string"},
        "summary_en": {"type": "string"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    },
    "required": ["error_patterns", "evidence", "word_notes", "summary_hi", "summary_en", "confidence"],
    "additionalProperties": False,
}


class DiagnosisUnavailable(Exception):
    pass


# ---------------------------------------------------------------- validation (guardrail: cite only real evidence)


def validate(out: dict, inp: dict) -> dict | None:
    """Keep only evidence that points at real error words; drop patterns left without support."""
    items = {it["item_id"]: it for it in inp["items"]}
    evidence, supported = [], set()
    for ev in out.get("evidence", []):
        p, item = ev.get("pattern"), items.get(ev.get("item_id"))
        if p not in PATTERNS or item is None:
            continue
        errs = {w["i"]: w for w in item["error_words"]}
        idx = [i for i in dict.fromkeys(ev.get("word_indices", [])) if i in errs]
        if not idx and p not in ITEM_LEVEL_PATTERNS:
            continue
        if idx and all(errs[i]["uncertain"] for i in idx) and p not in ITEM_LEVEL_PATTERNS:
            continue  # a pattern must not rest on unconfirmed words alone
        evidence.append({"pattern": p, "item_id": item["item_id"],
                         "words": [{"i": i, "ref": errs[i]["ref"], "heard": errs[i]["heard"]} for i in idx],
                         "note_en": (ev.get("note_en") or "").strip(), "note_hi": (ev.get("note_hi") or "").strip()})
        supported.add(p)
    patterns = [p for p in dict.fromkeys(out.get("error_patterns", [])) if p in supported][:3]
    evidence = [e for e in evidence if e["pattern"] in patterns]
    summary = {"hi": (out.get("summary_hi") or "").strip(), "en": (out.get("summary_en") or "").strip()}
    has_errors = any(it["error_words"] for it in inp["items"])
    if not summary["hi"] or not summary["en"] or (has_errors and not patterns and out.get("error_patterns")):
        return None  # empty summary, or every claimed pattern was unsupported
    notes = [n for n in out.get("word_notes", [])
             if n.get("item_id") in items and any(w["i"] == n.get("i") for w in items[n["item_id"]]["error_words"])]
    confidence = out.get("confidence") if out.get("confidence") in ("low", "medium", "high") else "low"
    return {"error_patterns": patterns, "evidence": evidence, "word_notes": notes, "summary": summary,
            "confidence": confidence}


# ---------------------------------------------------------------- Claude


_client: anthropic.AsyncAnthropic | None = None


def claude_enabled() -> bool:
    return bool(settings.anthropic_api_key)


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=90.0, max_retries=2)
    return _client


async def call_claude(payload: dict, on_usage=None, effort: str | None = None) -> tuple[dict, dict]:
    """One structured-output call. Returns (parsed JSON, metadata). Raises DiagnosisUnavailable.
    `on_usage(model, usage, stop_reason)` is called as soon as a response arrives (it is billed even if unusable)."""
    try:
        resp = await _get_client().beta.messages.create(
            model=settings.claude_model,
            max_tokens=16000,
            # A safety classifier can decline a benign request; let the API re-run it on its recommended
            # fallback model instead of failing the diagnosis.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": effort or settings.claude_diagnosis_effort,
                           "format": {"type": "json_schema", "schema": DIAGNOSIS_SCHEMA}},
            system=[{"type": "text", "text": DIAGNOSIS_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except anthropic.RateLimitError as e:
        raise DiagnosisUnavailable(f"rate limited: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise DiagnosisUnavailable(f"API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise DiagnosisUnavailable(f"connection: {e}") from e

    if on_usage is not None:
        on_usage(resp.model, resp.usage, resp.stop_reason)
    if resp.stop_reason in ("refusal", "max_tokens"):
        raise DiagnosisUnavailable(f"stop_reason={resp.stop_reason}")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise DiagnosisUnavailable("no text block")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise DiagnosisUnavailable(f"invalid JSON: {e}") from e
    meta = {"id": resp.id, "model": resp.model, "stop_reason": resp.stop_reason,
            "usage": resp.usage.to_dict() if resp.usage else None}
    return parsed, meta


# ---------------------------------------------------------------- storage


def _payload(checkin: Checkin) -> dict:
    return {"child_name": checkin.student.first_name, **build_input(checkin)}


def _save(db: Session, checkin: Checkin, result: dict, model: str, raw: dict) -> Diagnosis:
    d = checkin.diagnosis
    if d is None:
        d = Diagnosis(checkin_id=checkin.id, model=model, prompt_version=PROMPT_VERSION)
        db.add(d)
        checkin.diagnosis = d
    d.error_patterns = result["error_patterns"]
    d.evidence = result["evidence"]
    d.summary = result["summary"]
    d.confidence = result["confidence"]
    d.model = model
    d.prompt_version = PROMPT_VERSION
    d.raw = raw
    return d


def refresh_rules(db: Session, checkin: Checkin) -> str | None:
    """Store the rule-based diagnosis now. Returns the new evidence hash if the evidence changed (so Claude
    should run again), else None."""
    if not checkin.items:
        return None
    inp = _payload(checkin)
    h = input_hash(inp)
    d = checkin.diagnosis
    if d is not None and d.raw.get("input_hash") == h:
        return None
    _save(db, checkin, rules.diagnose(inp, checkin.student.first_name), "rules", {"input_hash": h})
    db.commit()
    return h


async def run_claude(checkin_id: str, expected_hash: str | None = None) -> None:
    """Background task: replace the rule-based diagnosis with Claude's. Never raises.

    Waits `diagnosis_debounce_s` first and gives up if the evidence changed meanwhile (`expected_hash`): a newer
    task is queued for that, so a burst of teacher corrections costs one call. Skips when a spend cap is reached.
    """
    if not claude_enabled():
        return
    if settings.diagnosis_debounce_s > 0:
        await asyncio.sleep(settings.diagnosis_debounce_s)
    db = SessionLocal()
    try:
        checkin = db.get(Checkin, checkin_id)
        if checkin is None or not checkin.items:
            return
        inp = _payload(checkin)
        h = input_hash(inp)
        if expected_hash is not None and h != expected_hash:
            return
        if checkin.diagnosis and checkin.diagnosis.model != "rules" and checkin.diagnosis.raw.get("input_hash") == h:
            return
        reason = budget.blocked(db)
        if reason:
            log.warning("diagnosis for %s kept on rules: %s", checkin_id, reason)
            return
        try:
            parsed, meta = await call_claude(
                inp, on_usage=lambda m, u, s: budget.record(db, "diagnosis", m, u, checkin_id, s))
        except DiagnosisUnavailable as e:
            log.warning("diagnosis for %s fell back to rules: %s", checkin_id, e)
            return
        result = validate(parsed, inp)
        if result is None:
            log.warning("diagnosis for %s rejected by validation; keeping rules", checkin_id)
            return
        db.refresh(checkin)
        if input_hash(_payload(checkin)) != h:
            return  # the teacher changed the evidence meanwhile; the newer run will store its own result
        _save(db, checkin, result, meta["model"], {"input_hash": h, "response": meta,
                                                   "word_notes": result["word_notes"]})
        db.commit()
    except Exception:  # a background task must not crash the worker
        log.exception("diagnosis for %s failed", checkin_id)
    finally:
        db.close()
