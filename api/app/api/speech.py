"""Reads an activity aloud for the teacher in the language of their screen (Azure neural voices). The app sends the
parts (title, each step, homework, tip); each becomes one clip, and the clips are joined into one MP3 with the time
each part starts, so the teacher can move the slider or jump straight to a step. A clip is kept by its text for
AUDIO_RETENTION_DAYS, so listening again (or another group getting the same step) costs nothing. Offline, the app
uses the phone's own voice instead."""

import asyncio
import base64
import hashlib
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..auth import current_teacher
from ..config import settings
from ..content import languages
from ..db import get_db
from ..llm.activities import ui_languages
from ..models import SpeechClip, Teacher, utcnow
from ..speech import tts

router = APIRouter(prefix="/api", tags=["speech"])

MAX_PARTS, MAX_PART_CHARS, MAX_TOTAL_CHARS = 12, 500, 3000
MP3_BYTES_PER_S = 48_000 / 8  # tts.MP3_FORMAT is constant bit rate: a clip's length gives its duration
RATE = "-5%"  # a touch slower than normal speech, for a teacher taking it in
_azure = asyncio.Semaphore(3)  # the free Azure tier allows 20 requests a minute


class SpeechIn(BaseModel):
    language: str
    parts: list[str] = Field(min_length=1, max_length=MAX_PARTS)


def _key(voice: str, text: str) -> str:
    return hashlib.sha256(f"{voice}|{RATE}|{text}".encode()).hexdigest()


async def _synthesize(text: str, voice: str, locale: str) -> bytes:
    async with _azure:
        return await tts.synthesize([0.1, text, 0.5], key=settings.azure_speech_key, region=settings.azure_speech_region,
                                    locale=locale, voice=voice, rate=RATE, output_format=tts.MP3_FORMAT)


@router.post("/speech")
async def speech(body: SpeechIn, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    cfg = languages().get(body.language)
    if cfg is None or body.language not in ui_languages() or not cfg.get("vendors", {}).get("azure_tts"):
        raise HTTPException(422, f"no voice for {body.language!r}")
    parts = [p.strip() for p in body.parts]
    if any(not p or len(p) > MAX_PART_CHARS for p in parts) or sum(map(len, parts)) > MAX_TOTAL_CHARS:
        raise HTTPException(422, f"up to {MAX_PARTS} parts of at most {MAX_PART_CHARS} characters")
    if not settings.azure_speech_key:
        raise HTTPException(503, "no voice on this server")
    voice, locale = cfg["vendors"]["azure_tts"], cfg["vendors"]["azure_stt"]

    keys = [_key(voice, p) for p in parts]
    kept = {c.key: c.audio for c in db.query(SpeechClip).filter(SpeechClip.key.in_(set(keys)))}
    missing = list(dict.fromkeys(k for k in keys if k not in kept))
    try:
        made = await asyncio.gather(*(_synthesize(parts[keys.index(k)], voice, locale) for k in missing))
    except Exception as e:  # noqa: BLE001  (vendor or network: the app falls back to the phone's voice)
        raise HTTPException(502, f"voice unavailable: {type(e).__name__}") from e
    for k, audio in zip(missing, made):
        kept[k] = audio
        db.add(SpeechClip(key=k, audio=audio))
    db.commit()

    clips = [kept[k] for k in keys]
    starts, t = [], 0.0
    for c in clips:
        starts.append(round(t, 2))
        t += len(c) / MP3_BYTES_PER_S
    return {"mime": "audio/mpeg", "audio": base64.b64encode(b"".join(clips)).decode("ascii"),
            "starts": starts, "duration": round(t, 2)}


def purge_speech(db: Session) -> int:
    """Clips older than the audio retention period (they are made again when needed)."""
    cutoff = utcnow() - timedelta(days=max(settings.audio_retention_days, 1))
    return db.execute(delete(SpeechClip).where(SpeechClip.created_at < cutoff)).rowcount or 0
