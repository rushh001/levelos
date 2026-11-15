"""Draft more reading cards with Claude, held in code to the ASER rules and to the difficulty of the language's
reviewed cards, for an educator to review. Existing cards are kept; new ones are added to content/items/<lang>.json.

  word pool    familiar words of two letters and one or two vowel signs, no conjuncts (ASER); each check draws
               its word card from the pool (app/content.py, draw_card)
  paragraphs   Std I: 4 linked sentences of at most 6 words
  stories      Std II: 7-10 linked sentences, few conjuncts

Every new paragraph and story must read like the language's first two (the reviewed ones): the same number of
sentences, no longer sentences, words no longer and no more conjuncts (within a margin) - see `fits_like`.

    .venv/Scripts/python -m scripts.draft_cards                     # all languages
    .venv/Scripts/python -m scripts.draft_cards --lang ta --stories 8
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import anthropic

from app.config import settings
from app.content import available_languages, items, languages
from app.llm.activities import aksharas
from app.speech.align import tokenize

ITEMS_DIR = settings.content_dir / "items"
DRAFTS = Path(__file__).resolve().parents[1] / ".cache" / "draft_cards"
LETTERS = "abcdefghijklmnopqrstuvwxyz"
_VIRAMA = "्্்್"


# ---------------------------------------------------------------- the rules, in code


def conjunct_words(words: list[str]) -> int:
    """Words with a conjunct (a letter joined to the next by a virama), or, in Tamil, a dead consonant inside."""
    return sum(1 for w in words if any(c in _VIRAMA for c in w.rstrip("".join(_VIRAMA))))


def stats(sentences: list[str] | tuple[str, ...], lang: str) -> dict:
    words = [w for s in sentences for w in tokenize(s, lang)]
    lens = [len(aksharas(w)) for w in words] or [0]
    return {"sentences": len(sentences), "words": len(words),
            "longest_sentence": max(len(tokenize(s, lang)) for s in sentences) if sentences else 0,
            "avg_aksharas": sum(lens) / len(lens), "longest_word": max(lens), "conjunct_words": conjunct_words(words)}


def reference(lang: str, level: str) -> list[dict]:
    """The language's reviewed cards at this level (the first two: -a and -b)."""
    return [stats(it.sentences, lang) for it in items(lang).values()
            if it.level == level and it.id.rsplit("-", 1)[-1] in ("a", "b") and it.sentences]


def fits_like(sentences: list[str], lang: str, level: str) -> list[str]:
    """Problems that make a new text harder (or other) than the language's reviewed ones (empty = fine)."""
    s, ref = stats(sentences, lang), reference(lang, level)
    top = lambda k: max(r[k] for r in ref)  # noqa: E731
    low = lambda k: min(r[k] for r in ref)  # noqa: E731
    problems = []
    if level == "paragraph":
        if s["sentences"] != 4:
            problems.append(f"{s['sentences']} sentences; a paragraph has exactly 4")
        if s["longest_sentence"] > 6:
            problems.append("a sentence has more than 6 words")
    else:
        if not 7 <= s["sentences"] <= 10:
            problems.append(f"{s['sentences']} sentences; a story has 7 to 10")
        if s["longest_sentence"] > top("longest_sentence") + 1:
            problems.append(f"a sentence has {s['longest_sentence']} words; keep each to {top('longest_sentence') + 1}")
    if not low("words") * 0.8 <= s["words"] <= top("words") * 1.2:
        problems.append(f"{s['words']} words; the reviewed ones have {low('words')}-{top('words')}")
    if s["avg_aksharas"] > top("avg_aksharas") * 1.15:
        problems.append("the words are longer on average than in the reviewed ones; use shorter, everyday words")
    if s["longest_word"] > top("longest_word") + 1:
        problems.append("a word is much longer than any in the reviewed ones")
    if s["conjunct_words"] > max(top("conjunct_words") * 1.2, top("conjunct_words") + 1):
        problems.append(f"{s['conjunct_words']} words with conjuncts; the reviewed ones have at most {top('conjunct_words')}")
    return problems


def word_problem(w: str, lang: str) -> str | None:
    """Why a word is not an ASER word-card word, or None: one word with no conjunct (Tamil: a dead consonant only at
    the end), two aksharas up to as many as the longest word on the reviewed cards (English: as many letters)."""
    if len(tokenize(w, lang)) != 1 or w != w.strip():
        return "not one word"
    if lang == "en" and not all(c in LETTERS for c in w):
        return "English: small letters only"
    if conjunct_words([w]):
        return "has a conjunct"
    size = len(w) if lang == "en" else len(aksharas(w))
    reviewed = [u for it in items(lang).values() if it.level == "word" for u in it.units or ()]
    longest = max(len(u) if lang == "en" else len(aksharas(u)) for u in reviewed)
    return None if (3 if lang == "en" else 2) <= size <= longest else "longer than the words on the reviewed cards"


# ---------------------------------------------------------------- Claude

SYSTEM = """\
You write reading cards for LevelOS, a reading check for children in Indian government primary schools that \
follows the ASER 2024 reading tool. ASER's levels: letters, words, a paragraph (Std I level) and a story (Std II \
level). Write original text (never copy ASER Centre's or any textbook's), in the language asked and its own script, \
for a child of 6-9 in a village or small town.

- Everyday things a child knows: home, family, school, animals, food, weather, play, the market, the field.
- Simple, common words; the shortest everyday word for each idea; very few conjuncts.
- No names of real people, no gods or religion, no violence, fear, illness or death, nothing a child could be \
shamed by; boys and girls alike.
- Each text is about something different, and different from the titles listed as existing.
Reply with the JSON object only."""

LEVEL_RULES = {
    "paragraph": "A paragraph: a short title and exactly 4 linked sentences about one small happening, each of at "
                 "most 6 words (most 3-5), in the style of the example.",
    "story": "A story: a short title and 7 to 10 linked sentences that tell a small story with a beginning, middle "
             "and end, each sentence short (most 4-7 words), in the style of the example.",
}

TEXTS_SCHEMA = {"type": "object", "properties": {"texts": {"type": "array", "items": {
    "type": "object", "properties": {"title": {"type": "string"}, "sentences": {"type": "array", "items": {"type": "string"}}},
    "required": ["title", "sentences"], "additionalProperties": False}}}, "required": ["texts"], "additionalProperties": False}
WORDS_SCHEMA = {"type": "object", "properties": {"words": {"type": "array", "items": {"type": "string"}}},
                "required": ["words"], "additionalProperties": False}

cost = {"input": 0, "output": 0}
_client: anthropic.Anthropic | None = None


def ask(prompt: str, schema: dict) -> dict:
    global _client
    _client = _client or anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=300.0, max_retries=3)
    resp = _client.messages.create(
        model=settings.claude_model, max_tokens=16000,
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
        system=SYSTEM, messages=[{"role": "user", "content": prompt}])
    cost["input"] += resp.usage.input_tokens
    cost["output"] += resp.usage.output_tokens
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


def draft_texts(lang: str, level: str, want: int) -> list[dict]:
    name = languages()[lang]["english_name"]
    have = [it for it in items(lang).values() if it.level == level]
    example = next(it for it in have if it.id.endswith("-a"))
    titles = [it.title for it in have if it.title]
    kept: list[dict] = []
    notes = ""
    for _ in range(4):
        need = want - len(kept)
        if need <= 0:
            break
        prompt = (f"Language: {name} ({lang}). {LEVEL_RULES[level]}\n"
                  f"Example (reviewed):\n{json.dumps({'title': example.title, 'sentences': list(example.sentences)}, ensure_ascii=False)}\n"
                  f"Existing titles (write about other things): {json.dumps(titles + [k['title'] for k in kept], ensure_ascii=False)}\n"
                  f"Write {need + 2} new {level}s.{notes}")
        out = ask(prompt, TEXTS_SCHEMA)["texts"]
        rejected = []
        for t in out:
            sentences = [s.strip() for s in t["sentences"] if s.strip()]
            problems = fits_like(sentences, lang, level)
            if not problems and t["title"].strip() and len(kept) < want:
                kept.append({"title": t["title"].strip(), "sentences": sentences})
            elif problems:
                rejected.append(f"\"{t['title']}\": {'; '.join(problems)}")
        notes = ("\nSome earlier ones broke the rules; avoid this: " + " | ".join(rejected[:6])) if rejected else ""
        print(f"  {lang} {level}: kept {len(kept)}/{want}" + (f" (rejected {len(rejected)})" if rejected else ""))
    return kept


def draft_words(lang: str, want: int) -> list[str]:
    name = languages()[lang]["english_name"]
    have = [u for it in items(lang).values() if it.level == "word" for u in it.units or ()]
    pictures = json.loads((settings.content_dir / "pictures.json").read_text(encoding="utf-8"))["words"].get(lang, {})
    rule = ("three-letter English words a child knows (like cat, sun, pen)" if lang == "en" else
            "familiar words of two letters with one or two vowel signs and no conjunct (like the examples)")
    pool = list(dict.fromkeys(have + [w for w in pictures if not word_problem(w, lang)]))
    for _ in range(3):
        if len(pool) >= want:
            break
        out = ask(f"Language: {name} ({lang}). A word card for ASER's word level: {rule}. Examples (reviewed): "
                  f"{json.dumps(have, ensure_ascii=False)}. Write {want - len(pool) + 20} more such words, all different, "
                  f"none of these: {json.dumps(pool, ensure_ascii=False)}. Concrete everyday words (things, animals, "
                  f"food, body, home, simple actions); the dictionary form a child says.", WORDS_SCHEMA)["words"]
        pool += [w.strip() for w in out if not word_problem(w.strip(), lang) and w.strip() not in pool]
        print(f"  {lang} words: {len(pool)}/{want}")
    return pool[:max(want, len(have))]


# ---------------------------------------------------------------- writing into the bank


def block(item: dict) -> str:
    """A card as the bank lays them out: one field per line, the sentences on one line."""
    fields = ",\n".join(f'      "{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in item.items())
    return "    {\n" + fields + "\n    }"


def write(lang: str, words: list[str] | None, letters: list[str] | None, new_items: list[dict]) -> None:
    path = ITEMS_DIR / f"{lang}.json"
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)
    pools = data.get("pools", {})
    if letters:
        pools["letter"] = letters
    if words:
        pools["word"] = words
    pools_text = "  \"pools\": {\n" + ",\n".join(
        f"    \"{k}\": {json.dumps(v, ensure_ascii=False)}" for k, v in pools.items()) + "\n  },\n"
    text = re.sub(r'  "pools": \{.*?\n  \},\n', "", text, flags=re.S)
    text = text.replace('  "items": [', pools_text + '  "items": [', 1)
    if new_items:
        end = text.rindex("\n  ]\n}")
        text = text[:end] + ",\n\n" + ",\n".join(block(it) for it in new_items) + text[end:]
    json.loads(text)
    path.write_text(text, encoding="utf-8", newline="\n")


LETTER_POOLS = {  # ASER: commonly used letters (the first fifteen are on the reviewed cards)
    "hi": "क म स र ल न प ग त ब ह ज द च व ख घ छ ट ड थ ध फ भ य श",
    "mr": "क म स र ळ न प ग त ण ह ज द च ब ख घ ट ड थ ध फ भ य व ल श",
    "kn": "ಕ ಮ ಸ ರ ಲ ನ ಪ ಗ ತ ಬ ಹ ಜ ದ ಚ ವ ಅ ಆ ಇ ಉ ಎ ಟ ಡ ಯ ಳ ಶ",
    "ta": "க ம ப த ட ச ந வ ல ர அ இ ய ள ன ஆ ஈ உ எ ஏ ஒ ண ற ழ",
    "bn": "ক ম স র ল ন প গ ত ব হ জ দ চ ট অ আ খ ঘ ছ ড থ ধ ফ ভ য শ",
    "en": "s m t a p d b n e g h r l o c f i j k u v w y",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", action="append", help="language code (repeatable); default: every bank")
    ap.add_argument("--paragraphs", type=int, default=10, help="paragraphs per language in all")
    ap.add_argument("--stories", type=int, default=8, help="stories per language in all")
    ap.add_argument("--words", type=int, default=60, help="words in the word pool")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    for lang in args.lang or available_languages():
        letters = LETTER_POOLS[lang].split()
        words = draft_words(lang, args.words)
        new: list[dict] = []
        for level, total, tag in (("paragraph", args.paragraphs, "para"), ("story", args.stories, "story")):
            have = [it for it in items(lang).values() if it.level == level]
            texts = draft_texts(lang, level, total - len(have))
            suffixes = [c for c in LETTERS if f"{lang}-{tag}-{c}" not in {it.id for it in have}]
            new += [{"id": f"{lang}-{tag}-{suffixes[i]}", "level": level, "title": t["title"], "sentences": t["sentences"]}
                    for i, t in enumerate(texts)]
        # kept before writing, so a failed write never loses what Claude drafted (.cache is not committed)
        DRAFTS.mkdir(parents=True, exist_ok=True)
        (DRAFTS / f"{lang}.json").write_text(json.dumps({"words": words, "items": new}, ensure_ascii=False, indent=1),
                                             encoding="utf-8")
        write(lang, words, letters, new)
        items.cache_clear()
        from app.content import bank  # noqa: PLC0415  (the bank was cached before the write)
        bank.cache_clear()
        print(f"{lang}: {len(letters)} letters, {len(words)} words, {len(new)} new texts")
    usd = cost["input"] / 1e6 * 4 + cost["output"] / 1e6 * 20  # Opus 5.5 list prices
    print(f"Claude: {cost['input']} in, {cost['output']} out, about ${usd:.2f}")


if __name__ == "__main__":
    main()
