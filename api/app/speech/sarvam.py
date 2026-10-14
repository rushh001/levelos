"""Speech path A: Sarvam AI `saaras` — reference-free transcription for Indian languages.

Docs: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
  POST https://api.sarvam.ai/speech-to-text  (multipart/form-data, header `api-subscription-key`)
  model: saaras:v4 (default, 22 Indic languages + English) or saaras:v3 (supports `mode`, incl. `verbatim`)
  with_timestamps: chunk-level only on REST (not word-level)

We deliberately do NOT pass the expected text as `keyterms`: biasing recognition toward the reference would hide
exactly the reading errors we are trying to detect.
"""

from __future__ import annotations

import time

import httpx

from .align import tokenize
from .types import PathResult, WordTiming

ENDPOINT = "https://api.sarvam.ai/speech-to-text"


async def transcribe(
    wav: bytes,
    *,
    api_key: str,
    language_code: str,
    lang: str,
    model: str = "saaras:v3",
    mode: str | None = "verbatim",
    timeout_s: float = 30.0,
) -> PathResult:
    """`lang` is our 2-letter language id (for tokenisation); `language_code` is Sarvam's BCP-47 code."""
    t0 = time.perf_counter()
    data: dict[str, str] = {"model": model, "language_code": language_code, "with_timestamps": "true"}
    if mode and model.startswith("saaras:v3"):
        data["mode"] = mode
    files = {"file": ("clip.wav", wav, "audio/wav")}
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(ENDPOINT, headers={"api-subscription-key": api_key}, data=data, files=files)
        latency = int((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            return PathResult("sarvam", "", [], latency_ms=latency, error=f"HTTP {r.status_code}: {r.text[:300]}")
        body = r.json()
    except httpx.HTTPError as e:
        return PathResult("sarvam", "", [], latency_ms=int((time.perf_counter() - t0) * 1000), error=str(e))

    transcript = (body.get("transcript") or "").strip()
    timings = None
    ts = body.get("timestamps")
    if ts and ts.get("words"):
        # Chunk-level segments; still useful for coarse pause detection.
        timings = [
            WordTiming(word=w, start_ms=int(s * 1000), end_ms=int(e * 1000))
            for w, s, e in zip(ts["words"], ts["start_time_seconds"], ts["end_time_seconds"])
        ]
    return PathResult(
        path="sarvam",
        transcript=transcript,
        words=tokenize(transcript, lang),
        timings=timings,
        latency_ms=latency,
        raw=body,
    )
