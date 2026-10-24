"""Run scripted test clips through every speech path and compare with the gold transcripts.

    cd api
    .venv/Scripts/python -m scripts.run_clips --tts          # make synthetic clips from eval/scripted.json (free)
    .venv/Scripts/python -m scripts.run_clips clips_tts      # score them (spends a little vendor credit, cached)
    .venv/Scripts/python -m scripts.run_clips clips          # score real recordings in eval/clips/

A clip is matched to its script by file name: eval/<dir>/<clip-name>.<ext> with <clip-name> a key of
eval/scripted.json. Files named <item-id>__anything are scored without a gold transcript. Responses are cached
in api/.cache/speech, so re-running costs nothing. Results go to eval/results/<dir>.json.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.config import settings
from app.content import get_item, languages
from app.speech import audio, tts
from app.speech.align import fuse, read_correctly, tokenize
from app.speech.scorer import score_item

EVAL = Path(__file__).resolve().parents[2] / "eval"
AUDIO_EXT = {".wav", ".m4a", ".mp3", ".ogg", ".oga", ".opus", ".webm", ".aac", ".amr", ".3gp"}


def scripted(dir_name: str | None = None) -> dict:
    """The script, with eval/gold/<dir>.json (what was actually said, confirmed by listening back) on top."""
    clips = json.loads((EVAL / "scripted.json").read_text(encoding="utf-8"))["clips"]
    gold = EVAL / "gold" / f"{dir_name}.json"
    if dir_name and gold.exists():
        clips = {**clips, **json.loads(gold.read_text(encoding="utf-8"))["clips"]}
    return clips


# ---------------------------------------------------------------- synthetic clips


def tts_parts(said: str, level: str) -> list[str | float]:
    parts: list[str | float] = [0.5]
    if level in ("letter", "word"):
        for unit in said.split():
            parts += [unit, 0.9]
    else:
        for i, chunk in enumerate(said.split("⏸")):
            if i:
                parts.append(4.0)
            parts.append(chunk.strip())
        parts.append(0.5)
    return parts


async def make_tts(out_dir: Path, only: set[str] | None) -> None:
    """Regenerated audio differs byte-for-byte, which misses the response cache: regenerate only what changed."""
    if not settings.azure_speech_key:
        sys.exit("AZURE_SPEECH_KEY is not set")
    out_dir.mkdir(parents=True, exist_ok=True)
    chars = 0
    for name, clip in scripted().items():
        if only and name not in only:
            continue
        item = get_item(clip["item"])
        voice = languages()[item.lang]["vendors"]["azure_tts"]
        locale = languages()[item.lang]["vendors"]["azure_stt"]
        parts = tts_parts(clip["said"], item.level)
        chars += sum(len(p) for p in parts if isinstance(p, str))
        wav = await tts.synthesize(parts, key=settings.azure_speech_key, region=settings.azure_speech_region,
                                   locale=locale, voice=voice, rate="-20%")
        (out_dir / f"{name}.wav").write_bytes(wav)
        print(f"  {name}.wav  {audio.wav_duration_ms(wav) / 1000:.1f}s")
    print(f"{chars} TTS characters (F0 includes 500,000/month)")


# ---------------------------------------------------------------- scoring


def gold_labels(item, said: str) -> list[str]:
    ref = tokenize(item.text, item.lang)
    return [w.label for w in fuse(ref, {"gold": tokenize(said, item.lang)}, item.lang, letter_item=item.letter_item)]


def clip_files(d: Path) -> list[Path]:
    return sorted(p for p in d.iterdir() if p.suffix.lower() in AUDIO_EXT)


async def run(dir_name: str, only: set[str] | None, gemini: bool = True) -> None:
    d = EVAL / dir_name
    if not d.is_dir():
        sys.exit(f"{d} does not exist")
    files = clip_files(d)
    if only:
        files = [f for f in files if f.name.split(".")[0] in only]
    script = scripted(dir_name)
    total_s = 0.0
    report = []
    agree: dict[str, list[int]] = {}

    for f in files:
        name = f.name.split(".")[0]  # phone apps add double extensions (x.m4a.mp4)
        clip = script.get(name)
        item = get_item(clip["item"] if clip else name.split("__")[0])
        child = "child" in name
        s = await score_item(f.read_bytes(), item, suffix=f.suffix, allow_gemini=gemini and not child)
        total_s += s.duration_ms / 1000
        print(f"\n=== {name}  [{item.id}, {s.duration_ms / 1000:.1f}s]  status={s.status}"
              f"{' reason=' + s.reason if s.reason else ''}")
        for pname, p in s.paths.items():
            tag = "cached" if p.get("cached") else f"{p.get('latency_ms', 0)}ms"
            print(f"  {pname:10s} {'ok ' if p['ok'] else 'ERR'} {tag:>8s}  {p.get('transcript') or p.get('error')}")
        row = {"clip": name, "item": item.id, "score": s.to_dict()}
        if s.status == "scored":
            gold = gold_labels(item, clip["said"]) if clip else None
            print(f"  words: " + " ".join(
                f"{w['ref']}{'?' if w['uncertain'] else ''}{'' if read_correctly(w['label']) else '✗'}"
                for w in s.words))
            if gold:
                for pname in s.words[0]["labels"]:
                    hits = [read_correctly(w["labels"][pname]) == read_correctly(g) for w, g in zip(s.words, gold)]
                    agree.setdefault(pname, [0, 0])
                    agree[pname][0] += sum(hits)
                    agree[pname][1] += len(hits)
                fused_hits = [read_correctly(w["label"]) == read_correctly(g) for w, g in zip(s.words, gold)]
                agree.setdefault("FUSED", [0, 0])
                agree["FUSED"][0] += sum(fused_hits)
                agree["FUSED"][1] += len(fused_hits)
                misses = [f"{w['ref']}(gold {g}, got {w['label']})" for w, g, h in zip(s.words, gold, fused_hits)
                          if not h]
                if misses:
                    print("  fused misses: " + ", ".join(misses))
                row["gold"] = gold
            c = s.counts
            exp = clip["expect"] if clip else {}
            verdict = "" if "passed" not in exp else ("  ✓ as expected" if exp["passed"] == s.passed
                                                      else f"  ✗ expected passed={exp['passed']}")
            print(f"  correct {c['correct']}/{c['total']}  errors {c['errors']}  self-corr {c['self_corrections']}"
                  f"  uncertain {c['uncertain']}  pauses>3s {s.hesitations} ({s.hesitation_source})"
                  f"  wcpm {s.wcpm}  passed={s.passed} needs_review={s.needs_review}{verdict}")
        report.append(row)

    print(f"\n{len(files)} clips, {total_s:.0f}s of audio")
    if agree:
        print("Per-word agreement with gold (read correctly or not):")
        for pname, (hit, n) in agree.items():
            print(f"  {pname:10s} {hit}/{n} = {100 * hit / n:.1f}%")
    out = EVAL / "results"
    out.mkdir(exist_ok=True)
    name = dir_name if gemini else f"{dir_name}-no-gemini"
    (out / f"{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Saved eval/results/{name}.json")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir", nargs="?", default="clips", help="folder under eval/ (clips or clips_tts)")
    ap.add_argument("--tts", action="store_true", help="generate synthetic clips into eval/clips_tts and stop")
    ap.add_argument("--only", nargs="*", help="clip names to run")
    ap.add_argument("--gemini-model", help="override GEMINI_MODEL for this run")
    ap.add_argument("--no-gemini", action="store_true", help="as in live check-ins: Sarvam + Azure only")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.gemini_model:
        settings.gemini_model = args.gemini_model
    if args.tts:
        asyncio.run(make_tts(EVAL / "clips_tts", set(args.only) if args.only else None))
    else:
        asyncio.run(run(args.dir, set(args.only) if args.only else None, gemini=not args.no_gemini))


if __name__ == "__main__":
    main()
