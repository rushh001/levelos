"""Pre-generate the spoken instruction for each item level, per language, into web/public/audio/<lang>/<level>.mp3.

    cd api
    .venv/Scripts/python -m scripts.make_instruction_audio            # every language with an item bank
    .venv/Scripts/python -m scripts.make_instruction_audio --lang hi
    .venv/Scripts/python -m scripts.make_instruction_audio --missing  # only files that do not exist yet

The files ship with the app and are precached by the service worker, so the child hears the instruction even
offline. Text comes from the item bank's `instructions`; voices from content/languages.json (`azure_tts`). Each
test is explained in its own language, like everything else on the screen (the Hindi test in Hindi, the English
test in English). Uses Azure neural TTS (a few hundred characters in total).
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


async def main(langs: list[str], missing_only: bool) -> None:
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set")
    chars = 0
    for lang in langs:
        v = languages()[lang]["vendors"]
        for level in LEVELS:
            text = instructions(lang).get(level, {}).get(lang)
            path = OUT / lang / f"{level}.mp3"
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
