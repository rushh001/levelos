"""Speech path B: Azure Speech short-audio REST.

Two modes share one endpoint:
  stt  — reference-free transcription (format=detailed gives the Lexical form). Independent second decode
         for every language Azure supports.
  pa   — scripted Pronunciation Assessment (hi-IN, en-IN, ta-IN, ...): the expected text goes in the
         base64 `Pronunciation-Assessment` header; per-word AccuracyScore (0-100), ErrorType
         (None | Omission | Insertion | Mispronunciation), Offset/Duration in 100-ns ticks.
         EnableMiscue requires audio <= 30 s. This path has seen the reference, so it is NOT counted as an
         independent decode; it is a third opinion on per-word accuracy.

Docs: https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short
Endpoint: https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
"""

from __future__ import annotations

import base64
import json
import time

import httpx

from . import http
from .align import tokenize
from .types import PathResult, WordTiming

TICKS_PER_MS = 10_000
MISCUE_MAX_MS = 30_000


def _endpoint(region: str) -> str:
    return f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"


def _pa_header(reference_text: str, *, enable_miscue: bool) -> str:
    params = {
        "ReferenceText": reference_text,
        "GradingSystem": "HundredMark",
        "Granularity": "Word",
        "Dimension": "Comprehensive",
        "EnableMiscue": "True" if enable_miscue else "False",
    }
    return base64.b64encode(json.dumps(params).encode("utf-8")).decode("ascii")


async def _post(
    wav: bytes, *, key: str, region: str, locale: str, extra_headers: dict[str, str], timeout_s: float
) -> tuple[dict | None, str | None, int]:
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Accept": "application/json",
        **extra_headers,
    }
    t0 = time.perf_counter()
    try:
        r = await http.post(
            "azure",
            _endpoint(region),
            timeout_s=timeout_s,
            params={"language": locale, "format": "detailed", "profanity": "raw"},
            headers=headers,
            content=wav,
        )
    except httpx.HTTPError as e:
        return None, f"{type(e).__name__}: {e}", int((time.perf_counter() - t0) * 1000)
    latency = int((time.perf_counter() - t0) * 1000)
    if r.status_code != 200:
        return None, f"HTTP {r.status_code}: {r.text[:300]}", latency
    body = r.json()
    status = body.get("RecognitionStatus")
    if status != "Success":
        # NoMatch / InitialSilenceTimeout / BabbleTimeout are meaningful: the child said nothing usable.
        return body, f"RecognitionStatus={status}", latency
    return body, None, latency


async def transcribe(
    wav: bytes, *, key: str, region: str, locale: str, lang: str, timeout_s: float = 30.0
) -> PathResult:
    body, err, latency = await _post(wav, key=key, region=region, locale=locale, extra_headers={}, timeout_s=timeout_s)
    if err:
        return PathResult("azure_stt", "", [], latency_ms=latency, error=err, raw=body or {})
    best = (body.get("NBest") or [{}])[0]
    transcript = (best.get("Lexical") or best.get("Display") or "").strip()
    return PathResult(
        path="azure_stt",
        transcript=transcript,
        words=tokenize(transcript, lang),
        latency_ms=latency,
        raw={"confidence": best.get("Confidence"), "display": best.get("Display")},
    )


async def assess(
    wav: bytes,
    *,
    key: str,
    region: str,
    locale: str,
    lang: str,
    reference_text: str,
    duration_ms: int | None = None,
    timeout_s: float = 30.0,
) -> PathResult:
    """Scripted pronunciation assessment against `reference_text`. Miscue tagging only for clips <= 30 s."""
    enable_miscue = duration_ms is None or duration_ms <= MISCUE_MAX_MS
    body, err, latency = await _post(
        wav,
        key=key,
        region=region,
        locale=locale,
        extra_headers={"Pronunciation-Assessment": _pa_header(reference_text, enable_miscue=enable_miscue)},
        timeout_s=timeout_s,
    )
    if err:
        return PathResult("azure_pa", "", [], reference_aware=True, latency_ms=latency, error=err, raw=body or {})
    best = (body.get("NBest") or [{}])[0]
    timings: list[WordTiming] = []
    heard: list[str] = []
    for w in best.get("Words") or []:
        word = w.get("Word", "")
        etype = w.get("ErrorType") or "None"
        start = int(w.get("Offset", 0)) // TICKS_PER_MS
        dur = int(w.get("Duration", 0)) // TICKS_PER_MS
        timings.append(
            WordTiming(
                word=word,
                start_ms=start,
                end_ms=start + dur,
                accuracy=w.get("AccuracyScore"),
                error_type=None if etype == "None" else etype,
            )
        )
        if etype != "Omission":  # omitted reference words were never spoken
            heard.append(word)
    transcript = " ".join(heard)
    return PathResult(
        path="azure_pa",
        transcript=transcript,
        words=tokenize(transcript, lang),
        timings=timings,
        reference_aware=True,
        latency_ms=latency,
        raw={
            "accuracy": best.get("AccuracyScore"),
            "fluency": best.get("FluencyScore"),
            "completeness": best.get("CompletenessScore"),
            "pron": best.get("PronScore"),
            "miscue_enabled": enable_miscue,
        },
    )
