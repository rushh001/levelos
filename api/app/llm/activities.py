"""10-minute group activity: pick candidates from the curated bank, let Claude adapt one, let a second model check it.

  candidates  bank entries for the cohort, ranked by overlap with the cohort's error patterns (deterministic).
              Where the language has texts, only activities built on a real text from a free book (a credited
              public-domain or openly licensed rhyme or story) are offered, each serving an NCERT NCF-FS goal;
              the group's last activity is left out and texts rotate, so "another activity" gives something new
  generate    Claude adapts ONE candidate (schema-enforced; source_activity_id must be one of the candidates),
              around its text, with practice words copied from the text
  validate    deterministic checks (source id, minutes, steps, practice words in the text) + Claude Haiku as
              reviewer (faithful to the source, age-appropriate, safe, fits 10 minutes); one regeneration with
              the reviewer's issues
  fallback    the raw bank entry, filled with the text's words: always available, also offline
"""

from __future__ import annotations

import json
import logging
import unicodedata
from functools import lru_cache

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..content import languages, latin_script, teacher_language, text_for, texts
from ..levels.aser_rules import cohort_for_level, effective_level
from ..models import Classroom, GeneratedActivity
from .diagnose import _get_client, claude_enabled
from .patterns import PATTERNS

log = logging.getLogger(__name__)
PROMPT_VERSION = "act-v7"
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


_VIRAMA = "्্்್"


def first_akshara(word: str) -> str:
    """The first akshara of a word (base letter with its vowel sign, or a conjunct), for "words starting with …"."""
    out = word[:1]
    for c in word[1:]:
        if unicodedata.category(c) in ("Mn", "Mc") or out[-1] in _VIRAMA:
            out += c
        else:
            break
    return out


def text_examples(t: dict | None) -> dict:
    """What a text-based activity fills its steps with: the text's title, its words to find, the letter the first
    one starts with, and the letters they all start with (for letter cards)."""
    if not t:
        return {}
    words = t["words_to_find"]
    letters = list(dict.fromkeys(first_akshara(w).lower() for w in words))  # English: one card for H and h
    return {"title": t["title"], "words": ", ".join(words), "letter": letters[0] if letters else "",
            "letters": ", ".join(letters)}


_ZERO_WIDTH = dict.fromkeys(map(ord, chr(0x200C) + chr(0x200D)))  # joiners a text keeps but a typed word may not
_PUNCT = ".,!?;:'()[]–—‘’“”।॥…" + chr(34)


def bare_word(token: str) -> str:
    """A word as a teacher or the model would type it: NFC, no zero-width joiners, no punctuation, lower case."""
    w = unicodedata.normalize("NFC", token).translate(_ZERO_WIDTH)
    return "".join(c for c in w if c not in _PUNCT).strip("-").lower()


def text_words(t: dict) -> set[str]:
    """Every word of a text (and each half of a hyphenated one), as bare_word gives it."""
    out = set()
    for token in " ".join(t["lines"]).split():
        w = bare_word(token)
        out |= {w, *w.split("-")}
    return out - {""}


def from_text(words: list[str], t: dict | None) -> list[str]:
    """The practice words that occur in the text, without punctuation; a word from anywhere else is dropped."""
    if not t:
        return words
    have = text_words(t)
    return [w.strip(_PUNCT + "- ") for w in words if bare_word(w) in have]


def pick_text(language: str, kind: str, used: list[str] | tuple = (), fits=None) -> dict | None:
    """The language's text of this kind for a group: one it has not read yet, else the one it read longest ago
    (`used`: text ids of the group's activities, newest first). `fits(text)`: only texts at the group's level."""
    pool = [t for t in texts(language) if t["kind"] == kind and (fits is None or fits(t))]
    fresh = [t for t in pool if t["id"] not in used]
    if fresh or not pool:
        return fresh[0] if fresh else None
    return max(pool, key=lambda t: list(used).index(t["id"]))


# ---------------------------------------------------------------- what a group reads, by level
#
# A child who cannot read letters cannot read a word, and one who cannot read words cannot read a rhyme. So the
# children in a Letter group read only letters (taken from a rhyme the teacher says aloud), a Word group only
# single short words from it, a Paragraph group a short text (as long as ASER's paragraph, about 35 words) and
# story readers a story or a long poem. The bank entry says what it has the children read (`reads`: letters |
# words | text) and for which readers (`readers`).

_ZW = chr(0x200C) + chr(0x200D)
_NUKTA = "़়"  # Devanagari, Bengali: part of the letter (ड़, ড়)
SHORT_TEXT_WORDS, SHORT_TEXT_LINES = 35, 12
MIN_LETTERS, MAX_LETTERS, MIN_WORDS, MAX_WORDS = 3, 5, 4, 8


def aksharas(word: str) -> list[str]:
    """A word split into aksharas: a letter with its vowel signs, a conjunct kept whole (English: letters)."""
    out: list[str] = []
    for c in word:
        if out and (unicodedata.category(c) in ("Mn", "Mc") or c in _ZW or out[-1][-1] in _VIRAMA):
            out[-1] += c
        else:
            out.append(c)
    return out


def base_letter(word: str) -> str:
    """The letter a word starts with, without its vowel sign (किसने → क, கோடு → க); English in lower case."""
    if not word:
        return ""
    return (word[:2] if len(word) > 1 and word[1] in _NUKTA else word[0]).lower()


def _is_word(w: str) -> bool:
    return bool(w) and all(unicodedata.category(c)[0] in "LM" or c in _ZW for c in w)


def text_tokens(t: dict) -> list[str]:
    """The words of a text in order, as printed, without the punctuation around them."""
    return [w for w in (tok.strip(_PUNCT + "-") for tok in " ".join(t["lines"]).split()) if _is_word(w)]


def is_short(t: dict) -> bool:
    """A text a Paragraph group can read: about as long as ASER's paragraph."""
    return sum(len(line.split()) for line in t["lines"]) <= SHORT_TEXT_WORDS and len(t["lines"]) <= SHORT_TEXT_LINES


def letters_from(t: dict, prefer: list[str] | tuple = ()) -> dict:
    """Letters for a Letter group: the letters the rhyme's words start with (letters the children misread in their
    check first, then the most frequent), each with a word from the rhyme the teacher says for it."""
    counts: dict[str, int] = {}
    anchors: dict[str, str] = {}
    for w in text_tokens(t):
        b = base_letter(w)
        counts[b] = counts.get(b, 0) + 1
        if b not in anchors or len(aksharas(anchors[b])) < 2 <= len(aksharas(w)):  # "all" for a, not "a" itself
            anchors[b] = w.lower() if w.isascii() else w
    misread = {base_letter(p) for p in prefer if len(aksharas(p)) == 1}
    items = sorted(counts, key=lambda b: (b not in misread, -counts[b]))[:MAX_LETTERS]
    return {"kind": "letters", "items": items, "anchors": {b: anchors[b] for b in items}}


_TA_NO_START = "லளழறனணஙஞட"  # Tamil words do not begin with these
_TA_NO_END = ("க்", "ச்", "ஞ்", "ட்", "த்", "ப்", "ங்", "ற்")  # nor end with these


def _tamil_fragment(w: str) -> bool:
    """Tamil verse splits some words across a space (சின்னஞ் சிறு): a piece that cannot be a whole word."""
    return 0x0B80 <= ord(w[0]) <= 0x0BFF and (w[0] in _TA_NO_START or w.endswith(_TA_NO_END))


def words_from(t: dict, prefer: list[str] | tuple = ()) -> dict:
    """Words for a Word group: single short words of the rhyme (two or three aksharas; English two to five
    letters), the rhyme's own words to find and any word the children misread first, simple ones before conjuncts."""
    def simple(w: str) -> bool:
        if w.isascii():
            return 2 <= len(w) <= 5 and w.isalpha()
        return 2 <= len(aksharas(w)) <= 3 and not _tamil_fragment(w)

    tokens = [w.lower() if w.isascii() and w != "I" else w for w in text_tokens(t)]
    plain = [w for w in tokens if simple(w) and not any(c in _VIRAMA for c in w.rstrip(_VIRAMA))]
    ordered = [w for w in prefer if w in tokens] + [w for w in t["words_to_find"] if w in tokens or w.lower() in tokens]
    ordered = [w.lower() if w.isascii() else w for w in ordered]
    items: list[str] = []
    for w in ordered + plain + tokens:
        if simple(w) and w not in items:
            items.append(w)
    return {"kind": "words", "items": items[:MAX_WORDS]}


def material_for(a: dict, t: dict, prefer: list[str] | tuple = ()) -> dict | None:
    if a.get("reads") == "letters":
        m = letters_from(t, prefer)
        return m if len(m["items"]) >= MIN_LETTERS else None
    if a.get("reads") == "words":
        m = words_from(t, prefer)
        return m if len(m["items"]) >= MIN_WORDS else None
    return None


def reader_level(cohort: str, levels: dict | None = None) -> str:
    """What the group can read: its own level (each group reads at one level; `levels` is kept for callers)."""
    return cohort


def text_for_activity(a: dict, language: str, reader: str, used: list[str] | tuple = (),
                      prefer: list[str] | tuple = ()) -> tuple[dict | None, dict | None]:
    """The text an activity uses for this group, and the letters or words the children read from it."""
    kind = a["uses_text"]
    if a.get("reads") in ("letters", "words"):  # any rhyme the teacher can say: a short one first
        for fits in (is_short, None):
            t = pick_text(language, kind, used, lambda x: (fits is None or fits(x)) and material_for(a, x, prefer))
            if t:
                return t, material_for(a, t, prefer)
        return None, None
    if reader == "paragraph":
        return pick_text(language, kind, used, is_short), None
    if kind == "rhyme":  # story readers: a long poem, else a short one
        return pick_text(language, kind, used, lambda x: not is_short(x)) or pick_text(language, kind, used), None
    return pick_text(language, kind, used), None


def homework_for(t: dict) -> dict:
    """What a Paragraph or Story group takes home after reading a text: read it aloud to someone at home and copy two
    lines (a rhyme), or read it, retell it and write two sentences (a story); in every interface language."""
    return {lang: s.replace("{title}", t["title"]) for lang, s in bank()["homework"][t["kind"]].items()}


def with_text(plan: dict, a: dict) -> dict:
    """A text-based activity carries the text it is built on (picked by `candidates` or `localize`), with its author,
    licence and source, into the plan, so the teacher's screen shows the text and credits it; the model never gets
    to rewrite it. For a Letter or Word group the plan also carries the letters or words the children read, and the
    text is marked as one the teacher reads aloud."""
    t = a.get("text")
    if t:
        plan["text"] = {k: t[k] for k in ("id", "kind", "title", "author", "licence", "lines", "words_to_find")} | {
            "year": t.get("year"), "questions": t.get("questions", []), "source": t["source"], "note": t.get("note"),
            "read_aloud": bool(a.get("material"))}
    if a.get("material"):
        plan["material"] = a["material"]
    elif t:  # a Paragraph or Story group: homework on the text, not a list of single words
        plan["homework"] = homework_for(t)
    return plan


def localize(a: dict, language: str, text: dict | None = None, material: dict | None = None) -> dict:
    """The entry as a group reading in `language` sees it: example letters and words ({ex1}, {row}, …) in that
    language's script, so a Tamil group never gets Hindi examples (a language without its own falls back to the
    Hindi ones, or English for Latin script). A value given per interface language ({"en": …, "kn": …}, like the
    chart's name) goes into the text of that language. A text-based activity fills {title}, {words}, {letter} and
    {letters} from its text (`text`, or the language's first text of that kind) and from the letters or words the
    group reads (`material`), and carries both."""
    examples = a.get("examples", {})
    words = examples.get(language) or examples.get("en" if latin_script(language) else "hi") or {}
    if a.get("uses_text"):
        text = text or text_for(language, a["uses_text"])
        words = text_examples(text) | words
        if material and material["kind"] == "letters":
            words |= {"letter": material["items"][0], "letters": ", ".join(material["items"])}
        elif material:
            words |= {"words": ", ".join(material["items"])}
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

    out = {k: fill(v) for k, v in a.items() if k != "examples"}
    if a.get("uses_text") and text:
        out["text"] = text
    if material:
        out["material"] = material
    return out


# ---------------------------------------------------------------- cohort context


def cohort_context(db: Session, classroom: Classroom, cohort: str, language: str | None = None) -> dict:
    """Who is in the group in one reading language (default: the class language) and what they found hard (from
    each child's latest diagnosis in that language). No names leave here."""
    lang = language or classroom.language
    local = teacher_language(classroom.language)
    members, tally, words, levels = 0, {p: 0 for p in PATTERNS}, {}, {}
    for s in classroom.students:
        row = s.level_in(lang)
        level, _ = effective_level(row.provisional_level if row else None, row.confirmed_level if row else None)
        if ((row.cohort_override if row else None) or cohort_for_level(level)) != cohort:
            continue
        members += 1
        if level:
            levels[level] = levels.get(level, 0) + 1
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
        "levels": levels,  # how many children read at each level (the Paragraph group holds story readers too)
        "pattern_counts": {p: n for p, n in tally.items() if n},
        "misread_words": [w for w, _ in sorted(words.items(), key=lambda kv: -kv[1])][:12],
        "teacher_language": {"code": local, "name": languages()[local]["english_name"]},
    }


def candidates(cohort: str, pattern_counts: dict[str, int], k: int = 3, language: str = "hi",
               recent: dict | None = None, levels: dict | None = None, misread: list[str] | tuple = ()) -> list[dict]:
    """Bank entries for the group's reading level that work in the language's script, ranked by overlap with the
    group's error patterns. Where the language has texts, only activities built on a text are offered (a credited
    rhyme or story from a free book; each serves an NCERT NCF-FS goal), and what the children read matches the
    level: letters for a Letter group, single words for a Word group, a short text for paragraph readers, a story
    or long poem for story readers (`levels`: the group's children per level). The general method bank is kept for a
    language without texts. `recent` ({"activities": [...], "texts": [...]}, newest first, from recent_history): the
    activity the group did last is left out, so "another activity" gives another method, and each text activity gets
    the text the group has not read yet, or read longest ago. `misread`: letters or words from the children's check,
    put first where the text has them."""
    recent = recent or {}
    reader = reader_level(cohort, levels)
    used = recent.get("texts") or []
    script = "latin" if latin_script(language) else "indic"
    usable = [a for a in bank()["activities"] if a.get("script", script) == script and (
        cohort in a["cohorts"] or (cohort == "story" and "paragraph" in a["cohorts"] and not a.get("uses_text")))]
    picked = {a["id"]: text_for_activity(a, language, reader, used, misread) for a in usable
              if a.get("uses_text") and reader in a.get("readers", [cohort])}
    on_texts = [a for a in usable if picked.get(a["id"], (None,))[0]]
    pool = on_texts or [a for a in usable if not a.get("uses_text")]
    last = (recent.get("activities") or [None])[0]
    if len(pool) > 2:
        pool = [a for a in pool if a["id"] != last]
    order = {a["id"]: i for i, a in enumerate(pool)}
    ranked = sorted(pool, key=lambda a: (-sum(pattern_counts.get(p, 0) for p in a["patterns"]), "script" not in a,
                                         order[a["id"]]))
    return [localize(a, language, *picked.get(a["id"], (None, None))) for a in ranked[:k]]


def recent_history(db: Session, classroom_id: str, cohort: str, language: str, n: int = 6) -> dict:
    """The group's latest activities, newest first: the bank entries it did and the texts it read."""
    rows = db.scalars(select(GeneratedActivity).where(
        GeneratedActivity.classroom_id == classroom_id, GeneratedActivity.cohort == cohort,
        GeneratedActivity.language == language).order_by(GeneratedActivity.created_at.desc()).limit(n)).all()
    return {"activities": [g.source_activity_id for g in rows],
            "texts": [g.plan["text"]["id"] for g in rows if (g.plan or {}).get("text")]}


# ---------------------------------------------------------------- plans


def plan_from_bank(a: dict, ctx: dict) -> dict:
    t, m = a.get("text"), a.get("material")
    return with_text({
        "title": a["title"],
        "materials": a["materials"],
        "steps": a["steps"],
        "practice_words": m["items"] if m else t["words_to_find"][:6] if t else ctx["misread_words"][:6],
        "watch_for": a["watch_for"],
        "why": {"en": ""},
    }, a)


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
You adapt one activity from a curated bank into a concrete 10-minute plan for a small reading group in an Indian \
primary classroom. Each candidate is built on a real text from a free book, a classic poem or story (public domain \
or openly licensed), given in the candidate's `text` with its author; its source note names the goal of NCERT's \
foundational-stage curriculum (NCF-FS) it serves. The teacher will run it today with only what a government school \
has: board, chalk, slates, paper cards.

You receive the group (reading cohort, how many children read at each level, the language of its reading test, \
grade, group size, the error patterns most common in the group, letters or words the children misread in their \
reading check) and two to three candidate activities.

The children read only what their level allows; a child who cannot read letters cannot read a word, and one who \
cannot read words cannot read a line. Each candidate's `reads` says what the children read:
- "letters" (Letter group): the children read only the letters in `material`, one at a time. They never read a \
word, a line or the rhyme; the teacher says the rhyme and its words aloud and the children listen, repeat, clap, \
point at letters and write letters.
- "words" (Word group): the children read only the single words in `material`, one at a time, never a line or the \
rhyme; the teacher may say the rhyme aloud while they listen.
- "text" (Paragraph group): the children read the text itself; it is already short enough for them, or a story \
when most of the group reads stories.

Rules:
- Choose the one candidate that best fits the group's difficulties and set `source_activity_id` to its id. Keep \
that activity's method and its text; adapt only the wording, the examples and the timing. Do not merge activities \
or invent a new one.
- The text is shown exactly as given and credited under the plan: never rewrite, shorten or translate it. Every \
letter or word the steps use as an example comes from the candidate's `material`, or from the text when it has none.
- `practice_words`: for "letters" or "words", exactly the items in `material`. For "text", 4–8 words copied \
exactly from the text, without punctuation, chosen for the group's difficulty (for a group that drops vowel signs, \
words with vowel signs; for a group that guesses from the first letter, words that start alike); never a word that \
is not in the text.
- Every example letter or word in the steps is in the group's reading language and its script (a Tamil group gets \
Tamil letters, never Hindi ones).
- 3 or 4 steps whose minutes add up to 10. Each step is one or two short sentences a teacher can follow while \
standing in front of the group, in English (`en`) and in the teacher's language (`local`; `teacher_language` \
names it: Hindi, Marathi, Kannada, Tamil or Bengali), in plain everyday words and that language's own script. \
Every `*_local` field (title, materials, steps, watch_for, why) is in that language.
- `why_en` / `why_local`: one sentence linking the activity and its text to the group's difficulty, in plain words.
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
- fits_level: the children only read what the source activity's `reads` allows: single letters for "letters" \
(never a word, a line or the rhyme; listening to the teacher say them is fine), single words for "words" (never a \
line or the rhyme), the text for "text".
- issues: short, specific problems (empty if none). Judge only; do not rewrite the activity.
"""

VALIDATION_SCHEMA = {
    "type": "object",
    "properties": {
        "faithful_to_source": {"type": "boolean"},
        "age_appropriate": {"type": "boolean"},
        "safe": {"type": "boolean"},
        "fits_10_minutes": {"type": "boolean"},
        "fits_level": {"type": "boolean"},
        "issues": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["faithful_to_source", "age_appropriate", "safe", "fits_10_minutes", "fits_level", "issues"],
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
    return all(v.get(k) is True for k in ("faithful_to_source", "age_appropriate", "safe", "fits_10_minutes", "fits_level"))


def _bank_view(a: dict) -> dict:
    view = {k: a[k] for k in ("id", "title", "patterns", "minutes", "materials", "steps", "watch_for")} | {
        "source": source_of(a), "reads": a.get("reads", "text")}
    t = a.get("text")
    if t:
        view["text"] = {k: t[k] for k in ("title", "author", "licence", "lines")} | {"questions": t.get("questions", [])}
    if a.get("material"):
        view["material"] = a["material"]["items"]
    return view


async def generate(ctx: dict, *, recent: dict | None = None, blocked: str | None = None, on_usage=None) -> dict:
    """Returns {source_activity_id, plan, validation, accepted, generated_by}.
    `recent`: the group's recent activities and texts (recent_history), so a new plan is a different one;
    `blocked`: why Claude may not be called (spend cap); `on_usage(purpose, model, usage, stop_reason)` logs cost."""
    cands = candidates(ctx["cohort"], ctx["pattern_counts"], language=ctx["language"], recent=recent,
                       levels=ctx.get("levels"), misread=ctx.get("misread_words", []))
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
            chosen = next(a for a in cands if a["id"] == out["source_activity_id"])
            if chosen.get("material"):  # a Letter or Word group practises exactly its letters or words
                out["practice_words"] = list(chosen["material"]["items"])
            elif chosen.get("text"):  # practice words come from the text; a word from elsewhere is dropped
                kept = from_text(out["practice_words"], chosen["text"])
                if len(kept) < 3:
                    problems = ["practice_words must be 4-8 words copied exactly from the text"]
                out["practice_words"] = kept
        if not problems:
            try:
                verdict = await call_validate(_bank_view(chosen), plan_from_claude(out, local), ctx, on_usage)
            except ActivityUnavailable as e:
                verdict = {"error": str(e)}
            if verdict.get("error"):
                problems = ["reviewer unavailable"]
            elif not _passes(verdict):
                problems = verdict.get("issues") or ["rejected by the reviewer"]
        attempts.append({"problems": problems, "review": verdict})
        if not problems:
            return {"source_activity_id": out["source_activity_id"], "plan": with_text(plan_from_claude(out, local), chosen),
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
