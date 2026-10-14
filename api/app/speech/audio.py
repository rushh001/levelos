"""Audio normalisation: whatever the phone recorded (webm/opus, ogg, m4a, wav) -> 16 kHz mono 16-bit PCM WAV.

Every vendor we call accepts that format, and it is what Azure's short-audio endpoint requires.
Uses the ffmpeg binary (present in the Docker image; install locally with `winget install Gyan.FFmpeg`).
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

TARGET_RATE = 16000


class AudioError(RuntimeError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def to_wav16k(data: bytes, suffix: str = ".webm") -> bytes:
    """Transcode arbitrary input to 16 kHz mono PCM WAV. `suffix` helps ffmpeg pick the demuxer."""
    if not data:
        raise AudioError("empty audio")
    if not ffmpeg_available():
        raise AudioError("ffmpeg not found on PATH")

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{suffix if suffix.startswith('.') else '.' + suffix}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src),
            "-vn", "-ac", "1", "-ar", str(TARGET_RATE), "-sample_fmt", "s16",
            "-f", "wav", str(dst),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not dst.exists():
            raise AudioError(f"ffmpeg failed: {proc.stderr.strip()[:500]}")
        return dst.read_bytes()


def wav_duration_ms(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate() or TARGET_RATE
    return int(frames * 1000 / rate)


def wav_rms_dbfs(wav: bytes) -> float:
    """Rough loudness check so we can refuse silent/near-silent clips before spending API calls."""
    import array
    import math

    with wave.open(io.BytesIO(wav), "rb") as w:
        if w.getsampwidth() != 2:
            return 0.0
        samples = array.array("h", w.readframes(w.getnframes()))
    if not samples:
        return -120.0
    mean_sq = sum(s * s for s in samples) / len(samples)
    if mean_sq <= 0:
        return -120.0
    return 20 * math.log10(math.sqrt(mean_sq) / 32768.0)
