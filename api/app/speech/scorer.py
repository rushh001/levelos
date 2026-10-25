"""One item's audio -> scored result. Orchestrates the speech paths and the deterministic scorer; no LLM here.

  audio -> 16 kHz WAV -> quality gate (too short / silent / too long: re-record, no vendor is called)
        -> speech paths in parallel; Sarvam and Azure STT get <=28 s segments (REST limits; a slow child
           reading a paragraph takes a minute)
        -> fuse the reference-free decodes. Azure Pronunciation Assessment saw the expected text, so it never
           votes on its own: it breaks a tie between two paths, or is the second opinion when only one is up
        -> counts, long pauses, WCPM -> ASER pass/fail, also under the best and worst case for the words still
           marked uncertain. If those differ, the item needs the teacher's taps before its result can count.
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field, fields

from ..config import settings
from ..content import Item, languages, wcpm_floor
from ..levels.aser_rules import DEFAULT_THRESHOLDS, ItemOutcome, Thresholds, item_passed
from . import audio, azure, cache, gemini, sarvam
from .align import _vote, extras, fuse, normalize, read_correctly, tokenize
from .types import PathResult, WordTiming

MIN_DURATION_MS = 600
MAX_DURATION_MS = 180_000
SILENCE_DBFS = -50.0
# Azure PA scores against adult native speakers; Microsoft advises looser thresholds for children.
PA_MIN_ACCURACY = 40.0
INDEPENDENT_ORDER = ("sarvam", "azure_stt", "gemini")
_NOTHING_HEARD = ("RecognitionStatus=NoMatch", "RecognitionStatus=InitialSilenceTimeout",
                  "RecognitionStatus=BabbleTimeout")

Runner = Callable[[bytes], Awaitable[PathResult]]


@dataclass
class PathPlan:
    name: str
    run: Runner
    reference_aware: bool = False
    segmented: bool = True  # False: the vendor takes the whole clip in one call


@dataclass
class ItemScore:
    item_id: str
    level: str
    lang: str
    status: str  # scored | rerecord | failed
    reason: str | None = None  # too_short | silent | too_long | bad_audio | speech_unavailable
    duration_ms: int = 0
    reading_ms: int | None = None
    # One entry per reference word: ref, label, uncertain, heard{path}, labels{path}, pa, start_ms, end_ms,
    # teacher_correct (None until the teacher taps).
    words: list[dict] = field(default_factory=list)
    extras: list[dict] = field(default_factory=list)  # inserted / repeated words (primary path)
    counts: dict = field(default_factory=dict)
    hesitations: int | None = None
    hesitation_source: str | None = None  # azure_pa | audio
    wcpm: float | None = None
    passed: bool | None = None
    passed_best: bool | None = None  # every open uncertain word read correctly
    passed_worst: bool | None = None  # every open uncertain word read wrongly
    needs_review: bool = False
    primary: str | None = None
    paths: dict[str, dict] = field(default_factory=dict)
    # Tap-marked offline: set once the synced recording has been AI-scored (or why it could not be).
    ai_scored: bool = False
    audio_note: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> ItemScore:
        # Deep copy: edits must not reach the stored JSON in place, or the ORM sees no change to save.
        # Unknown keys are ignored so rows stored by an older or newer version still load.
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in copy.deepcopy(d).items() if k in names})

    def outcome(self) -> ItemOutcome:
        """The likely outcome (taps applied, open uncertain words as fused), for the ASER ladder and level."""
        return self._outcome(sum(word_correct(w) for w in self.words))

    def _outcome(self, correct: int) -> ItemOutcome:
        total = len(self.words)
        wcpm = None
        if self.level in ("paragraph", "story") and self.reading_ms:
            wcpm = round(correct * 60_000 / self.reading_ms, 1)
        return ItemOutcome(self.level, total, correct, total - correct, self.hesitations, wcpm,
                           wcpm_floor=wcpm_floor(self.lang, self.level))

    def evaluate(self, thresholds: Thresholds = DEFAULT_THRESHOLDS) -> ItemScore:
        """(Re)compute counts and pass/fail from the words, honouring any teacher taps. Call after each tap."""
        correct = sum(word_correct(w) for w in self.words)
        open_uncertain = [w for w in self.words if w["uncertain"] and w.get("teacher_correct") is None]
        flip_up = sum(1 for w in open_uncertain if not word_correct(w))
        flip_down = sum(1 for w in open_uncertain if word_correct(w))
        likely = self._outcome(correct)
        self.wcpm = likely.wcpm
        self.passed = item_passed(likely, thresholds)
        self.passed_best = item_passed(self._outcome(correct + flip_up), thresholds)
        self.passed_worst = item_passed(self._outcome(correct - flip_down), thresholds)
        self.needs_review = self.passed_best != self.passed_worst
        self.counts = {
            "total": len(self.words),
            "correct": correct,
            "errors": len(self.words) - correct,
            "self_corrections": sum(1 for w in self.words if w["label"] == "self_correct"),
            "uncertain": sum(1 for w in self.words if w["uncertain"]),
            "uncertain_open": len(open_uncertain),
        }
        return self


def word_correct(w: dict) -> bool:
    if w.get("teacher_correct") is not None:
        return bool(w["teacher_correct"])
    return read_correctly(w["label"])


# ---------------------------------------------------------------- speech path plans


def _usable(code: str | None) -> bool:
    return bool(code) and code != "VERIFY"


def default_plans(item: Item, *, duration_ms: int, allow_gemini: bool) -> list[PathPlan]:
    """The speech paths configured for this language, each wrapped in the dev response cache."""
    cfg = languages()[item.lang]
    v = cfg["vendors"]
    lang = item.lang
    plans: list[PathPlan] = []

    if settings.sarvam_api_key and _usable(v.get("sarvam")):
        mode = cfg.get("sarvam_mode", "verbatim")
        p_sarvam = {"model": settings.sarvam_model, "language_code": v["sarvam"], "mode": mode}

        def run_sarvam(wav: bytes) -> Awaitable[PathResult]:
            return cache.cached("sarvam", wav, p_sarvam, lambda: sarvam.transcribe(
                wav, api_key=settings.sarvam_api_key, language_code=v["sarvam"], lang=lang,
                model=settings.sarvam_model, mode=mode))

        plans.append(PathPlan("sarvam", run_sarvam))

    if settings.azure_speech_key and _usable(v.get("azure_stt")):
        p_stt = {"locale": v["azure_stt"]}

        def run_azure_stt(wav: bytes) -> Awaitable[PathResult]:
            return cache.cached("azure_stt", wav, p_stt, lambda: azure.transcribe(
                wav, key=settings.azure_speech_key, region=settings.azure_speech_region,
                locale=v["azure_stt"], lang=lang))

        plans.append(PathPlan("azure_stt", run_azure_stt))

    if allow_gemini and settings.gemini_api_key and _usable(v.get("gemini")):
        p_gem = {"model": settings.gemini_model, "language": v["gemini"]}

        def run_gemini(wav: bytes) -> Awaitable[PathResult]:
            return cache.cached("gemini", wav, p_gem, lambda: gemini.transcribe(
                wav, api_key=settings.gemini_api_key, language_name=v["gemini"], lang=lang,
                model=settings.gemini_model))

        plans.append(PathPlan("gemini", run_gemini, segmented=False))

    # Miscue tagging only works on clips <= 30 s; longer clips go without PA.
    if settings.azure_speech_key and _usable(v.get("azure_pa")) and duration_ms <= azure.MISCUE_MAX_MS:
        p_pa = {"locale": v["azure_pa"], "reference": item.text}

        def run_pa(wav: bytes) -> Awaitable[PathResult]:
            return cache.cached("azure_pa", wav, p_pa, lambda: azure.assess(
                wav, key=settings.azure_speech_key, region=settings.azure_speech_region, locale=v["azure_pa"],
                lang=lang, reference_text=item.text, duration_ms=duration_ms))

        plans.append(PathPlan("azure_pa", run_pa, reference_aware=True, segmented=False))

    return plans


async def _run_plan(plan: PathPlan, wav: bytes, segments: list[tuple[bytes, int]]) -> PathResult:
    parts = [(wav, 0)] if not plan.segmented else segments
    try:
        results = await asyncio.gather(*(plan.run(seg) for seg, _ in parts))
    except Exception as e:  # a client bug must not sink the other paths
        return PathResult(plan.name, "", [], reference_aware=plan.reference_aware, error=f"{type(e).__name__}: {e}")
    return merge(plan.name, list(zip(results, (off for _, off in parts))), reference_aware=plan.reference_aware)


def merge(name: str, parts: list[tuple[PathResult, int]], *, reference_aware: bool = False) -> PathResult:
    """Join per-segment results. 'Heard nothing' in a segment is an empty transcript, not a failure; any real
    failure fails the path (a partial transcript would turn the missing segment into false omissions)."""
    latency = sum(r.latency_ms for r, _ in parts)
    failed = [r for r, _ in parts if not r.ok and not (r.error or "").startswith(_NOTHING_HEARD)]
    if failed:
        return PathResult(name, "", [], reference_aware=reference_aware, latency_ms=latency, error=failed[0].error)
    ok = [(r, off) for r, off in parts if r.ok]
    if len(parts) == 1 and ok:
        return ok[0][0]
    words = [w for r, _ in ok for w in r.words]
    timings: list[WordTiming] | None = []
    for r, off in ok:
        if r.timings is None:
            if r.words:
                timings = None
                break
            continue
        timings.extend(WordTiming(t.word, t.start_ms + off, t.end_ms + off, t.accuracy, t.error_type)
                       for t in r.timings)
    return PathResult(
        path=name,
        transcript=" ".join(r.transcript for r, _ in ok if r.transcript),
        words=words,
        timings=timings,
        reference_aware=reference_aware,
        latency_ms=latency,
        raw={"segments": [r.raw for r, _ in parts]},
    )


# ---------------------------------------------------------------- Azure PA as a tie-breaker / second opinion


def _pa_per_ref(ref: list[str], pa: PathResult, lang: str) -> list[WordTiming | None]:
    """PA lists the reference words in order (plus insertions); pair them with our reference tokens."""
    listed = [t for t in (pa.timings or []) if t.error_type != "Insertion"]
    out: list[WordTiming | None] = []
    j = 0
    for r in ref:
        found = None
        for k in range(j, min(j + 3, len(listed))):
            if normalize(" ".join(tokenize(listed[k].word, lang)), lang) == normalize(r, lang):
                found = k
                break
        if found is None:
            out.append(None)
        else:
            out.append(listed[found])
            j = found + 1
    return out


def _pa_says_correct(t: WordTiming) -> bool:
    return t.error_type is None and (t.accuracy is None or t.accuracy >= PA_MIN_ACCURACY)


def _sentence_of(item: Item) -> list[int] | None:
    """Sentence index of every reference token, or None for letter/word cards."""
    if not item.sentences:
        return None
    out: list[int] = []
    for k, sentence in enumerate(item.sentences):
        out += [k] * len(tokenize(sentence, item.lang))
    return out


def _hesitations_from_timings(spoken: list[tuple[int, WordTiming]], sentence_of: list[int] | None,
                              t: Thresholds) -> int:
    """Long pauses between consecutive spoken words (ref index, timing). For passages only pauses inside a sentence
    count (ASER: reads as sentences); for cards every gap over the EGRA 3 s threshold."""
    spoken = sorted(spoken, key=lambda p: p[1].start_ms)
    count = 0
    for (i, a), (j, b) in zip(spoken, spoken[1:]):
        gap = b.start_ms - a.end_ms
        if sentence_of is None:
            count += gap > t.hesitation_ms
        elif sentence_of[i] == sentence_of[j]:
            count += gap > t.mid_sentence_pause_ms
    return count


# ---------------------------------------------------------------- entry point


async def score_item(
    data: bytes,
    item: Item,
    *,
    suffix: str = ".webm",
    allow_gemini: bool = False,
    plans: list[PathPlan] | None = None,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> ItemScore:
    score = ItemScore(item_id=item.id, level=item.level, lang=item.lang, status="scored")

    try:
        wav = await asyncio.to_thread(audio.to_wav16k, data, suffix)
    except audio.AudioError as e:
        score.status, score.reason = "failed", "bad_audio"
        score.paths = {"ffmpeg": {"ok": False, "error": str(e)}}
        return score
    score.duration_ms = audio.wav_duration_ms(wav)
    span = audio.speech_span_ms(wav)
    if score.duration_ms < MIN_DURATION_MS:
        score.status, score.reason = "rerecord", "too_short"
        return score
    if score.duration_ms > MAX_DURATION_MS:
        score.status, score.reason = "rerecord", "too_long"
        return score
    if span is None or audio.wav_rms_dbfs(wav) < SILENCE_DBFS:
        score.status, score.reason = "rerecord", "silent"
        return score

    if plans is None:
        plans = default_plans(item, duration_ms=score.duration_ms, allow_gemini=allow_gemini)
    segments = audio.split_wav(wav) if any(p.segmented for p in plans) else [(wav, 0)]
    results = dict(zip((p.name for p in plans), await asyncio.gather(*(_run_plan(p, wav, segments) for p in plans))))
    score.paths = {
        n: {"ok": r.ok, "error": r.error, "transcript": r.transcript, "latency_ms": r.latency_ms,
            "reference_aware": r.reference_aware, "cached": r.raw.get("cache") == "hit"}
        for n, r in results.items()
    }

    independent = {n: results[n] for n in INDEPENDENT_ORDER if n in results and results[n].ok}
    if not independent:
        score.status, score.reason = "failed", "speech_unavailable"
        return score

    lang, ref = item.lang, tokenize(item.text, item.lang)
    cfg_primary = languages().get(lang, {}).get("primary")
    primary = cfg_primary if cfg_primary in independent else next(iter(independent))
    score.primary = primary
    # A letter/word card is five short units. Far more speech than that means the wrong card or a passage was
    # read (letter matching looks only at each word's first akshara, so it could otherwise score by accident).
    if item.level in ("letter", "word") and min(len(r.words) for r in independent.values()) > 2 * len(ref) + 3:
        score.status, score.reason = "rerecord", "wrong_item"
        return score
    fused = fuse(ref, {n: r.words for n, r in independent.items()}, lang, primary=primary,
                 letter_item=item.letter_item)
    if item.letter_item:
        # Recognisers often drop a single spoken letter altogether, so "nobody heard anything" is no proof the
        # child skipped it: the teacher confirms (with the recording). In languages where single letters are
        # unreliable for them (`confirm_letters`), every letter they did not both hear as right goes to the teacher.
        confirm_all = languages().get(lang, {}).get("confirm_letters", False)
        for fw in fused:
            if all(h is None for h in fw.heard.values()) or (confirm_all and not read_correctly(fw.label)):
                fw.uncertain = True

    pa = results.get("azure_pa")
    pa_words = _pa_per_ref(ref, pa, lang) if pa is not None and pa.ok and pa.timings else [None] * len(ref)
    for fw, t in zip(fused, pa_words):
        if t is None:
            continue
        pa_ok = _pa_says_correct(t)
        verdicts = [read_correctly(lab) for lab in fw.labels.values()]
        if len(independent) == 1:
            if pa_ok != read_correctly(fw.label):
                fw.uncertain = True
        elif fw.uncertain and verdicts.count(True) == verdicts.count(False):
            fw.label = _vote({n: lab for n, lab in fw.labels.items() if read_correctly(lab) == pa_ok}, primary)

    score.words = [
        {
            "i": i,
            "ref": fw.ref,
            "label": fw.label,
            "uncertain": fw.uncertain,
            "heard": fw.heard,
            "labels": fw.labels,
            "pa": {"accuracy": t.accuracy, "error_type": t.error_type} if t else None,
            "start_ms": t.start_ms if t and t.error_type != "Omission" else None,
            "end_ms": t.end_ms if t and t.error_type != "Omission" else None,
            "teacher_correct": None,
        }
        for i, (fw, t) in enumerate(zip(fused, pa_words))
    ]
    score.extras = [{"hyp": op.hyp, "label": op.label}
                    for op in extras(ref, independent[primary].words, lang, letter_item=item.letter_item)]

    spoken = [(i, t) for i, t in enumerate(pa_words)
              if t is not None and t.error_type != "Omission" and t.end_ms > t.start_ms]
    if len(spoken) >= 2:
        score.hesitations = _hesitations_from_timings(spoken, _sentence_of(item), thresholds)
        score.hesitation_source = "azure_pa"
        score.reading_ms = max(t.end_ms for _, t in spoken) - min(t.start_ms for _, t in spoken)
    else:
        score.hesitations = audio.long_pauses(wav, min_ms=thresholds.hesitation_ms)
        score.hesitation_source = "audio"
        score.reading_ms = span[1] - span[0]
    return score.evaluate(thresholds)
