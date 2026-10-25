"""Item banks and language config, loaded from content/. Adding a language means adding data files, not code."""

from __future__ import annotations

import json
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


def get_item(item_id: str) -> Item:
    lang = item_id.split("-", 1)[0]
    try:
        return items(lang)[item_id]
    except KeyError:
        raise KeyError(f"unknown item {item_id!r}") from None


def pick_item(lang: str, level: str, avoid: set[str] = frozenset()) -> Item:
    """First variant at this level the child has not just seen; variants rotate across check-ins."""
    candidates = [it for it in items(lang).values() if it.level == level]
    if not candidates:
        raise KeyError(f"no {level} items for {lang!r}")
    fresh = [it for it in candidates if it.id not in avoid]
    return (fresh or candidates)[0]


def instructions(lang: str) -> dict:
    return bank(lang).get("instructions", {})
