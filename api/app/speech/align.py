"""Deterministic alignment of what a child said (per speech path) against the expected text.

Works on Unicode grapheme clusters (regex `\\X`), so an akshara in Devanagari/Tamil/Kannada and a letter in
English go through the same code. Nothing here calls a model.

Pipeline:
  tokenize()      expected text and each hypothesis -> word tokens (punctuation stripped, NFC)
  align()         one hypothesis vs the reference: correct / sub / omit / insert, then a post-pass that
                  recognises repetitions and self-corrections (EGRA counts self-corrections as correct)
  fuse()          several hypotheses -> one label per reference word, with `uncertain=True` wherever the
                  paths disagree. Disagreement is the honest signal we surface to the teacher.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import TypeVar

import regex
from rapidfuzz.distance import Levenshtein

T = TypeVar("T")

_GRAPHEME = regex.compile(r"\X")
# Devanagari danda/double danda, Latin punctuation, quotes, dashes. Keep letters, marks and digits.
_STRIP = regex.compile(r"[^\p{L}\p{M}\p{N}'’]+")


def _indic_chars(*name_parts: str) -> list[str]:
    """Characters in the Indic Unicode blocks (U+0900-U+0DFF) whose names contain any of `name_parts`.
    Built from character names so every script (Devanagari, Gujarati, Odia, Tamil, Telugu, Kannada, ...)
    is covered by one rule instead of a hand-written range per script."""
    return [ch for ch in map(chr, range(0x0900, 0x0E00)) if any(p in unicodedata.name(ch, "") for p in name_parts)]


def _chandrabindu_to_anusvara() -> dict[int, str]:
    table: dict[int, str] = {}
    for ch in _indic_chars(" SIGN CANDRABINDU"):
        script = unicodedata.name(ch).removesuffix(" SIGN CANDRABINDU")
        try:
            table[ord(ch)] = unicodedata.lookup(f"{script} SIGN ANUSVARA")
        except KeyError:
            pass
    return table


# Spelling variants that ASR engines produce for the same spoken form; not reading errors.
# Nukta (ज़/ज) is dropped and chandrabindu is folded into anusvara (माँ/मां), in every Indic script.
_SPELLING_VARIANTS: dict[int, str | None] = {ord(n): None for n in _indic_chars("SIGN NUKTA")}
_SPELLING_VARIANTS.update(_chandrabindu_to_anusvara())
# Vowel signs (matras), viramas, length marks and nasal/visarga signs in every Indic script. Stripped only when
# matching single-letter items: engines write a letter said aloud as a syllable or even a word (क -> का,
# म -> माँ, र -> राह, க -> கா), so a letter item compares the first akshara's consonant only.
_INDIC_LETTER_MARKS = regex.compile(
    "["
    + "".join(regex.escape(c) for c in _indic_chars(
        "VOWEL SIGN", "VIRAMA", "LENGTH MARK", "PRISHTHAMATRA", "SIGN ANUSVARA", "SIGN CANDRABINDU", "SIGN VISARGA"))
    + "]"
)

# What a child (or an ASR engine) may produce when reading an English letter aloud: name or sound.
ENGLISH_LETTER_ALIASES: dict[str, set[str]] = {
    "a": {"a", "ay", "eh", "ah", "aa"},
    "b": {"b", "bee", "be", "buh"},
    "c": {"c", "see", "sea", "cee", "kuh"},
    "d": {"d", "dee", "de", "duh"},
    "e": {"e", "ee", "eh"},
    "f": {"f", "ef", "eff", "fuh"},
    "g": {"g", "gee", "jee", "ghee", "guh"},
    "h": {"h", "aitch", "etch", "hhh", "huh"},
    "i": {"i", "eye", "aye", "ih"},
    "j": {"j", "jay", "jai", "juh"},
    "k": {"k", "kay", "ke", "kuh"},
    "l": {"l", "el", "ell", "luh"},
    "m": {"m", "em", "emm", "mm", "muh"},
    "n": {"n", "en", "enn", "nn", "nuh"},
    "o": {"o", "oh", "oo"},
    "p": {"p", "pee", "pe", "puh"},
    "q": {"q", "cue", "queue", "kyu", "kwuh"},
    "r": {"r", "ar", "aar", "ruh", "rr"},
    "s": {"s", "es", "ess", "ss", "suh"},
    "t": {"t", "tee", "tea", "te", "tuh"},
    "u": {"u", "you", "yu", "uh"},
    "v": {"v", "vee", "ve", "vuh"},
    "w": {"w", "double u", "doubleu", "dabloo", "wuh"},
    "x": {"x", "ex", "eks"},
    "y": {"y", "why", "wai", "yuh"},
    "z": {"z", "zed", "zee", "zuh"},
}

Label = str  # correct | sub | omit | insert | repeat | self_correct


@dataclass
class Op:
    ref: str | None
    hyp: str | None
    label: Label
    sim: float = 0.0


@dataclass
class FusedWord:
    ref: str
    label: Label
    uncertain: bool
    heard: dict[str, str | None] = field(default_factory=dict)  # path name -> what it heard (None = omitted)
    labels: dict[str, Label] = field(default_factory=dict)  # path name -> its label
    sim: float = 0.0  # similarity of the primary path's hypothesis to the reference


# ---------------------------------------------------------------- normalisation


def graphemes(s: str) -> list[str]:
    return _GRAPHEME.findall(s)


def normalize(word: str, lang: str) -> str:
    """Collapse spelling variants that do not reflect a reading difference."""
    # NFD first so precomposed nukta letters (ऩ, ड़) expose the nukta, then recompose.
    w = unicodedata.normalize("NFD", word.strip()).translate(_SPELLING_VARIANTS)
    w = unicodedata.normalize("NFC", w)
    if lang == "en" or _is_latin(w):
        w = w.lower().replace("’", "'")
    return w


def _is_latin(s: str) -> bool:
    return bool(s) and all(("a" <= c.lower() <= "z") or not c.isalpha() for c in s)


def tokenize(text: str, lang: str) -> list[str]:
    """Split into word tokens; punctuation is dropped, empty tokens removed. Tokens keep their spelling (NFC only),
    so teachers see सड़क, not सडक; every comparison goes through `normalize`."""
    text = unicodedata.normalize("NFC", text)
    cleaned = _STRIP.sub(" ", text)
    return [tok for tok in cleaned.split() if normalize(tok, lang)]


def letter_form(word: str, lang: str) -> str:
    """Canonical form for single-letter items: the first akshara's bare consonant(s) for Indic scripts, the
    letter name/sound for English."""
    w = normalize(word, lang)
    if lang == "en" or not w:
        return w
    return _INDIC_LETTER_MARKS.sub("", graphemes(w)[0])


# ---------------------------------------------------------------- similarity


def similarity(a: str, b: str, lang: str, *, letter_item: bool = False) -> float:
    """0..1 similarity on grapheme clusters. Exact match after normalisation is 1.0."""
    if letter_item:
        fa, fb = letter_form(a, lang), letter_form(b, lang)
        if fa == fb:
            return 1.0
        if lang == "en":
            aliases = ENGLISH_LETTER_ALIASES.get(fa)
            if aliases and fb in aliases:
                return 1.0
        return Levenshtein.normalized_similarity(graphemes(fa), graphemes(fb))
    na, nb = normalize(a, lang), normalize(b, lang)
    if na == nb:
        return 1.0
    return Levenshtein.normalized_similarity(graphemes(na), graphemes(nb))


# ---------------------------------------------------------------- alignment


def align(
    ref_words: list[str],
    hyp_words: list[str],
    lang: str,
    *,
    letter_item: bool = False,
    correct_threshold: float = 0.999,
    partial_threshold: float = 0.5,
) -> list[Op]:
    """Needleman-Wunsch alignment preferring substitutions between similar words over omit+insert pairs.

    Costs: match 0; near-miss substitution (sim >= partial_threshold) 1 - 0.5*sim; dissimilar substitution 1.5;
    omit 1; insert 1. A dissimilar substitution (1.5) is cheaper than an omit+insert pair (2), so unrelated words
    still line up one-to-one, and a near-miss is cheaper again, so similar words are paired whenever possible.

    Letter cards are positional: a dissimilar substitution costs 1, so a reversal (b d read for d b) is two
    substitutions rather than "d skipped, extra d" (ties go to the diagonal). Reversals are the error we most
    need to see on letters.
    """
    n, m = len(ref_words), len(hyp_words)
    sims = [[similarity(r, h, lang, letter_item=letter_item) for h in hyp_words] for r in ref_words]
    dissimilar_cost = 1.0 if letter_item else 1.5

    INF = float("inf")
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[str | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for i in range(1, n + 1):
        cost[i][0] = float(i)
        back[i][0] = "omit"
    for j in range(1, m + 1):
        cost[0][j] = float(j)
        back[0][j] = "insert"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = sims[i - 1][j - 1]
            if s >= correct_threshold:
                sub_cost = 0.0
            elif s >= partial_threshold:
                sub_cost = 1.0 - 0.5 * s
            else:
                sub_cost = dissimilar_cost
            best, arg = cost[i - 1][j - 1] + sub_cost, "diag"
            if cost[i - 1][j] + 1.0 < best:
                best, arg = cost[i - 1][j] + 1.0, "omit"
            if cost[i][j - 1] + 1.0 < best:
                best, arg = cost[i][j - 1] + 1.0, "insert"
            cost[i][j], back[i][j] = best, arg

    ops: list[Op] = []
    i, j = n, m
    while i > 0 or j > 0:
        step = back[i][j]
        if step == "diag":
            s = sims[i - 1][j - 1]
            label = "correct" if s >= correct_threshold else "sub"
            ops.append(Op(ref_words[i - 1], hyp_words[j - 1], label, s))
            i, j = i - 1, j - 1
        elif step == "omit":
            ops.append(Op(ref_words[i - 1], None, "omit", 0.0))
            i -= 1
        else:
            ops.append(Op(None, hyp_words[j - 1], "insert", 0.0))
            j -= 1
    ops.reverse()
    if not letter_item:
        ops = _join_split_words(ops, lang)
    return _mark_repeats_and_self_corrections(ops, lang, letter_item, partial_threshold)


def _squash(s: str, lang: str) -> str:
    return normalize(s, lang).replace("-", "").replace(" ", "")


def _join_split_words(ops: list[Op], lang: str) -> list[Op]:
    """Engines join or split compounds ("every day" -> "everyday", "बैठकर" -> "बैठ कर"): the same speech, not a
    reading error. Two reference words heard as one token, or one heard as two, are both read correctly."""
    out: list[Op] = []
    k = 0
    while k < len(ops):
        a = ops[k]
        b = ops[k + 1] if k + 1 < len(ops) else None
        if b is not None:
            if a.label in ("sub", "correct") and b.label == "omit" and a.hyp and a.ref and b.ref \
                    and _squash(a.hyp, lang) == _squash(a.ref + b.ref, lang):
                out += [Op(a.ref, a.hyp, "correct", 1.0), Op(b.ref, a.hyp, "correct", 1.0)]
                k += 2
                continue
            if a.label == "omit" and b.label == "sub" and b.hyp and a.ref and b.ref \
                    and _squash(b.hyp, lang) == _squash(a.ref + b.ref, lang):
                out += [Op(a.ref, b.hyp, "correct", 1.0), Op(b.ref, b.hyp, "correct", 1.0)]
                k += 2
                continue
            if a.label == "sub" and b.label == "insert" and a.hyp and b.hyp and a.ref \
                    and _squash(a.hyp + b.hyp, lang) == _squash(a.ref, lang):
                out.append(Op(a.ref, f"{a.hyp} {b.hyp}", "correct", 1.0))
                k += 2
                continue
            if a.label == "insert" and b.label == "sub" and a.hyp and b.hyp and b.ref \
                    and _squash(a.hyp + b.hyp, lang) == _squash(b.ref, lang):
                out.append(Op(b.ref, f"{a.hyp} {b.hyp}", "correct", 1.0))
                k += 2
                continue
        out.append(a)
        k += 1
    return out


def _mark_repeats_and_self_corrections(ops: list[Op], lang: str, letter_item: bool, partial: float) -> list[Op]:
    """Post-pass over the raw alignment.

    - insert of a word identical to the previous correctly-read word, or to the next reference word that was
      then read correctly -> repeat (the child said it twice; not an error)
    - insert of a near-miss (similar but not identical) immediately followed by the correct reading of that
      reference word -> the reference word is self_correct (counts as correct), the insert is dropped
    """
    out: list[Op] = []
    k = 0
    while k < len(ops):
        op = ops[k]
        if op.label == "insert" and op.hyp is not None:
            prev = out[-1] if out else None
            nxt = ops[k + 1] if k + 1 < len(ops) else None
            if prev and prev.label in ("correct", "self_correct") and prev.hyp is not None and (
                similarity(prev.hyp, op.hyp, lang, letter_item=letter_item) >= 0.999
            ):
                out.append(Op(None, op.hyp, "repeat", 1.0))
                k += 1
                continue
            if nxt and nxt.label == "correct" and nxt.ref is not None:
                s = similarity(nxt.ref, op.hyp, lang, letter_item=letter_item)
                if s >= 0.999:
                    # Said the word, then said it again; the DP happened to attach the second utterance.
                    out.append(nxt)
                    out.append(Op(None, op.hyp, "repeat", 1.0))
                    k += 2
                    continue
                if s >= partial:
                    out.append(Op(nxt.ref, nxt.hyp, "self_correct", nxt.sim))
                    k += 2
                    continue
        out.append(op)
        k += 1
    return out


# ---------------------------------------------------------------- fusion across speech paths


def fuse(
    ref_words: list[str],
    hypotheses: dict[str, list[str]],
    lang: str,
    *,
    primary: str | None = None,
    letter_item: bool = False,
) -> list[FusedWord]:
    """Combine per-path alignments into one label per reference word.

    Pass only reference-free decodes: a path that saw the expected text (Azure Pronunciation Assessment) echoes
    it back and would always vote "correct".

    Each path first votes on whether the word was read correctly (majority; ties -> primary path); the label is
    then the majority among the paths on the winning side. uncertain = the paths disagree on read-correctly or
    not. Disagreements that do not change the score (correct vs self_correct, sub vs omit) are kept in `labels`
    for diagnosis but do not ask the teacher for a tap.
    Insert/repeat ops are not attached to reference words and are returned separately by `extras()`.
    """
    if not hypotheses:
        raise ValueError("at least one hypothesis path is required")
    names = list(hypotheses)
    primary = primary if primary in hypotheses else names[0]

    per_path: dict[str, list[Op]] = {
        name: [op for op in align(ref_words, hyp, lang, letter_item=letter_item) if op.ref is not None]
        for name, hyp in hypotheses.items()
    }
    # Each filtered op list has exactly one entry per reference word, in order.
    fused: list[FusedWord] = []
    for idx, ref in enumerate(ref_words):
        labels = {name: per_path[name][idx].label for name in names}
        heard = {name: per_path[name][idx].hyp for name in names}
        verdicts = {name: read_correctly(lab) for name, lab in labels.items()}
        verdict = _vote(verdicts, primary)
        label = _vote({name: lab for name, lab in labels.items() if verdicts[name] == verdict}, primary)
        fused.append(
            FusedWord(
                ref=ref,
                label=label,
                uncertain=len(set(verdicts.values())) > 1,
                heard=heard,
                labels=labels,
                sim=per_path[primary][idx].sim,
            )
        )
    return fused


def read_correctly(label: Label) -> bool:
    """Self-corrections count as correct (EGRA convention)."""
    return label in ("correct", "self_correct")


def _vote(values: dict[str, T], primary: str) -> T:
    """Majority value; ties go to the primary path if it is among the winners, else to the first path listed."""
    tally: dict[T, int] = {}
    for v in values.values():
        tally[v] = tally.get(v, 0) + 1
    top = max(tally.values())
    winners = [v for v, c in tally.items() if c == top]
    if primary in values and values[primary] in winners:
        return values[primary]
    return winners[0]


def extras(ref_words: list[str], hyp_words: list[str], lang: str, *, letter_item: bool = False) -> list[Op]:
    """Inserted and repeated words from one path (not attached to a reference word)."""
    return [op for op in align(ref_words, hyp_words, lang, letter_item=letter_item) if op.ref is None]


def counts(fused: list[FusedWord]) -> dict[str, int]:
    c = {"correct": 0, "self_correct": 0, "sub": 0, "omit": 0, "uncertain": 0}
    for w in fused:
        c[w.label] = c.get(w.label, 0) + 1
        if w.uncertain:
            c["uncertain"] += 1
    c["read_correctly"] = c["correct"] + c["self_correct"]
    c["errors"] = c["sub"] + c["omit"]
    return c
