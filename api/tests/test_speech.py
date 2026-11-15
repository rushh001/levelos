"""An activity read aloud: one clip per part joined into one MP3, with the time each part starts; clips kept by text."""

import base64

from app.api import speech
from app.config import settings
from app.models import SpeechClip
from tests.test_api import client, login  # noqa: F401  (fixtures)

PARTS = ["Letter cards from a rhyme.", "Step 1. Say the rhyme twice.", "Step 2. Show each card."]


def fake_voice(monkeypatch, calls):
    async def synth(parts, *, key, region, locale, voice, rate, output_format, timeout_s=30.0):
        calls.append((parts[1], locale, voice))
        return b"\xff" * int(speech.MP3_BYTES_PER_S * (len(calls) + 1))  # clip n lasts n + 1 seconds

    monkeypatch.setattr(speech.tts, "synthesize", synth)
    monkeypatch.setattr(settings, "azure_speech_key", "test-key")


def test_parts_become_one_clip_with_the_start_of_each(client, monkeypatch, db):
    calls = []
    fake_voice(monkeypatch, calls)
    h = login(client)
    r = client.post("/api/speech", json={"language": "hi", "parts": PARTS}, headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["starts"] == [0, 2.0, 5.0] and out["duration"] == 9.0  # 2 s + 3 s + 4 s
    assert len(base64.b64decode(out["audio"])) == int(9 * speech.MP3_BYTES_PER_S)
    assert [c[1:] for c in calls] == [("hi-IN", "hi-IN-SwaraNeural")] * 3
    # Listening again (or the same step in another activity) costs nothing.
    again = client.post("/api/speech", json={"language": "hi", "parts": PARTS[1:]}, headers=h).json()
    assert len(calls) == 3 and again["starts"] == [0, 3.0]
    assert db.query(SpeechClip).count() == 3


def test_the_same_activity_asked_twice_at_once_is_made_once_and_both_get_it(client, monkeypatch, db):
    # A new activity: the app keeps its recording for offline as it opens, and the teacher presses Listen meanwhile.
    import asyncio

    import httpx

    from app.main import app

    calls = []
    asked = 0  # clips asked for, by both requests
    real_clip = speech._clip

    async def counting(*args):
        nonlocal asked
        asked += 1
        return await real_clip(*args)

    async def slow(parts, **kwargs):
        calls.append(parts[1])
        for _ in range(500):  # the voice answers once both requests have asked for every clip (at most 5 s)
            if asked >= 2 * len(PARTS):
                break
            await asyncio.sleep(0.01)
        return b"\xff" * int(speech.MP3_BYTES_PER_S)

    monkeypatch.setattr(speech, "_clip", counting)
    monkeypatch.setattr(speech.tts, "synthesize", slow)
    monkeypatch.setattr(settings, "azure_speech_key", "test-key")
    h = login(client)

    async def both():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
            body = {"language": "hi", "parts": PARTS}
            return await asyncio.gather(ac.post("/api/speech", json=body, headers=h), ac.post("/api/speech", json=body, headers=h))

    first, second = asyncio.run(both())
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    assert first.json() == second.json()
    assert sorted(calls) == sorted(PARTS)  # each clip made once
    assert db.query(SpeechClip).count() == 3


def test_a_clip_kept_meanwhile_by_another_server_is_no_error(client, monkeypatch, db):
    from app.db import SessionLocal

    async def synth(parts, *, voice, **kwargs):
        # another server process keeps the same clip while this one is being made
        other = SessionLocal()
        other.add(SpeechClip(key=speech._key(voice, parts[1]), audio=b"\xff" * int(speech.MP3_BYTES_PER_S)))
        other.commit()
        other.close()
        return b"\xff" * int(speech.MP3_BYTES_PER_S)

    monkeypatch.setattr(speech.tts, "synthesize", synth)
    monkeypatch.setattr(settings, "azure_speech_key", "test-key")
    r = client.post("/api/speech", json={"language": "hi", "parts": PARTS[:1]}, headers=login(client))
    assert r.status_code == 200, r.text
    assert db.query(SpeechClip).count() == 1


def test_speech_needs_a_teacher_a_voice_and_short_parts(client, monkeypatch):
    h = login(client)
    body = {"language": "hi", "parts": PARTS}
    assert client.post("/api/speech", json=body).status_code == 401
    assert client.post("/api/speech", json=body, headers=h).status_code == 503  # no Azure key: the phone's voice
    fake_voice(monkeypatch, [])
    assert client.post("/api/speech", json={"language": "xx", "parts": PARTS}, headers=h).status_code == 422
    assert client.post("/api/speech", json={"language": "hi", "parts": ["x" * 501]}, headers=h).status_code == 422
    assert client.post("/api/speech", json={"language": "hi", "parts": ["x"] * 13}, headers=h).status_code == 422


def test_a_voice_failure_is_reported_so_the_app_uses_the_phones_voice(client, monkeypatch):
    async def down(*args, **kwargs):
        raise RuntimeError("Azure TTS HTTP 429")

    monkeypatch.setattr(speech.tts, "synthesize", down)
    monkeypatch.setattr(settings, "azure_speech_key", "test-key")
    r = client.post("/api/speech", json={"language": "en", "parts": PARTS}, headers=login(client))
    assert r.status_code == 502
