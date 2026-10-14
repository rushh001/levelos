from app.speech.align import align, counts, extras, fuse, letter_form, normalize, similarity, tokenize


def labels(ops):
    return [(o.ref, o.hyp, o.label) for o in ops]


# ---- tokenisation / normalisation


def test_tokenize_strips_danda_and_punctuation():
    assert tokenize("राम घर जाता है। वह खेलता है।", "hi") == ["राम", "घर", "जाता", "है", "वह", "खेलता", "है"]
    assert tokenize("The cat sat, on the mat.", "en") == ["the", "cat", "sat", "on", "the", "mat"]


def test_normalize_collapses_asr_spelling_variants():
    assert normalize("ज़मीन", "hi") == normalize("जमीन", "hi")  # nukta
    assert normalize("माँ", "hi") == normalize("मां", "hi")  # chandrabindu vs anusvara


def test_letter_form_strips_matras_for_indic():
    assert letter_form("का", "hi") == "क"
    assert letter_form("क", "hi") == "क"
    assert letter_form("M", "en") == "m"


# ---- similarity


def test_similarity_exact_and_matra_error():
    assert similarity("कमल", "कमल", "hi") == 1.0
    s = similarity("कमल", "कमाल", "hi")  # one vowel sign off → close but not equal
    assert 0.5 < s < 1.0
    assert similarity("कमल", "हाथी", "hi") < 0.3


def test_english_letter_aliases():
    assert similarity("m", "em", "en", letter_item=True) == 1.0
    assert similarity("b", "bee", "en", letter_item=True) == 1.0
    assert similarity("b", "dee", "en", letter_item=True) < 1.0


# ---- alignment


def test_align_all_correct():
    ref = tokenize("राम घर जाता है", "hi")
    ops = align(ref, ref, "hi")
    assert [o.label for o in ops] == ["correct"] * 4


def test_align_substitution_omission_insertion():
    ref = tokenize("the cat sat on the mat", "en")
    hyp = tokenize("the cat sit on mat now", "en")
    got = labels(align(ref, hyp, "en"))
    assert got == [
        ("the", "the", "correct"),
        ("cat", "cat", "correct"),
        ("sat", "sit", "sub"),
        ("on", "on", "correct"),
        ("the", None, "omit"),
        ("mat", "mat", "correct"),
        (None, "now", "insert"),
    ]


def test_align_prefers_substitution_for_near_miss():
    ref = tokenize("कमल जल में खिला", "hi")
    hyp = tokenize("कमाल जल में खिला", "hi")
    got = labels(align(ref, hyp, "hi"))
    assert got[0] == ("कमल", "कमाल", "sub")
    assert [g[2] for g in got[1:]] == ["correct"] * 3


def test_repeat_is_not_an_error():
    ref = tokenize("the cat sat", "en")
    hyp = tokenize("the the cat sat", "en")
    got = labels(align(ref, hyp, "en"))
    assert ("the", "the", "correct") in got
    assert (None, "the", "repeat") in got
    assert counts(fuse(ref, {"a": hyp}, "en"))["errors"] == 0


def test_self_correction_counts_as_correct():
    ref = tokenize("कमल जल में", "hi")
    hyp = tokenize("कमाल कमल जल में", "hi")  # says wrong form, then corrects
    got = labels(align(ref, hyp, "hi"))
    assert got[0] == ("कमल", "कमल", "self_correct")
    assert counts(fuse(ref, {"a": hyp}, "hi"))["errors"] == 0


def test_letter_items_match_bare_consonant_to_matra_form():
    ref = ["क", "म", "ल", "ह", "त"]
    hyp = ["का", "म", "ला", "ह", "ता"]  # ASR renders the spoken inherent vowel as a matra
    ops = align(ref, hyp, "hi", letter_item=True)
    assert [o.label for o in ops] == ["correct"] * 5


# ---- fusion across paths


def test_fuse_agreement_is_certain():
    ref = tokenize("the cat sat", "en")
    fused = fuse(ref, {"sarvam": ref, "azure": ref}, "en")
    assert all(w.label == "correct" and not w.uncertain for w in fused)


def test_fuse_disagreement_is_uncertain_and_majority_wins():
    ref = tokenize("the cat sat on the mat", "en")
    a = tokenize("the cat sat on the mat", "en")  # heard it right
    b = tokenize("the cat sit on the mat", "en")  # heard a substitution
    c = tokenize("the cat sat on the mat", "en")
    fused = fuse(ref, {"sarvam": a, "azure": b, "gemini": c}, "en", primary="sarvam")
    sat = fused[2]
    assert sat.ref == "sat"
    assert sat.uncertain
    assert sat.label == "correct"  # 2 of 3
    assert sat.labels == {"sarvam": "correct", "azure": "sub", "gemini": "correct"}
    assert sat.heard["azure"] == "sit"
    assert counts(fused)["uncertain"] == 1


def test_fuse_tie_goes_to_primary():
    ref = tokenize("cat", "en")
    fused = fuse(ref, {"sarvam": ["cut"], "azure": ["cat"]}, "en", primary="azure")
    assert fused[0].label == "correct" and fused[0].uncertain


def test_extras_lists_insertions():
    ref = tokenize("the cat", "en")
    assert [o.hyp for o in extras(ref, tokenize("the big cat", "en"), "en")] == ["big"]
