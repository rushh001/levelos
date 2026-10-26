"""Pre-record each line of the "Rhyme and read" rhymes (content/rhymes/<lang>.json) with the language's Azure
neural voice into web/public/audio/rhyme/<lang>/<n>.mp3, so the screen plays them offline.

    cd api
    .venv/Scripts/python -m scripts.make_rhyme_audio            # every rhyme
    .venv/Scripts/python -m scripts.make_rhyme_audio --missing  # only lines without a file yet
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.config import settings
from app.content import languages
from app.speech import tts

ROOT = Path(__file__).resolve().parents[2]
RHYMES = ROOT / "content" / "rhymes"
OUT = ROOT / "web" / "public" / "audio" / "rhyme"


async def main(missing_only: bool) -> None:
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set")
    chars = 0
    for path in sorted(RHYMES.glob("*.json")):
        rhyme = json.loads(path.read_text(encoding="utf-8"))
        lang = rhyme["language"]
        v = languages()[lang]["vendors"]
        for n, line in enumerate(rhyme["lines"], start=1):
            out = OUT / lang / f"{n}.mp3"
            if missing_only and out.exists():
                continue
            mp3 = await tts.synthesize([0.1, line, 0.2], key=settings.azure_speech_key, region=settings.azure_speech_region,
                                       locale=v["azure_stt"], voice=v["azure_tts"], rate="-12%", output_format=tts.MP3_FORMAT)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(mp3)
            chars += len(line)
            print(f"  {out.relative_to(ROOT)}  {len(mp3) // 1024} KB  {line}")
    print(f"{chars} characters synthesised")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--missing", action="store_true", help="only make files that do not exist yet")
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main(ap.parse_args().missing))
