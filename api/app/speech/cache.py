"""Disk cache of speech-path results, keyed by audio hash + path + parameters.

Free tiers are small (Sarvam credit, Azure F0 minutes), so in dev and eval a given clip is sent to a vendor once.
Only deterministic outcomes are cached: successes, and "the vendor heard nothing" (Azure NoMatch etc.).
Network failures and HTTP errors are not. Disabled in production, where every clip is new.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from collections.abc import Awaitable, Callable

from ..config import settings
from .types import PathResult, WordTiming


def enabled() -> bool:
    return settings.speech_cache and settings.app_env != "prod"


def cache_key(path: str, wav: bytes, params: dict) -> str:
    h = hashlib.sha256(wav)
    h.update(json.dumps({"path": path, **params}, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return h.hexdigest()[:40]


def _file(path: str, key: str):
    return settings.speech_cache_dir / path / f"{key}.json"


def load(path: str, key: str) -> PathResult | None:
    f = _file(path, key)
    if not f.exists():
        return None
    d = json.loads(f.read_text(encoding="utf-8"))
    timings = [WordTiming(**t) for t in d.pop("timings")] if d.get("timings") is not None else None
    return PathResult(**{**d, "timings": timings})


def save(result: PathResult, key: str) -> None:
    f = _file(result.path, key)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(dataclasses.asdict(result), ensure_ascii=False, indent=1), encoding="utf-8")


def _cacheable(result: PathResult) -> bool:
    return result.ok or (result.error or "").startswith("RecognitionStatus=")


async def cached(path: str, wav: bytes, params: dict, call: Callable[[], Awaitable[PathResult]]) -> PathResult:
    if not enabled():
        return await call()
    key = cache_key(path, wav, params)
    hit = load(path, key)
    if hit is not None:
        hit.raw = {**hit.raw, "cache": "hit"}
        return hit
    result = await call()
    if _cacheable(result):
        save(result, key)
    return result
