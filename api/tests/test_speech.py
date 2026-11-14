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
