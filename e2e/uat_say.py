"""Reads text aloud with the app's Azure voice, as a child reading a card would (for the acceptance run, uat.mjs).

    api/.venv/bin/python e2e/uat_say.py <lang> <level> <out.wav> <text…>

Letters and words come one at a time with a short gap, a passage as sentences; 20% slower than normal speech.
Uses the keys in api/.env. Clips are cached by their text, so a rerun costs nothing.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from app.config import settings  # noqa: E402
from app.content import languages  # noqa: E402
from app.speech import tts  # noqa: E402
from scripts.run_clips import tts_parts  # noqa: E402


async def main() -> None:
    lang, level, out, text = sys.argv[1], sys.argv[2], Path(sys.argv[3]), " ".join(sys.argv[4:])
    if out.exists():
        return
    cfg = languages()[lang]["vendors"]
    wav = await tts.synthesize(tts_parts(text, level), key=settings.azure_speech_key, region=settings.azure_speech_region,
                               locale=cfg["azure_stt"], voice=cfg["azure_tts"], rate="-20%")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(wav)


if __name__ == "__main__":
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set (api/.env)")
    asyncio.run(main())
