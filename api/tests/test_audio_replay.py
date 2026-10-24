"""Recordings kept for the teacher to listen again: who can play them, how long they stay, deleting them."""

from datetime import timedelta

from app.config import settings
from app.models import ItemAudio, utcnow
from app.services.checkins import purge_audio
from tests.test_api import client, login, make_student, script  # noqa: F401  (fixtures)
from tests.wavgen import make_wav

WAV = make_wav([(0.3, 0.0), (2.0, 0.5), (0.3, 0.0)])


def record_first_item(client, h, student_id):
    c = client.post("/api/checkins", json={"student_id": student_id}, headers=h).json()
    r = client.post(f"/api/checkins/{c['id']}/items", data={"item_id": c["next_item"]["id"]},
                    files={"audio": ("clip.wav", WAV, "audio/wav")}, headers=h).json()
    return r["checkin"], r["item_result"]


def test_recording_is_kept_and_playable_by_its_teacher_only(client, script):
    h = login(client)
    _, st = make_student(client, h)
    c, ir = record_first_item(client, h, st["id"])
    assert ir["has_audio"]
    url = f"/api/checkins/{c['id']}/items/{ir['id']}/audio"
    a = client.get(url, headers=h)
    assert a.status_code == 200 and a.headers["content-type"] == "audio/mpeg"
    assert a.content[:3] == b"ID3" or a.content[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
    assert client.get(url, headers=login(client, "ravi", "9999")).status_code == 404  # another teacher
    assert client.get(url).status_code == 401  # not logged in


def test_nothing_is_kept_when_retention_is_zero(client, script, monkeypatch):
    monkeypatch.setattr(settings, "audio_retention_days", 0)
    h = login(client)
    _, st = make_student(client, h)
    c, ir = record_first_item(client, h, st["id"])
    assert not ir["has_audio"]
    assert client.get(f"/api/checkins/{c['id']}/items/{ir['id']}/audio", headers=h).status_code == 404


def test_recordings_past_retention_are_deleted(client, script, db):
    h = login(client)
    _, st = make_student(client, h)
    c, ir = record_first_item(client, h, st["id"])
    db.query(ItemAudio).update({ItemAudio.created_at: utcnow() - timedelta(days=settings.audio_retention_days + 1)})
    db.commit()
    assert purge_audio(db) == 1
    db.commit()
    assert client.get(f"/api/checkins/{c['id']}/items/{ir['id']}/audio", headers=h).status_code == 404


def test_teacher_can_delete_a_checkins_recordings(client, script):
    h = login(client)
    _, st = make_student(client, h)
    c, ir = record_first_item(client, h, st["id"])
    after = client.delete(f"/api/checkins/{c['id']}/audio", headers=h).json()
    assert not after["items"][0]["has_audio"] and after["items"][0]["result"]["words"]  # scores stay
    assert client.get(f"/api/checkins/{c['id']}/items/{ir['id']}/audio", headers=h).status_code == 404


def test_offline_recording_is_kept_after_sync(client, script):
    h = login(client)
    _, st = make_student(client, h)
    c = client.post("/api/checkins", json={"student_id": st["id"], "local_id": "phone-9"}, headers=h).json()
    r = client.post(f"/api/checkins/{c['id']}/marks", headers=h,
                    json={"item_id": c["next_item"]["id"], "marks": [True] * 5}).json()
    assert not r["item_result"]["has_audio"]
    after = client.post(f"/api/checkins/{c['id']}/items/{r['item_result']['id']}/audio", headers=h,
                        files={"audio": ("clip.wav", WAV, "audio/wav")}).json()
    assert after["items"][0]["has_audio"]
