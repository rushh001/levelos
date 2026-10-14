"""Speech path C (optional): Gemini audio understanding, prompted for verbatim transcription.

Used as a third reference-free opinion for per-word majority voting, and for Tier-2 languages where Azure
has no locale. The expected text is never shown to the model. Not used for diagnosis — that is Claude's job.

REST: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
"""

from __future__ import annotations

import base64
import time

import httpx

from .align import tokenize
from .types import PathResult

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = (
    "You are a verbatim transcriber for a child's oral reading assessment. The audio is a child reading aloud in {language}. "
    "Write down exactly the words you hear, in order, in the {language} script, separated by spaces. "
    "Do not correct mispronunciations, do not fix grammar, do not add or remove words, do not guess the intended word. "
    "If a word is read incorrectly or only partly, write what was actually said as closely as the script allows. "
    "If the child repeats or self-corrects, write every attempt. "
    "Output only the transcript, nothing else. If there is no speech, output an empty line."
)


async def transcribe(
    wav: bytes,
    *,
    api_key: str,
    language_name: str,
    lang: str,
    model: str = "gemini-2.5-flash",
    timeout_s: float = 45.0,
) -> PathResult:
    t0 = time.perf_counter()
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": PROMPT.format(language=language_name)},
                    {"inline_data": {"mime_type": "audio/wav", "data": base64.b64encode(wav).decode("ascii")}},
                ],
            }
        ],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 512},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(ENDPOINT.format(model=model), params={"key": api_key}, json=payload)
        latency = int((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            return PathResult("gemini", "", [], latency_ms=latency, error=f"HTTP {r.status_code}: {r.text[:300]}")
        body = r.json()
    except httpx.HTTPError as e:
        return PathResult("gemini", "", [], latency_ms=int((time.perf_counter() - t0) * 1000), error=str(e))

    try:
        parts = body["candidates"][0]["content"]["parts"]
        transcript = " ".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError, TypeError):
        return PathResult("gemini", "", [], latency_ms=latency, error="no candidates in response", raw=body)

    return PathResult(
        path="gemini",
        transcript=transcript,
        words=tokenize(transcript, lang),
        latency_ms=latency,
        raw={"finish_reason": body.get("candidates", [{}])[0].get("finishReason")},
    )
