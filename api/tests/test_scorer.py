"""Scorer orchestration with fake speech paths: no network, no credits."""

import asyncio

from app.content import get_item
from app.speech.align import tokenize
from app.speech.scorer import ItemScore, PathPlan, merge, score_item
from app.speech.types import PathResult, WordTiming
from tests.wavgen import make_wav

PARA = get_item("en-para-a")  # 20 words: "I have a red ball. I play with it every day. ..."
REF = tokenize(PARA.text, "en")
SPEECH = make_wav([(0.3, 0.0), (6.0, 0.5), (0.3, 0.0)])


def path(name, text, *, reference_aware=False, error=None, timings=None):
    async def run(_wav):
        return PathResult(name, text, tokenize(text, "en"), timings=timings, reference_aware=reference_aware,
                          error=error)

    return PathPlan(name, run, reference_aware=reference_aware)


def with_word(i, word):
    words = list(REF)
    words[i] = word
    return " ".join(words)


def score(plans, data=SPEECH, item=PARA):
    return asyncio.run(score_item(data, item, suffix=".wav", plans=plans))


def boom_plan():
    async def run(_wav):
        raise AssertionError("vendor must not be called")

    return PathPlan("sarvam", run)


# ---- quality gate: no vendor call on bad audio


def test_too_short_and_silent_clips_ask_for_rerecord():
    s = score([boom_plan()], data=make_wav([(0.3, 0.5)]))
    assert (s.status, s.reason) == ("rerecord", "too_short")
    s = score([boom_plan()], data=make_wav([(2.0, 0.0)]))
    assert (s.status, s.reason) == ("rerecord", "silent")


# ---- fusion and pass/fail


def test_agreeing_paths_score_cleanly():
    s = score([path("sarvam", PARA.text), path("azure_stt", PARA.text)])
    assert s.status == "scored"
    assert s.counts["correct"] == 20 and s.counts["uncertain"] == 0
    assert s.passed and not s.needs_review
    assert s.wcpm and s.wcpm > 100  # 20 words in ~6 s


def test_uncertain_words_that_could_flip_the_result_need_review():
    # 3 certain errors (both paths agree), 1 word the paths disagree on: 3 errors pass, 4 fail.
    both = list(REF)
    both[1], both[4], both[8] = "hav", "bell", "at"
    a = " ".join(both)
    b = list(both)
    b[10] = "dey"  # 'day' heard wrong by sarvam only; the tie goes to English's primary path (azure_stt)
    s = score([path("sarvam", " ".join(b)), path("azure_stt", a)])
    assert s.counts["errors"] == 3 and s.counts["uncertain_open"] == 1
    assert s.passed_best and not s.passed_worst and s.needs_review

    # Teacher taps the uncertain word as wrong -> settled, fails.
    for w in s.words:
        if w["uncertain"]:
            w["teacher_correct"] = False
    s.evaluate()
    assert not s.needs_review and not s.passed and s.counts["errors"] == 4


def test_uncertain_words_that_cannot_flip_the_result_do_not_need_review():
    s = score([path("sarvam", PARA.text), path("azure_stt", with_word(4, "bell"))])
    assert s.counts["uncertain"] == 1 and s.passed and not s.needs_review


def test_pa_breaks_a_tie_between_two_paths():
    pa_timings = [WordTiming(w, i * 300, i * 300 + 250) for i, w in enumerate(REF)]
    pa_timings[4] = WordTiming("ball", 1200, 1450, accuracy=20.0, error_type="Mispronunciation")
    s = score([path("sarvam", PARA.text), path("azure_stt", with_word(4, "bell")),
               path("azure_pa", PARA.text, reference_aware=True, timings=pa_timings)])
    ball = s.words[4]
    assert ball["uncertain"] and ball["label"] == "sub"  # PA sided with azure_stt
    assert ball["pa"] == {"accuracy": 20.0, "error_type": "Mispronunciation"}


def test_pa_is_second_opinion_when_one_path_is_up():
    pa_timings = [WordTiming(w, i * 300, i * 300 + 250) for i, w in enumerate(REF)]
    pa_timings[4] = WordTiming("ball", 1200, 1450, accuracy=10.0, error_type="Mispronunciation")
    s = score([path("sarvam", PARA.text), path("azure_stt", "", error="HTTP 500"),
               path("azure_pa", PARA.text, reference_aware=True, timings=pa_timings)])
    assert s.words[4]["uncertain"] and s.words[4]["label"] == "correct"
    assert sum(w["uncertain"] for w in s.words) == 1


def test_reference_aware_path_alone_never_scores():
    s = score([path("sarvam", "", error="HTTP 503"),
               path("azure_pa", PARA.text, reference_aware=True, timings=[])])
    assert (s.status, s.reason) == ("failed", "speech_unavailable")


def test_a_crashing_client_does_not_sink_the_other_paths():
    s = score([boom_plan(), path("azure_stt", PARA.text)])
    assert s.status == "scored" and s.primary == "azure_stt"
    assert not s.paths["sarvam"]["ok"]


def pa_with_gaps(before: tuple[int, ...], gap_ms: int) -> list[WordTiming]:
    t = [WordTiming(w, i * 400, i * 400 + 300) for i, w in enumerate(REF)]
    for k in before:
        t[k:] = [WordTiming(x.word, x.start_ms + gap_ms, x.end_ms + gap_ms) for x in t[k:]]
    return t


# en-para-a sentences by word index: 0-4 | 5-10 | 11-15 | 16-19


def test_mid_sentence_pauses_make_reading_halting():
    t = pa_with_gaps((2, 8, 13), 2900)  # inside sentences 1, 2 and 3; just under the old 3 s rule
    s = score([path("sarvam", PARA.text), path("azure_pa", PARA.text, reference_aware=True, timings=t)])
    assert (s.hesitations, s.hesitation_source) == (3, "azure_pa")
    assert not s.passed  # halting: not reading as sentences


def test_pauses_between_sentences_are_not_halting():
    t = pa_with_gaps((5, 11, 16), 4000)  # long pauses, but each one at a sentence boundary
    s = score([path("sarvam", PARA.text), path("azure_pa", PARA.text, reference_aware=True, timings=t)])
    assert s.hesitations == 0 and s.passed  # slow but reading as sentences


def test_pauses_from_audio_when_no_timings():
    halting = make_wav([(2.0, 0.5), (3.6, 0.0), (2.0, 0.5), (3.6, 0.0), (2.0, 0.5), (3.6, 0.0), (2.0, 0.5)])
    s = score([path("sarvam", PARA.text)], data=halting)
    assert (s.hesitations, s.hesitation_source) == (3, "audio")
    assert not s.passed


# ---- long clips are segmented for REST vendors


def test_long_clip_is_split_for_segmented_paths_only():
    calls = {"seg": 0, "whole": 0}
    halves = (" ".join(REF[:10]), " ".join(REF[10:]))

    async def segmented(_wav):
        calls["seg"] += 1
        return PathResult("sarvam", halves[calls["seg"] - 1], tokenize(halves[calls["seg"] - 1], "en"))

    async def whole(_wav):
        calls["whole"] += 1
        return PathResult("gemini", PARA.text, list(REF))

    long_clip = make_wav([(20.0, 0.5), (1.5, 0.0), (20.0, 0.5)], rate=8000)
    s = score([PathPlan("sarvam", segmented), PathPlan("gemini", whole, segmented=False)], data=long_clip)
    assert calls == {"seg": 2, "whole": 1}
    assert s.counts["correct"] == 20 and s.counts["uncertain"] == 0


def test_merge_treats_nothing_heard_as_empty_and_errors_as_failure():
    ok = PathResult("azure_stt", "I have", ["i", "have"], timings=None)
    silent = PathResult("azure_stt", "", [], error="RecognitionStatus=InitialSilenceTimeout")
    m = merge("azure_stt", [(ok, 0), (silent, 28000)])
    assert m.ok and m.words == ["i", "have"]
    bad = PathResult("azure_stt", "", [], error="HTTP 401")
    assert not merge("azure_stt", [(ok, 0), (bad, 28000)]).ok


def test_reading_a_passage_against_a_letter_card_asks_for_rerecord():
    letters = get_item("hi-letter-a")
    passage = "मेरा नाम रीना है मेरे पास एक गाय है गाय का रंग सफेद है"
    plans = [PathPlan("sarvam", lambda _w: _done(PathResult("sarvam", passage, tokenize(passage, "hi"))))]
    s = score(plans, item=letters)
    assert (s.status, s.reason) == ("rerecord", "wrong_item")


async def _done(result):
    return result


def test_round_trip_through_dict():
    s = score([path("sarvam", PARA.text)])
    again = ItemScore.from_dict(s.to_dict()).evaluate()
    assert again.counts == s.counts and again.passed == s.passed
