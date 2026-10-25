"""10-minute group activity: pick candidates from the curated bank, let Claude adapt one, let a second model check it.

  candidates  bank entries for the cohort, ranked by overlap with the cohort's error patterns (deterministic)
  generate    Claude adapts ONE candidate (schema-enforced; source_activity_id must be one of the candidates),
              using the group's actually misread words as practice material
  validate    deterministic checks (source id, minutes, steps) + Claude Haiku as reviewer (faithful to the
              source, age-appropriate, safe, fits 10 minutes); one regeneration with the reviewer's issues
  fallback    the raw bank entry, filled with the group's practice words: always available, also offline
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache

import anthropic
from sqlalchemy.orm import Session

from ..config import settings
from ..content import languages, latin_script, teacher_language
from ..levels.aser_rules import cohort_for_level, effective_level
from ..models import Classroom
from .diagnose import _get_client, claude_enabled
from .patterns import PATTERNS

log = logging.getLogger(__name__)
PROMPT_VERSION = "act-v4"
MIN_MINUTES, MAX_MINUTES = 8, 12


@lru_cache(maxsize=1)
def bank() -> dict:
    return json.loads((settings.content_dir / "activities" / "bank.json").read_text(encoding="utf-8"))


def entry(activity_id: str) -> dict | None:
    return next((a for a in bank()["activities"] if a["id"] == activity_id), None)


def source_of(a: dict) -> dict:
    """The source, its note in English (`note`) and in each interface language it has (`note_hi`, `note_kn`, …)."""
    src = bank()["sources"][a["source"]["ref"]]
    return {"name": src["name"], "url": src["url"]} | {k: v for k, v in a["source"].items() if k.startswith("note")}


def ui_languages() -> set[str]:
    return {"en"} | {code for code, cfg in languages().items() if cfg.get("ui")}


def localize(a: dict, language: str) -> dict:
    """The entry as a group reading in `language` sees it: example letters and words ({ex1}, {row}, …) in that
    language's script, so a Tamil group never gets Hindi examples (a language without its own falls back to the
    Hindi ones, or English for Latin script). A value given per interface language ({"en": …, "kn": …}, like the
    chart's name) goes into the text of that language."""
    examples = a.get("examples", {})
    words = examples.get(language) or examples.get("en" if latin_script(language) else "hi") or {}
    ui_langs = ui_languages()

    def fill(v, ui: str = "en"):
        if isinstance(v, str):
            for key, word in words.items():
                v = v.replace("{" + key + "}", word.get(ui) or word["en"] if isinstance(word, dict) else word)
            return v
        if isinstance(v, list):
            return [fill(x, ui) for x in v]
        if isinstance(v, dict):
            return {k: fill(x, k if k in ui_langs else ui) for k, x in v.items()}
        return v

    return {k: fill(v) for k, v in a.items() if k != "examples"}


# ---------------------------------------------------------------- cohort context


def cohort_context(db: Session, classroom: Classroom, cohort: str, language: str | None = None) -> dict:
    """Who is in the group in one reading language (default: the class language) and what they found hard (from
    each child's latest diagnosis in that language). No names leave here."""
    lang = language or classroom.language
    local = teacher_language(classroom.language)
    members, tally, words = 0, {p: 0 for p in PATTERNS}, {}
    for s in classroom.students:
        row = s.level_in(lang)
        level, _ = effective_level(row.provisional_level if row else None, row.confirmed_level if row else None)
        if ((row.cohort_override if row else None) or cohort_for_level(level)) != cohort:
            continue
        members += 1
        latest = next((c for c in sorted(s.checkins, key=lambda c: c.started_at, reverse=True)
                       if c.language == lang and c.diagnosis and c.status in ("scored", "needs_review")), None)
        if latest is None:
            continue
        for p in latest.diagnosis.error_patterns[:2]:
            tally[p] += 1
        for ev in latest.diagnosis.evidence:
            for w in ev["words"]:
                words[w["ref"]] = words.get(w["ref"], 0) + 1
    return {
        "cohort": cohort,
        "language": lang,
        "grade": classroom.grade,
        "group_size": members,
        "pattern_counts": {p: n for p, n in tally.items() if n},
        "misread_words": [w for w, _ in sorted(words.items(), key=lambda kv: -kv[1])][:12],
        "teacher_language": {"code": local, "name": languages()[local]["english_name"]},
    }


def candidates(cohort: str, pattern_counts: dict[str, int], k: int = 3, language: str = "hi") -> list[dict]:
    """Bank entries for the cohort that work in the language's script (barakhadi and matras are not for English,
    phonics charts are not for Hindi), ranked by overlap with the group's error patterns; on a tie, a method made
    for the script comes before a general one."""
    script = "latin" if latin_script(language) else "indic"
    pool = [a for a in bank()["activities"] if cohort in a["cohorts"] and a.get("script", script) == script]
    order = {a["id"]: i for i, a in enumerate(pool)}
    ranked = sorted(pool, key=lambda a: (-sum(pattern_counts.get(p, 0) for p in a["patterns"]), "script" not in a,
                                         order[a["id"]]))
    return [localize(a, language) for a in ranked[:k]]


# ---------------------------------------------------------------- plans


def plan_from_bank(a: dict, ctx: dict) -> dict:
    return {
        "title": a["title"],
        "materials": a["materials"],
        "steps": a["steps"],
        "practice_words": ctx["misread_words"][:6],
        "watch_for": a["watch_for"],
        "why": {"en": ""},
    }


def plan_from_claude(out: dict, local: str) -> dict:
    """Claude's plan, its teacher's-language text filed under that language's code (`local`: hi, kn, ta, …)."""
    return {
        "title": {"en": out["title_en"], local: out["title_local"]},
        "materials": {"en": out["materials_en"], local: out["materials_local"]},
        "steps": [{"minutes": s["minutes"], "en": s["en"], local: s["local"]} for s in out["steps"]],
        "practice_words": out["practice_words"],
        "watch_for": {"en": out["watch_for_en"], local: out["watch_for_local"]},
        "why": {"en": out["why_en"], local: out["why_local"]},
    }


def check_plan(out: dict, allowed: list[str]) -> list[str]:
    """Deterministic guardrails on a generated plan; returns problems (empty = fine)."""
    problems = []
    if out.get("source_activity_id") not in allowed:
        problems.append("source_activity_id is not one of the candidates")
    steps = out.get("steps") or []
    total = sum(int(s.get("minutes", 0)) for s in steps)
    if not 2 <= len(steps) <= 6:
        problems.append(f"{len(steps)} steps; use 3 or 4")
    if not MIN_MINUTES <= total <= MAX_MINUTES:
        problems.append(f"steps add up to {total} minutes; the plan must take about 10")
    for key in ("title_en", "title_local", "watch_for_en", "watch_for_local"):
        if not str(out.get(key, "")).strip():
            problems.append(f"{key} is empty")
    if any(not str(s.get("en", "")).strip() or not str(s.get("local", "")).strip() for s in steps):
        problems.append("every step needs English and teacher's-language text")
    return problems


# ---------------------------------------------------------------- Claude calls

GENERATE_SYSTEM = """\
You adapt one activity from a curated teaching-activity bank into a concrete 10-minute plan for a small reading \
group in an Indian primary classroom (Teaching at the Right Level). The teacher will run it today with only \
what a government school has: board, chalk, slates, paper cards, the children's books.

You receive the group (reading cohort, the language of its reading test, grade, group size, the error patterns most common in the \
group, words the children actually misread) and two to three candidate activities from the bank, each with its \
source.

Rules:
- Choose the one candidate that best fits the group's difficulties and set `source_activity_id` to its id. Keep \
that activity's method; adapt only the content, wording and timing. Do not merge activities or invent a new one.
- Use the group's misread words as practice material where the activity allows (`practice_words`: 4–8 words in \
the group's reading language, taken from the misread words or close variants that train the same difficulty).
- Every example letter or word in the steps is in the group's reading language and its script (a Tamil group gets \
Tamil letters, never Hindi ones), as the candidates already show.
- 3 or 4 steps whose minutes add up to 10. Each step is one or two short sentences a teacher can follow while \
standing in front of the group, in English (`en`) and in the teacher's language (`local`; `teacher_language` \
names it: Hindi, Marathi, Kannada, Tamil or Bengali), in plain everyday words and that language's own script. \
Every `*_local` field (title, materials, steps, watch_for, why) is in that language.
- `why_en` / `why_local`: one sentence linking the activity to the group's difficulty, in plain words.
- No children's names, no scores or labels for children, nothing that shames a child, nothing unsafe.
"""

VALIDATE_SYSTEM = """\
You review a generated 10-minute classroom reading activity for 6–9 year olds against the bank activity it \
claims to adapt. Answer strictly:
- faithful_to_source: it keeps the source activity's method (adapting content and wording is fine; a different \
activity is not).
- age_appropriate: suitable for a mixed group of 6–9 year olds in an Indian primary classroom.
- safe: nothing physically risky, shaming, or inappropriate.
- fits_10_minutes: the steps can realistically be done in about 10 minutes.
- issues: short, specific problems (empty if none). Judge only; do not rewrite the activity.
"""

VALIDATION_SCHEMA = {
    "type": "object",
    "properties": {
        "faithful_to_source": {"type": "boolean"},
        "age_appropriate": {"type": "boolean"},
        "safe": {"type": "boolean"},
        "fits_10_minutes": {"type": "boolean"},
        "issues": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["faithful_to_source", "age_appropriate", "safe", "fits_10_minutes", "issues"],
    "additionalProperties": False,
}


def generation_schema(candidate_ids: list[str]) -> dict:
    text = {"type": "string"}
    texts = {"type": "array", "items": {"type": "string"}}
    return {
        "type": "object",
        "properties": {
            "source_activity_id": {"type": "string", "enum": candidate_ids},
            "title_en": text, "title_local": text,
            "materials_en": texts, "materials_local": texts,
            "steps": {"type": "array", "items": {
                "type": "object",
                "properties": {"minutes": {"type": "integer"}, "en": text, "local": text},
                "required": ["minutes", "en", "local"],
                "additionalProperties": False,
            }},
            "practice_words": texts,
            "watch_for_en": text, "watch_for_local": text,
            "why_en": text, "why_local": text,
        },
        "required": ["source_activity_id", "title_en", "title_local", "materials_en", "materials_local", "steps",
                     "practice_words", "watch_for_en", "watch_for_local", "why_en", "why_local"],
        "additionalProperties": False,
    }


class ActivityUnavailable(Exception):
    pass


def _text_json(resp) -> dict:
    if resp.stop_reason in ("refusal", "max_tokens"):
        raise ActivityUnavailable(f"stop_reason={resp.stop_reason}")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise ActivityUnavailable("no text block")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ActivityUnavailable(f"invalid JSON: {e}") from e


async def call_generate(messages: list[dict], candidate_ids: list[str], on_usage=None) -> dict:
    try:
        resp = await _get_client().beta.messages.create(
            model=settings.claude_model,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": settings.claude_activity_effort,
                           "format": {"type": "json_schema", "schema": generation_schema(candidate_ids)}},
            system=[{"type": "text", "text": GENERATE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
        )
    except anthropic.APIError as e:
        raise ActivityUnavailable(f"{type(e).__name__}: {e}") from e
    if on_usage is not None:
        on_usage("activity", resp.model, resp.usage, resp.stop_reason)
    return _text_json(resp)


async def call_validate(source: dict, plan: dict, ctx: dict, on_usage=None) -> dict:
    payload = {"group": {k: ctx[k] for k in ("cohort", "language", "grade", "group_size")},
               "source_activity": source, "generated_plan": plan}
    try:
        resp = await _get_client().messages.create(
            model=settings.claude_validator_model,
            max_tokens=4000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": VALIDATION_SCHEMA}},
            system=VALIDATE_SYSTEM,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except anthropic.APIError as e:
        raise ActivityUnavailable(f"{type(e).__name__}: {e}") from e
    if on_usage is not None:
        on_usage("activity_review", resp.model, resp.usage, resp.stop_reason)
    return _text_json(resp)


def _passes(v: dict) -> bool:
    return all(v.get(k) is True for k in ("faithful_to_source", "age_appropriate", "safe", "fits_10_minutes"))


def _bank_view(a: dict) -> dict:
    return {k: a[k] for k in ("id", "title", "patterns", "minutes", "materials", "steps", "watch_for")} | {
        "source": source_of(a)}


async def generate(ctx: dict, *, blocked: str | None = None, on_usage=None) -> dict:
    """Returns {source_activity_id, plan, validation, accepted, generated_by}.
    `blocked`: why Claude may not be called (spend cap); `on_usage(purpose, model, usage, stop_reason)` logs cost."""
    cands = candidates(ctx["cohort"], ctx["pattern_counts"], language=ctx["language"])
    best = cands[0]
    fallback = {"source_activity_id": best["id"], "plan": plan_from_bank(best, ctx), "accepted": False,
                "generated_by": "bank"}
    if not claude_enabled():
        return fallback | {"validation": {"skipped": "no Claude key"}}
    if blocked:
        return fallback | {"validation": {"skipped": blocked}}

    ids, local = [a["id"] for a in cands], ctx["teacher_language"]["code"]
    messages = [{"role": "user", "content": json.dumps(
        {"group": ctx, "candidates": [_bank_view(a) for a in cands]}, ensure_ascii=False)}]
    attempts = []
    for _ in range(2):
        try:
            out = await call_generate(messages, ids, on_usage)
        except ActivityUnavailable as e:
            attempts.append({"error": str(e)})
            break
        problems = check_plan(out, ids)
        verdict: dict = {}
        if not problems:
            try:
                chosen = next(a for a in cands if a["id"] == out["source_activity_id"])
                verdict = await call_validate(_bank_view(chosen), plan_from_claude(out, local), ctx, on_usage)
            except ActivityUnavailable as e:
                verdict = {"error": str(e)}
            if verdict.get("error"):
                problems = ["reviewer unavailable"]
            elif not _passes(verdict):
                problems = verdict.get("issues") or ["rejected by the reviewer"]
        attempts.append({"problems": problems, "review": verdict})
        if not problems:
            return {"source_activity_id": out["source_activity_id"], "plan": plan_from_claude(out, local),
                    "validation": {"attempts": attempts}, "accepted": True, "generated_by": settings.claude_model}
        if problems == ["reviewer unavailable"]:
            break
        messages = messages + [
            {"role": "assistant", "content": json.dumps(out, ensure_ascii=False)},
            {"role": "user", "content": "A reviewer found these problems; fix them and return the full plan again: "
                                        + "; ".join(problems)},
        ]
    log.warning("activity generation fell back to the bank entry: %s", attempts)
    return fallback | {"validation": {"attempts": attempts}}
