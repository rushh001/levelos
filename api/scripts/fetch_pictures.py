"""Fetch the OpenMoji drawings the app shows next to simple words, and record each word's picture code.

    cd api
    .venv/Scripts/python -m scripts.fetch_pictures curated.json      # {"hi": {"गाय": "🐄", ...}, "en": {...}}

For every (language, word, emoji) in the curated file, the emoji's code points (minus variation selectors) name
the OpenMoji SVG, e.g. 🐄 -> 1F404.svg. The file is downloaded once into web/public/pictures/ (CC BY-SA 4.0,
https://openmoji.org) and content/pictures.json gets "words": {lang: {word: code}}. Words whose drawing cannot
be fetched are reported and left without a picture.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "pictures"
CONFIG = ROOT / "content" / "pictures.json"
BASE = "https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg"


def code_of(emoji: str) -> str:
    """OpenMoji names files by the code points, keeping joiners (200D) and dropping variation selectors (FE0F)."""
    return "-".join(f"{ord(ch):X}" for ch in emoji if ord(ch) != 0xFE0F)


def main(curated_path: str) -> None:
    curated: dict[str, dict[str, str]] = json.loads(Path(curated_path).read_text(encoding="utf-8"))
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    words: dict[str, dict[str, str]] = config.get("words", {})
    OUT.mkdir(parents=True, exist_ok=True)
    missing: list[str] = []
    fetched = 0
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        for lang, table in curated.items():
            words.setdefault(lang, {})
            for word, emoji in table.items():
                code = code_of(emoji)
                path = OUT / f"{code}.svg"
                if not path.exists():
                    ok = False
                    for candidate in (code, code + "-FE0F", code.replace("-FE0F", "")):
                        r = client.get(f"{BASE}/{candidate}.svg")
                        if r.status_code == 200 and r.content.startswith(b"<"):
                            path.write_bytes(r.content)
                            fetched += 1
                            ok = True
                            break
                    if not ok:
                        missing.append(f"{lang}:{word} {emoji} ({code})")
                        continue
                words[lang][word] = code
    config["words"] = {lang: dict(sorted(t.items())) for lang, t in sorted(words.items())}
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    total = sum(p.stat().st_size for p in OUT.glob("*.svg"))
    print(f"fetched {fetched} new drawings; {sum(len(t) for t in words.values())} words have pictures; "
          f"{len(list(OUT.glob('*.svg')))} files, {total // 1024} KB")
    if missing:
        print("no drawing for:", ", ".join(missing))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
