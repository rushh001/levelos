"""The phone runs the ASER ladder offline (web/src/lib/aser.ts). Its numbers must match the server's rules, or a
synced offline check-in would be replayed to a different result."""

import re
from pathlib import Path

from app.levels.aser_rules import DEFAULT_THRESHOLDS, ITEM_LEVELS, MAX_ITEMS_PER_CHECKIN

TS = (Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "aser.ts").read_text(encoding="utf-8")


def number(name: str) -> float:
    m = re.search(rf"{name}:\s*([0-9.]+)", TS)
    assert m, f"{name} not found in aser.ts"
    return float(m.group(1))


def test_thresholds_match():
    t = DEFAULT_THRESHOLDS
    assert number("discretePassFraction") == t.discrete_pass_fraction
    assert number("passageMaxErrors") == t.passage_max_errors
    assert number("passageMaxHesitations") == t.passage_max_hesitations
    floors = dict(re.findall(r"(paragraph|story):\s*([0-9.]+)", TS.split("passageMinWcpm")[1].split("}")[0]))
    assert {k: float(v) for k, v in floors.items()} == t.passage_min_wcpm


def test_ladder_constants_match():
    assert int(re.search(r"MAX_ITEMS_PER_CHECKIN = (\d+)", TS).group(1)) == MAX_ITEMS_PER_CHECKIN
    ts_levels = re.search(r"ITEM_LEVELS: ItemLevel\[\] = \[([^\]]+)\]", TS).group(1)
    assert re.findall(r"'(\w+)'", ts_levels) == ITEM_LEVELS
