"""Pre-record the book activities' lines in every language, for reading an activity aloud with no network.

    cd api
    .venv/Scripts/python -m scripts.make_activity_audio            # every language, every book activity
    .venv/Scripts/python -m scripts.make_activity_audio --missing  # only files that do not exist yet

Online, the app reads an activity aloud with the server's voice (app/api/speech.py) and keeps the recording on the
phone. An activity made on the phone with no network has no such recording, and most phones and computers have no
voice of their own for Kannada, Tamil or Bengali; so each of the twelve book activities' title, steps and tip is
recorded once here, per language, into web/public/audio/activity/<lang>/<activity>/<part>.mp3. The app downloads
them in the background while online (not with the app itself) and plays them offline. The examples in brackets
(the letters or words of the day) are not read: they change with every activity and stay on the screen.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

from app.config import settings
from app.content import languages
from app.llm.activities import bank
from app.speech import tts

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "audio" / "activity"
LANGS = ("en", "hi", "mr", "kn", "ta", "bn")
FORMAT = "audio-16khz-32kbitrate-mono-mp3"  # small: about 4 KB a second
RATE = "-5%"  # as the server reads an activity (app/api/speech.py)
# "{letter}" outside brackets, said as "the letter" (some languages need the word inflected where it stands)
THE_LETTER = {
    "en": [("{letter}", "the letter")],
    "hi": [("{letter}", "अक्षर")],
    "mr": [("{letter} चा", "अक्षराचा"), ("{letter} ने", "त्या अक्षराने"), ("{letter}", "अक्षर")],
    "kn": [("{letter} ಇಂದ", "ಆ ಅಕ್ಷರದಿಂದ"), ("{letter}", "ಅಕ್ಷರ")],
    "ta": [("{letter} இல்", "அந்த எழுத்தில்"), ("{letter}", "எழுத்து")],
    "bn": [("{letter}-এর", "অক্ষরের"), ("{letter}", "অক্ষর")],
}


def spoken(text: str, lang: str) -> str:
    """A line as it is read with no example: brackets dropped, the title left out, {letter} said as "the letter"."""
    text = re.sub(r"\s*\([^)]*\)", "", text)
    text = re.sub(r"\s*[:：]\s*\{title\}", "", text).replace("{title}", "")
    for a, b in THE_LETTER[lang]:
        text = text.replace(a, b)
    text = re.sub(r"\s+([;,.।!?])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def labels(lang: str) -> dict:
    return json.loads((ROOT / "web" / "src" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))["activity"]


def parts(a: dict, lang: str) -> dict[str, str]:
    """The parts a teacher hears, named as the app names them (lib/speech.ts): the title, each step, the tip."""
    words = labels(lang)
    out = {"title": spoken(a["title"][lang], lang)}
    for i, s in enumerate(a["steps"]):
        out[f"step-{i}"] = f"{words['stepN'].replace('{{n}}', str(i + 1))}. {spoken(s[lang], lang)}"
    out["tip"] = f"{words['watchFor']}: {spoken(a['watch_for'][lang], lang)}"
    return out


async def main(missing_only: bool) -> None:
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set")
    chars = files = size = 0
    for lang in LANGS:
        v = languages()[lang]["vendors"]
        for a in bank()["activities"]:
            if not a.get("uses_text"):
                continue
            for part, text in parts(a, lang).items():
                path = OUT / lang / a["id"] / f"{part}.mp3"
                if missing_only and path.exists():
                    continue
                mp3 = await tts.synthesize([0.1, text, 0.4], key=settings.azure_speech_key,
                                           region=settings.azure_speech_region, locale=v["azure_stt"],
                                           voice=v["azure_tts"], rate=RATE, output_format=FORMAT)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(mp3)
                chars, files, size = chars + len(text), files + 1, size + len(mp3)
                await asyncio.sleep(3.1)  # Azure's free tier: 20 requests a minute
        print(f"  {lang}: done")
    print(f"{files} files, {size // 1024} KB, {chars} characters synthesised")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--missing", action="store_true", help="only make files that do not exist yet")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main(args.missing))
