"""Step 2 of the Vosk test: what the small on-device models hear (run with this folder's own Python).

    eval/vosk/.venv/bin/python eval/vosk/transcribe.py

For every clip of manifest.json, four conditions:
  clean, child          the two voices of step 1;
  noisy, child_noisy    the same with a classroom behind them: three other children's readings at once (other clips
                        of the same language, from random points) and a hiss, 10 dB below the speech.
Each model listens in two modes:
  free       its whole vocabulary: says what it heard;
  grammar    only the card's words (plus "[unk]" for anything else), as an app would use it to pre-tick a card.
Writes transcripts.json (text, words missing from a model's vocabulary, processing time). The noisy clips are kept
in audio/ to listen to.
"""

from __future__ import annotations

import json
import random
import time
import wave
from pathlib import Path

import numpy as np
from vosk import KaldiRecognizer, Model, SetLogLevel

HERE = Path(__file__).resolve().parent
RATE = 16000
SNR_DB = 10.0
MODELS = {
    "en": ["vosk-model-small-en-in-0.4", "vosk-model-small-en-us-0.15"],
    "hi": ["vosk-model-small-hi-0.22"],
}
rng = np.random.default_rng(20261115)


def read(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)


def write(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(np.clip(x, -32768, 32767).astype(np.int16).tobytes())


def speech_rms(x: np.ndarray) -> float:
    """RMS of the parts with speech (frames within 30 dB of the loudest), not of the silences between words."""
    frames = x[: len(x) // 480 * 480].reshape(-1, 480)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-9)
    return float(np.sqrt((rms[rms > rms.max() / 31.6] ** 2).mean()))


def pink(n: int) -> np.ndarray:
    spec = np.fft.rfft(rng.standard_normal(n))
    spec /= np.sqrt(np.maximum(np.arange(len(spec)), 1))
    return np.fft.irfft(spec, n)


def classroom(x: np.ndarray, others: list[np.ndarray]) -> np.ndarray:
    babble = np.zeros_like(x)
    for o in random.Random(len(x)).sample(others, min(3, len(others))):
        start = int(rng.integers(0, len(o)))
        babble += np.resize(np.roll(o, -start), len(x))
    noise = babble / (speech_rms(babble) + 1e-9) + 0.5 * pink(len(x)) / (speech_rms(pink(len(x))) + 1e-9)
    return x + noise * (speech_rms(x) / (speech_rms(noise) + 1e-9)) / (10 ** (SNR_DB / 20))


def find_word(model: Model, word: str) -> int:
    """The word's id in the model's vocabulary, -1 if it has none (the method's name differs between releases)."""
    fn = getattr(model, "find_word", None) or model.vosk_model_find_word
    return fn(word)


def listen(model: Model, x: np.ndarray, grammar: list[str] | None) -> str:
    rec = KaldiRecognizer(model, RATE, json.dumps(grammar, ensure_ascii=False)) if grammar else KaldiRecognizer(model, RATE)
    pcm = np.clip(x, -32768, 32767).astype(np.int16).tobytes()
    texts = []
    for i in range(0, len(pcm), 8000):
        if rec.AcceptWaveform(pcm[i: i + 8000]):
            texts.append(json.loads(rec.Result()).get("text", ""))
    texts.append(json.loads(rec.FinalResult()).get("text", ""))
    return " ".join(t for t in texts if t).strip()


def main() -> None:
    SetLogLevel(-1)
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    audio: dict[str, dict[str, np.ndarray]] = {"clean": {}, "child": {}}
    for voice in audio:
        for name in manifest:
            audio[voice][name] = read(HERE / "audio" / voice / f"{name}.wav")
    for voice in ("clean", "child"):
        noisy = {}
        for name, m in manifest.items():
            others = [a for n, a in audio[voice].items() if n != name and manifest[n]["lang"] == m["lang"]]
            noisy[name] = classroom(audio[voice][name], others)
            write(HERE / "audio" / f"{voice}_noisy" / f"{name}.wav", noisy[name])
        audio[f"{voice}_noisy"] = noisy

    out = []
    for lang, names in MODELS.items():
        for model_name in names:
            model = Model(str(HERE / "models" / model_name))
            for name, m in manifest.items():
                if m["lang"] != lang:
                    continue
                # A multi-word entry ("double u") is known when each of its words is: Vosk splits it so.
                def in_vocab(entry: str) -> bool:
                    return all(find_word(model, w) != -1 for w in entry.lower().split())

                known = [w for w in m["grammar"] if in_vocab(w)]
                oov = [w for w in m["grammar"] if not in_vocab(w)]
                for variant, clips in audio.items():
                    x = clips[name]
                    for mode in ("free", "grammar"):
                        grammar = [w.lower() for w in known] + ["[unk]"] if mode == "grammar" else None
                        t0 = time.perf_counter()
                        text = listen(model, x, grammar)
                        out.append({"clip": name, "variant": variant, "model": model_name, "mode": mode, "text": text,
                                    "oov": oov if mode == "grammar" else [], "seconds": time.perf_counter() - t0,
                                    "audio_s": len(x) / RATE})
            print(f"  {model_name}: done")
    (HERE / "transcripts.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} transcripts")


if __name__ == "__main__":
    main()
