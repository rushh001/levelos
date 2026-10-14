"""Common result shape for every speech path, so the scorer never cares which vendor produced it."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class WordTiming:
    word: str
    start_ms: int
    end_ms: int
    # Reference-aware vendors (Azure Pronunciation Assessment) also give a 0-100 accuracy and an error type.
    accuracy: float | None = None
    error_type: str | None = None  # None | Omission | Insertion | Mispronunciation


@dataclass
class PathResult:
    path: str  # sarvam | azure_stt | azure_pa | gemini
    transcript: str
    words: list[str]  # tokenised transcript (what the aligner consumes)
    timings: list[WordTiming] | None = None  # word-level timing when the vendor provides it
    reference_aware: bool = False  # True if the vendor saw the expected text (so it is not an independent decode)
    latency_ms: int = 0
    error: str | None = None  # set when the call failed; words is then empty
    raw: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.error is None
