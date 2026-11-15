"""Step 3 of the Vosk test: how well each model's words agree with what was said (run with the API's Python).

    cd api && .venv/bin/python ../eval/vosk/score.py            # Vosk only
    cd api && .venv/bin/python ../eval/vosk/score.py --online   # also the app's online AI on the same clips

Every transcript is aligned to the card with the app's own aligner (as the online speech paths are), and each
word's verdict, read correctly or not, is compared with the gold one:
  agree         words where the verdict matches what was said (the number eval/README.md gives for Sarvam/Azure);
  caught        of the words read WRONGLY, how many it marks wrong: what a reading check is for;
  false alarm   of the words read RIGHT, how many it marks wrong: what makes a teacher stop trusting it;
  card right    cards whose pass/fail it gets right (letters and words: 4 of 5; a passage: at most 3 errors);
  speed         processing time / audio length on this Mac (a phone in a browser is several times slower).
--online runs the app's live configuration (Sarvam + Azure, no Gemini) on the clean and the child_noisy clips:
a little vendor credit, cached in api/.cache/speech. Writes results.json and results.md.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "api"))

from app.content import get_item  # noqa: E402
from app.speech.align import fuse, read_correctly, tokenize  # noqa: E402

VARIANTS = ["clean", "child", "noisy", "child_noisy"]


def verdicts(m: dict, words: list[str]) -> list[bool]:
    fused = fuse(m["ref"], {"x": words}, m["lang"], letter_item=m["letter_item"])
    return [read_correctly(w.label) for w in fused]


def card_passed(level: str, ok: list[bool]) -> bool:
    if level in ("letter", "word"):
        return sum(ok) >= 4
    return len(ok) - sum(ok) <= 3


class Tally:
    def __init__(self) -> None:
        self.n = self.agree = self.wrong = self.caught = self.right = self.false_alarm = 0
        self.cards = self.cards_right = 0
        self.rtf: list[float] = []

    def add(self, m: dict, got: list[bool], rtf: float | None = None) -> None:
        for g, v in zip(m["gold_correct"], got):
            self.n += 1
            self.agree += g == v
            if g:
                self.right += 1
                self.false_alarm += not v
            else:
                self.wrong += 1
                self.caught += not v
        self.cards += 1
        self.cards_right += card_passed(m["level"], got) == card_passed(m["level"], m["gold_correct"])
        if rtf is not None:
            self.rtf.append(rtf)

    def row(self) -> dict:
        pct = lambda a, b: round(100 * a / b, 1) if b else None  # noqa: E731
        return {"agree": f"{self.agree}/{self.n}", "agree_pct": pct(self.agree, self.n),
                "caught": f"{self.caught}/{self.wrong}", "caught_pct": pct(self.caught, self.wrong),
                "false_alarm": f"{self.false_alarm}/{self.right}", "false_alarm_pct": pct(self.false_alarm, self.right),
                "card_right": f"{self.cards_right}/{self.cards}",
                "speed": round(statistics.median(self.rtf), 3) if self.rtf else None}


async def online(manifest: dict) -> dict:
    from app.speech.scorer import score_item

    rows: dict[tuple, Tally] = defaultdict(Tally)
    for variant in ("clean", "child_noisy"):
        for name, m in manifest.items():
            wav = (HERE / "audio" / variant / f"{name}.wav").read_bytes()
            s = await score_item(wav, get_item(m["item"]), suffix=".wav", allow_gemini=False)
            if s.status != "scored":
                print(f"  online {variant} {name}: {s.status} {s.reason}")
                got = [False] * len(m["ref"])  # nothing usable: as if every word went to the teacher
            else:
                got = [read_correctly(w["label"]) for w in s.words]
            for key in [(m["lang"], "online AI (Sarvam + Azure)", "live", variant),
                        (m["lang"], "online AI (Sarvam + Azure)", "live", variant, m["level"])]:
                rows[key].add(m, got)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--online", action="store_true")
    args = ap.parse_args()
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    transcripts = json.loads((HERE / "transcripts.json").read_text(encoding="utf-8"))

    rows: dict[tuple, Tally] = defaultdict(Tally)
    oov: dict[str, set[str]] = defaultdict(set)
    examples = []
    for t in transcripts:
        m = manifest[t["clip"]]
        got = verdicts(m, tokenize(t["text"], m["lang"]))
        rtf = t["seconds"] / t["audio_s"]
        model = t["model"].replace("vosk-model-", "")
        rows[(m["lang"], model, t["mode"], t["variant"])].add(m, got, rtf)
        rows[(m["lang"], model, t["mode"], t["variant"], m["level"])].add(m, got, rtf)
        oov[model].update(t["oov"])
        if t["variant"] == "clean" and m["set"] == "scripted":
            examples.append({"clip": t["clip"], "model": model, "mode": t["mode"], "said": m["said"], "heard": t["text"]})
    if args.online:
        rows.update(asyncio.run(online(manifest)))

    result = {" | ".join(k): v.row() for k, v in rows.items()}
    (HERE / "results.json").write_text(json.dumps({"rows": result, "oov": {k: sorted(v) for k, v in oov.items()},
                                                   "examples": examples}, ensure_ascii=False, indent=1),
                                       encoding="utf-8")

    lines = ["# Vosk small models: results", ""]
    for lang in ("en", "hi"):
        lines += [f"## {'English' if lang == 'en' else 'Hindi'}", "",
                  "| Model | Mode | Voice | Agree | Errors caught | False alarms | Card pass/fail right | Speed |",
                  "|---|---|---|---|---|---|---|---|"]
        for k, v in rows.items():
            if k[0] != lang or len(k) != 4:
                continue
            r = v.row()
            lines.append(f"| {k[1]} | {k[2]} | {k[3]} | {r['agree']} ({r['agree_pct']}%) | {r['caught']} ({r['caught_pct']}%) "
                         f"| {r['false_alarm']} ({r['false_alarm_pct']}%) | {r['card_right']} | {r['speed'] or '—'} |")
        lines += ["", "By card type (clean voice):", "",
                  "| Model | Mode | Card | Agree | Errors caught | False alarms |", "|---|---|---|---|---|---|"]
        for k, v in rows.items():
            if k[0] != lang or len(k) != 5 or k[3] != "clean":
                continue
            r = v.row()
            lines.append(f"| {k[1]} | {k[2]} | {k[4]} | {r['agree_pct']}% | {r['caught']} ({r['caught_pct']}%) "
                         f"| {r['false_alarm']} ({r['false_alarm_pct']}%) |")
        lines.append("")
    lines += ["## Words a model does not know (left out of its restricted vocabulary)", ""]
    lines += [f"- {k}: {', '.join(sorted(v)) or 'none'}" for k, v in oov.items()]
    lines += ["", "## What it heard (scripted clips, clean voice)", "", "| Clip | Model | Mode | Said | Heard |",
              "|---|---|---|---|---|"]
    lines += [f"| {e['clip']} | {e['model']} | {e['mode']} | {e['said']} | {e['heard']} |" for e in examples]
    (HERE / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[: lines.index("## Words a model does not know (left out of its restricted vocabulary)")]))


if __name__ == "__main__":
    main()
