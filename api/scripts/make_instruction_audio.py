"""Pre-generate the spoken instruction for each item level, per language, into web/public/audio/<lang>/<level>.mp3,
and the English test's instructions in each other language into web/public/audio/en-<lang>/<level>.mp3.

    cd api
    .venv/Scripts/python -m scripts.make_instruction_audio            # every language with an item bank
    .venv/Scripts/python -m scripts.make_instruction_audio --lang hi
    .venv/Scripts/python -m scripts.make_instruction_audio --missing  # only files that do not exist yet

The files ship with the app and are precached by the service worker, so the child hears the instruction even
offline. Text comes from the item bank's `instructions`; voices from content/languages.json (`azure_tts`). A
regional-language test is explained in that language; the English test in the class's language (as ASER gives
its English test's instructions in the child's language), so it has a version per language. Uses Azure neural TTS
(a few hundred characters in total).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from app.config import settings
from app.content import available_languages, instructions, languages
from app.speech import tts

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "audio"
LEVELS = ["letter", "word", "paragraph", "story"]


def targets(langs: list[str]) -> list[tuple[str, str]]:
    """(test language, spoken language) pairs: every test in its own language, plus the English test in each other
    language its bank has instructions for."""
    pairs = [(lang, lang) for lang in langs]
    if "en" in langs:
        spoken = {s for level in instructions("en").values() for s in level} - {"en"}
        pairs += [("en", s) for s in sorted(spoken) if s in languages()]
    return pairs


async def main(langs: list[str], missing_only: bool) -> None:
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set")
    chars = 0
    for test, spoken in targets(langs):
        v = languages()[spoken]["vendors"]
        for level in LEVELS:
            text = instructions(test).get(level, {}).get(spoken)
            path = OUT / (test if spoken == test else f"{test}-{spoken}") / f"{level}.mp3"
            if not text or (missing_only and path.exists()):
                continue
            mp3 = await tts.synthesize([0.2, text, 0.3], key=settings.azure_speech_key,
                                       region=settings.azure_speech_region, locale=v["azure_stt"],
                                       voice=v["azure_tts"], rate="-10%", output_format=tts.MP3_FORMAT)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(mp3)
            chars += len(text)
            print(f"  {path.relative_to(OUT.parents[1])}  {len(mp3) // 1024} KB  {text}")
    print(f"{chars} characters synthesised")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", action="append", help="language code (repeatable); default: all with an item bank")
    ap.add_argument("--missing", action="store_true", help="only make files that do not exist yet")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main(args.lang or available_languages(), args.missing))
