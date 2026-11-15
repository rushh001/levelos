"""Item banks and language config, loaded from content/. Adding a language means adding data files, not code."""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from functools import lru_cache

from .config import settings


@dataclass(frozen=True)
class Item:
    id: str
    lang: str
    level: str  # letter | word | paragraph | story
    units: tuple[str, ...] | None = None  # letter and word cards
    sentences: tuple[str, ...] | None = None  # paragraph and story
    title: str | None = None

    @property
    def text(self) -> str:
        return " ".join(self.units or self.sentences or ())

    @property
    def letter_item(self) -> bool:
        return self.level == "letter"

    def public(self) -> dict:
        return {"id": self.id, "lang": self.lang, "level": self.level, "units": self.units,
                "sentences": self.sentences, "title": self.title}


@lru_cache(maxsize=1)
def languages() -> dict[str, dict]:
    data = json.loads((settings.content_dir / "languages.json").read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


@lru_cache(maxsize=None)
def bank(lang: str) -> dict:
    path = settings.content_dir / "items" / f"{lang}.json"
    if not path.exists():
        raise KeyError(f"no item bank for language {lang!r}")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def items(lang: str) -> dict[str, Item]:
    out: dict[str, Item] = {}
    for raw in bank(lang)["items"]:
        out[raw["id"]] = Item(
            id=raw["id"],
            lang=lang,
            level=raw["level"],
            units=tuple(raw["units"]) if raw.get("units") else None,
            sentences=tuple(raw["sentences"]) if raw.get("sentences") else None,
            title=raw.get("title"),
        )
    return out


def available_languages() -> list[str]:
    return [lang for lang in languages() if (settings.content_dir / "items" / f"{lang}.json").exists()]


def reading_languages(main: str) -> list[str]:
    """The reading tests a child takes, as in ASER: their regional language and English (each only with an item bank)."""
    available = available_languages()
    return [lang for lang in dict.fromkeys((main, "en")) if lang in available]


def latin_script(lang: str) -> bool:
    return languages().get(lang, {}).get("script") == "Latin"


def teacher_language(main: str) -> str:
    """The language a teacher reads diagnoses and activities in besides English: the class's own language when the
    app has an interface in it (a Kannada class: Kannada), else Hindi."""
    return main if main != "en" and languages().get(main, {}).get("ui") else "hi"


def wcpm_floor(lang: str, level: str) -> float | None:
    """The language's own reading-speed floor for a passage level, if its words are longer than Hindi's."""
    return languages().get(lang, {}).get("wcpm_floor", {}).get(level)


# A letter or word card is drawn for each check from the language's pool (ASER: commonly used letters; familiar
# words of two letters and one or two vowel signs, no conjuncts), so children rarely see the same card twice and a
# child waiting nearby cannot learn it from the one before. Its id carries its letters or words
# ("hi-word~गाय~पानी~मोर~केला~दिन"), so scoring, replay and the phone's offline checks need nothing else.
CARD_SIZE = 5
CARD_SEP = "~"
PICTURED_WORDS = 2  # a word card has at least two words with a picture, for the meaning step


def pool(lang: str, level: str) -> tuple[str, ...]:
    """The language's pool of letters or words a card is drawn from (empty: only the fixed cards)."""
    try:
        return tuple(bank(lang).get("pools", {}).get(level, ()))
    except KeyError:
        return ()


@lru_cache(maxsize=1)
def _pictures() -> dict[str, dict[str, str]]:
    return json.loads((settings.content_dir / "pictures.json").read_text(encoding="utf-8"))["words"]


def pictured(lang: str) -> set[str]:
    """Words the app has a picture for (the meaning step after a word card)."""
    return set(_pictures().get(lang, {}))


def drawn_card(lang: str, level: str, units: list[str] | tuple[str, ...]) -> Item:
    return Item(id=f"{lang}-{level}{CARD_SEP}{CARD_SEP.join(units)}", lang=lang, level=level, units=tuple(units))


def get_item(item_id: str) -> Item:
    lang = item_id.split("-", 1)[0]
    try:
        if CARD_SEP in item_id:  # a drawn card: every letter or word must be one of the language's
            head, *units = item_id.split(CARD_SEP)
            level = head.split("-", 1)[1]
            known = set(pool(lang, level)) | {u for it in items(lang).values() if it.level == level for u in it.units or ()}
            if level in ("letter", "word") and len(set(units)) == len(units) == CARD_SIZE and set(units) <= known:
                return drawn_card(lang, level, units)
            raise KeyError(item_id)
        return items(lang)[item_id]
    except (KeyError, IndexError):
        raise KeyError(f"unknown item {item_id!r}") from None


def draw_card(lang: str, level: str, rng: random.Random, avoid_units: set[str] | frozenset = frozenset()) -> Item | None:
    """Five letters or words from the pool, none the child read lately while the pool has enough others; a word
    card has at least two words with a picture. None without a pool."""
    p = list(pool(lang, level))
    if len(p) < CARD_SIZE * 2:
        return None
    fresh = [u for u in p if u not in avoid_units]
    source = fresh if len(fresh) >= CARD_SIZE * 2 else p
    chosen: list[str] = []
    if level == "word":
        pics = [u for u in source if u in pictured(lang)]
        chosen = rng.sample(pics, min(PICTURED_WORDS, len(pics)))
    chosen += rng.sample([u for u in source if u not in chosen], CARD_SIZE - len(chosen))
    rng.shuffle(chosen)
    return drawn_card(lang, level, chosen)


def pick_item(lang: str, level: str, avoid: set[str] = frozenset(), seed: str | None = None,
              avoid_units: set[str] | frozenset = frozenset()) -> Item:
    """The card for the next rung. With a `seed` (one per check and position, so a check always gets the same card
    back): a letter or word card drawn from the language's pool, or a paragraph or story chosen at random among
    those not in `avoid`. Without one: the first fixed card not in `avoid` (seeding, tests)."""
    rng = random.Random(seed) if seed is not None else None
    if rng and level in ("letter", "word") and (card := draw_card(lang, level, rng, avoid_units)):
        return card
    candidates = [it for it in items(lang).values() if it.level == level]
    if not candidates:
        raise KeyError(f"no {level} items for {lang!r}")
    choices = [it for it in candidates if it.id not in avoid] or candidates
    return rng.choice(choices) if rng else choices[0]


def instructions(lang: str) -> dict:
    return bank(lang).get("instructions", {})


TEXT_KINDS = ("rhyme", "story")


def texts(lang: str) -> list[dict]:
    """Free-to-use texts a group reads in `lang` (public domain or Creative Commons BY, each credited on the
    activity): content/texts/<lang>.json, or none."""
    path = settings.content_dir / "texts" / f"{lang}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))["texts"]


def text_for(lang: str, kind: str) -> dict | None:
    """The first text of this kind (rhyme | story) in the language, or None when it has none."""
    return next((t for t in texts(lang) if t["kind"] == kind), None)
