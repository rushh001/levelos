"""Azure neural text-to-speech: pre-generated instruction audio, and synthetic clips for pipeline smoke tests.

Synthetic clips only test the plumbing (vendors, segmentation, alignment, pauses). They say nothing about
accuracy on children's speech; that needs real recordings.
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from . import http

OUTPUT_FORMAT = "riff-16khz-16bit-mono-pcm"


def ssml(parts: list[str | float], *, locale: str, voice: str, rate: str = "-15%") -> str:
    """`parts`: text pieces and pause lengths in seconds, in order."""
    body = "".join(f'<break time="{int(p * 1000)}ms"/>' if isinstance(p, (int, float)) else escape(p) for p in parts)
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{locale}">'
        f'<voice name="{voice}"><prosody rate="{rate}">{body}</prosody></voice></speak>'
    )


MP3_FORMAT = "audio-24khz-48kbitrate-mono-mp3"  # small files for the app's precached instruction audio


async def synthesize(parts: list[str | float], *, key: str, region: str, locale: str, voice: str,
                     rate: str = "-15%", timeout_s: float = 30.0, output_format: str = OUTPUT_FORMAT) -> bytes:
    r = await http.post(
        "azure",
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        timeout_s=timeout_s,
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": output_format,
            "User-Agent": "levelos",
        },
        content=ssml(parts, locale=locale, voice=voice, rate=rate).encode("utf-8"),
    )
    if r.status_code != 200:
        raise RuntimeError(f"Azure TTS HTTP {r.status_code}: {r.text[:300]}")
    return r.content
