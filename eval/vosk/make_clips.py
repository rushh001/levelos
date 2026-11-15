"""Step 1 of the Vosk test: the clips, made with the app's own code (run with the API's Python).

    cd api && .venv/bin/python ../eval/vosk/make_clips.py

Two sets, English and Hindi, each read by Azure's neural voice in two ways:
  scripted   the 9 scripts of eval/scripted.json (the clips the online AI is measured on), mistakes included;
  generated  16 cards per language from the app's banks (6 letter cards, 6 word cards, 4 paragraphs) with mistakes
             planted at random: a letter or word swapped for another of the bank, a word of a passage left out.
Voices:
  clean      the voice the app's instructions use, 20% slower;
  child      the same voice higher (+25% pitch) and slower (-30%): nearer a child reading, still not one.
The gold transcript is exactly what the voice was given. Writes eval/vosk/audio/<voice>/<clip>.wav and
eval/vosk/manifest.json (each clip's card, words, gold labels). Noise is added in step 2.
"""

from __future__ import annotations

import asyncio
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "api"))

from app.config import settings  # noqa: E402
from app.content import draw_card, get_item, items, languages, pool  # noqa: E402
from app.speech import http  # noqa: E402
from app.speech.align import ENGLISH_LETTER_ALIASES, read_correctly, tokenize  # noqa: E402
from app.speech.tts import OUTPUT_FORMAT, ssml  # noqa: E402
from scripts.run_clips import gold_labels, scripted, tts_parts  # noqa: E402

LANGS = ("en", "hi")
VOICES = {"clean": {"rate": "-20%", "pitch": None}, "child": {"rate": "-30%", "pitch": "+25%"}}
rng = random.Random(20261115)


def planted(lang: str) -> dict[str, dict]:
    """Cards from the bank with mistakes planted: about one in four letters or words of a card swapped for another
    of the language's pool; a passage gets two words swapped for words of other passages and one word left out."""
    out: dict[str, dict] = {}
    for level, n in (("letter", 6), ("word", 6)):
        for k in range(n):
            card = draw_card(lang, level, rng)
            units = list(card.units)
            said = []
            others = [u for u in pool(lang, level) if u not in units]
            for u in units:
                said.append(rng.choice(others) if rng.random() < 0.25 else u)
            out[f"{lang}-gen-{level}-{k}"] = {"item": card.id, "said": " ".join(said)}
    passages = [it for it in items(lang).values() if it.level == "paragraph"]
    vocab = sorted({w for it in passages for w in it.text.split()})
    for k, it in enumerate(rng.sample(passages, 4)):
        words = it.text.split()
        swap = set(rng.sample(range(len(words)), 2))
        drop = rng.choice([i for i in range(len(words)) if i not in swap])
        said = []
        for i, w in enumerate(words):
            if i == drop:
                continue
            if i in swap:
                end = w[-1] if w[-1] in ".,!?।" else ""
                said.append(rng.choice(vocab).rstrip(".,!?।") + end)
            else:
                said.append(w)
        out[f"{lang}-gen-para-{k}"] = {"item": it.id, "said": " ".join(said)}
    return out


async def speak(parts: list, lang: str, rate: str, pitch: str | None) -> bytes:
    cfg = languages()[lang]["vendors"]
    body = ssml(parts, locale=cfg["azure_stt"], voice=cfg["azure_tts"], rate=rate)
    if pitch:
        body = body.replace(f'<prosody rate="{rate}">', f'<prosody rate="{rate}" pitch="{pitch}">')
    r = await http.post(
        "azure",
        f"https://{settings.azure_speech_region}.tts.speech.microsoft.com/cognitiveservices/v1",
        timeout_s=60,
        headers={"Ocp-Apim-Subscription-Key": settings.azure_speech_key, "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": OUTPUT_FORMAT, "User-Agent": "levelos-eval"},
        content=body.encode("utf-8"),
    )
    if r.status_code != 200:
        raise RuntimeError(f"Azure TTS {r.status_code}: {r.text[:200]}")
    return r.content


async def main() -> None:
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set (api/.env)")
    clips = {name: {**c, "set": "scripted"} for name, c in scripted().items() if c["item"].split("-")[0] in LANGS}
    for lang in LANGS:
        clips.update({name: {**c, "set": "generated"} for name, c in planted(lang).items()})
    manifest = {}
    chars = 0
    for name, c in clips.items():
        item = get_item(c["item"])
        ref = tokenize(item.text, item.lang)
        gold = gold_labels(item, c["said"])
        manifest[name] = {
            "set": c["set"], "lang": item.lang, "level": item.level, "item": item.id, "letter_item": item.letter_item,
            "ref": ref, "said": c["said"], "gold": gold, "gold_correct": [read_correctly(g) for g in gold],
            # the words a restricted recogniser may choose from: the card's words (an English letter also by the
            # names and sounds the app accepts for it)
            "grammar": sorted({f for w in ref for f in (ENGLISH_LETTER_ALIASES.get(w.lower(), {w}) if item.letter_item
                                                        and item.lang == "en" else {w})}),
        }
        parts = tts_parts(c["said"], item.level)
        chars += sum(len(p) for p in parts if isinstance(p, str))
        for voice, v in VOICES.items():
            out = HERE / "audio" / voice / f"{name}.wav"
            if out.exists():
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(await speak(parts, item.lang, v["rate"], v["pitch"]))
        wrong = sum(not g for g in manifest[name]["gold_correct"])
        print(f"  {name:28s} {item.level:9s} {len(ref):3d} words, {wrong} read wrongly")
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    words = sum(len(m["ref"]) for m in manifest.values())
    wrong = sum(sum(not g for g in m["gold_correct"]) for m in manifest.values())
    print(f"{len(manifest)} clips × {len(VOICES)} voices, {words} words of which {wrong} read wrongly; "
          f"{chars * len(VOICES)} TTS characters (free tier: 500,000 a month)")


if __name__ == "__main__":
    asyncio.run(main())
