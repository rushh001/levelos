"""Audio normalisation: whatever the phone recorded (webm/opus, ogg, m4a, wav) -> 16 kHz mono 16-bit PCM WAV.

Every vendor we call accepts that format, and it is what Azure's short-audio endpoint requires.
Uses the ffmpeg binary on PATH (present in the Docker image), else the one bundled with `imageio-ffmpeg`.
"""

from __future__ import annotations

import array
import io
import math
import shutil
import subprocess
import tempfile
import wave
from functools import lru_cache
from pathlib import Path

TARGET_RATE = 16000


class AudioError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def ffmpeg_exe() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def ffmpeg_available() -> bool:
    return ffmpeg_exe() is not None


def to_wav16k(data: bytes, suffix: str = ".webm") -> bytes:
    """Transcode arbitrary input to 16 kHz mono PCM WAV. `suffix` helps ffmpeg pick the demuxer.

    Blocking (runs a subprocess): call it via `run_in_threadpool` from async code.
    """
    if not data:
        raise AudioError("empty audio")
    exe = ffmpeg_exe()
    if exe is None:
        raise AudioError("ffmpeg not found (install it or `pip install imageio-ffmpeg`)")

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{suffix if suffix.startswith('.') else '.' + suffix}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        cmd = [
            exe, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src),
            "-vn", "-ac", "1", "-ar", str(TARGET_RATE), "-sample_fmt", "s16",
            "-f", "wav", str(dst),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not dst.exists():
            raise AudioError(f"ffmpeg failed: {proc.stderr.strip()[:500]}")
        return dst.read_bytes()


def to_mp3(data: bytes, suffix: str = ".webm") -> bytes:
    """Playback copy for the teacher: mono 32 kbps MP3 (~4 KB per second of speech). MP3 because recordings from
    the phone's MediaRecorder (WebM) often cannot be seeked, and Safari does not play every WebM.

    Blocking (runs a subprocess): call it via `asyncio.to_thread` from async code.
    """
    if not data:
        raise AudioError("empty audio")
    exe = ffmpeg_exe()
    if exe is None:
        raise AudioError("ffmpeg not found (install it or `pip install imageio-ffmpeg`)")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{suffix if suffix.startswith('.') else '.' + suffix}"
        dst = Path(tmp) / "out.mp3"
        src.write_bytes(data)
        cmd = [exe, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
               "-vn", "-ac", "1", "-ar", "22050", "-codec:a", "libmp3lame", "-b:a", "32k", str(dst)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not dst.exists():
            raise AudioError(f"ffmpeg failed: {proc.stderr.strip()[:500]}")
        return dst.read_bytes()


def _samples(wav: bytes) -> tuple[array.array, int]:
    with wave.open(io.BytesIO(wav), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise AudioError("expected 16-bit mono PCM")
        return array.array("h", w.readframes(w.getnframes())), w.getframerate() or TARGET_RATE


def wav_duration_ms(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate() or TARGET_RATE
    return int(frames * 1000 / rate)


def _dbfs(chunk: array.array | list[int]) -> float:
    if not chunk:
        return -120.0
    mean_sq = sum(s * s for s in chunk) / len(chunk)
    if mean_sq <= 0:
        return -120.0
    return 20 * math.log10(math.sqrt(mean_sq) / 32768.0)


def wav_rms_dbfs(wav: bytes) -> float:
    """Rough loudness check so we can refuse silent/near-silent clips before spending API calls."""
    try:
        samples, _ = _samples(wav)
    except AudioError:
        return 0.0
    return _dbfs(samples)


FRAME_MS = 30


def _frame_levels(samples: array.array, rate: int, frame_ms: int = FRAME_MS) -> list[float]:
    step = max(1, rate * frame_ms // 1000)
    return [_dbfs(samples[i:i + step]) for i in range(0, len(samples), step)]


def _voiced(levels: list[float], below_peak_db: float, floor_dbfs: float) -> list[bool]:
    if not levels:
        return []
    threshold = max(max(levels) - below_peak_db, floor_dbfs)
    return [lv >= threshold for lv in levels]


def speech_span_ms(wav: bytes, *, below_peak_db: float = 30.0, floor_dbfs: float = -50.0) -> tuple[int, int] | None:
    """(start, end) of the speech in the clip, by frame energy: frames within `below_peak_db` of the loudest frame
    (and above `floor_dbfs`) count as speech. Used to measure reading time without the silence the teacher leaves
    before tapping stop. None if nothing rises above the floor."""
    samples, rate = _samples(wav)
    voiced = _voiced(_frame_levels(samples, rate), below_peak_db, floor_dbfs)
    idx = [i for i, v in enumerate(voiced) if v]
    if not idx:
        return None
    return idx[0] * FRAME_MS, min((idx[-1] + 1) * FRAME_MS, wav_duration_ms(wav))


def long_pauses(wav: bytes, *, min_ms: int = 3000, below_peak_db: float = 30.0, floor_dbfs: float = -50.0) -> int:
    """Silent stretches longer than `min_ms` inside the speech span (leading/trailing silence excluded).
    Vendor-independent, so the 'halting' check works in every language, not only where a vendor gives timings."""
    samples, rate = _samples(wav)
    voiced = _voiced(_frame_levels(samples, rate), below_peak_db, floor_dbfs)
    idx = [i for i, v in enumerate(voiced) if v]
    if not idx:
        return 0
    count, run = 0, 0
    for v in voiced[idx[0]:idx[-1] + 1]:
        if v:
            if run * FRAME_MS > min_ms:
                count += 1
            run = 0
        else:
            run += 1
    return count


def _write_wav(samples: array.array, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def split_wav(wav: bytes, *, max_ms: int = 28_000, min_ms: int = 14_000, smooth_frames: int = 7
              ) -> list[tuple[bytes, int]]:
    """Cut a clip into segments of at most `max_ms` for vendors with a 30 s request limit (a slow child reading a
    paragraph easily takes a minute). Each cut goes at the quietest point (energy smoothed over ~200 ms, so a
    stop-consonant closure inside a word is not mistaken for a pause) between `min_ms` and `max_ms` into the
    segment. Returns (segment_wav, offset_ms) pairs."""
    if wav_duration_ms(wav) <= max_ms:
        return [(wav, 0)]
    samples, rate = _samples(wav)
    levels = _frame_levels(samples, rate)
    half = smooth_frames // 2
    smooth = [sum(levels[max(0, i - half):i + half + 1]) / len(levels[max(0, i - half):i + half + 1])
              for i in range(len(levels))]
    step = max(1, rate * FRAME_MS // 1000)
    bounds, start = [], 0
    while (len(levels) - start) * FRAME_MS > max_ms:
        lo, hi = start + min_ms // FRAME_MS, start + max_ms // FRAME_MS
        cut = min(range(lo, hi), key=lambda i: smooth[i])
        bounds.append((start, cut))
        start = cut
    bounds.append((start, len(levels)))
    return [(_write_wav(samples[a * step:b * step], rate), a * FRAME_MS) for a, b in bounds]
