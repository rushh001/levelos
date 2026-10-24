"""Synthetic WAV clips for tests: tone segments stand in for speech, zero amplitude for silence."""

import io
import math
import wave


def make_wav(segments: list[tuple[float, float]], rate: int = 16000, channels: int = 1) -> bytes:
    """segments: (seconds, amplitude 0..1) of a 220 Hz tone; amplitude 0 = silence."""
    frames = []
    t = 0
    for seconds, amp in segments:
        for _ in range(int(seconds * rate)):
            v = int(amp * 20000 * math.sin(2 * math.pi * 220 * t / rate))
            frames.append(v.to_bytes(2, "little", signed=True) * channels)
            t += 1
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(frames))
    return buf.getvalue()
