import io
import wave

import pytest

from app.speech.audio import (
    ffmpeg_available,
    long_pauses,
    speech_span_ms,
    split_wav,
    to_wav16k,
    wav_duration_ms,
    wav_rms_dbfs,
)
from tests.wavgen import make_wav


def test_duration_and_loudness():
    wav = make_wav([(1.0, 0.5)])
    assert wav_duration_ms(wav) == 1000
    assert -15 < wav_rms_dbfs(wav) < -5
    assert wav_rms_dbfs(make_wav([(1.0, 0.0)])) == -120.0


def test_speech_span_skips_leading_and_trailing_silence():
    wav = make_wav([(0.6, 0.0), (1.2, 0.5), (0.9, 0.0)])
    start, end = speech_span_ms(wav)
    assert 540 <= start <= 630
    assert 1770 <= end <= 1860


def test_speech_span_none_for_silence():
    assert speech_span_ms(make_wav([(1.0, 0.0)])) is None


def test_long_pauses_counts_only_inner_silences_over_3s():
    wav = make_wav([(1.0, 0.0), (1.0, 0.5), (3.5, 0.0), (1.0, 0.5), (2.0, 0.0), (1.0, 0.5), (4.0, 0.0)])
    assert long_pauses(wav) == 1  # the 3.5 s gap; the 2 s gap is short; leading/trailing silence ignored


def test_split_wav_cuts_long_clips_in_the_pauses():
    # 20 s speech, 1.5 s pause, 20 s speech: one cut, inside the pause.
    wav = make_wav([(20.0, 0.5), (1.5, 0.0), (20.0, 0.5)], rate=8000)
    parts = split_wav(wav)
    assert len(parts) == 2
    assert 20_000 <= parts[1][1] <= 21_500
    assert all(wav_duration_ms(p) <= 28_000 for p, _ in parts)
    assert sum(wav_duration_ms(p) for p, _ in parts) == pytest.approx(wav_duration_ms(wav), abs=40)
    assert split_wav(make_wav([(5.0, 0.5)])) == [(make_wav([(5.0, 0.5)]), 0)]


@pytest.mark.skipif(not ffmpeg_available(), reason="no ffmpeg")
def test_to_wav16k_resamples_and_downmixes():
    src = make_wav([(0.5, 0.5)], rate=44100, channels=2)
    out = to_wav16k(src, ".wav")
    with wave.open(io.BytesIO(out), "rb") as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)
    assert 480 <= wav_duration_ms(out) <= 520
