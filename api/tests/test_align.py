from app.speech.align import align, counts, extras, fuse, letter_form, normalize, similarity, tokenize


def labels(ops):
    return [(o.ref, o.hyp, o.label) for o in ops]


# ---- tokenisation / normalisation


def test_tokenize_strips_danda_and_punctuation():
    assert tokenize("राम घर जाता है। वह खेलता है।", "hi") == ["राम", "घर", "जाता", "है", "वह", "खेलता", "है"]
    assert tokenize("The cat sat, on the mat.", "en") == ["The", "cat", "sat", "on", "the", "mat"]
    assert tokenize("सड़क पर पानी", "hi")[0] == "सड़क"  # spelling kept for display; matching normalises


def test_matching_ignores_case_and_spelling_variants():
    assert [o.label for o in align(tokenize("The cat", "en"), ["the", "CAT"], "en")] == ["correct", "correct"]
    assert align(["सड़क"], ["सडक"], "hi")[0].label == "correct"


def test_normalize_collapses_asr_spelling_variants():
    assert normalize("ज़मीन", "hi") == normalize("जमीन", "hi")  # nukta
    assert normalize("माँ", "hi") == normalize("मां", "hi")  # chandrabindu vs anusvara


def test_letter_form_strips_matras_for_indic():
    assert letter_form("का", "hi") == "क"
    assert letter_form("क", "hi") == "क"
    assert letter_form("M", "en") == "m"


def test_letter_items_tolerate_engines_turning_letters_into_words():
    # Azure STT, seen on a real run: "क म श र ल" came back as "क माँ शाह राह ला".
    ops = align(["क", "म", "श", "र", "ल"], ["क", "माँ", "शाह", "राह", "ला"], "hi", letter_item=True)
    assert [o.label for o in ops] == ["correct"] * 5
    assert similarity("स", "शाह", "hi", letter_item=True) < 1.0  # a different consonant is still wrong
    assert letter_form("क्षमा", "hi") == "कष"  # conjunct letter stays one unit


def test_letter_items_in_every_supported_script():
    # The spoken inherent vowel comes back as a vowel sign in every Indic script, not just Devanagari.
    cases = [("hi", "क", "का"), ("mr", "क", "की"), ("gu", "ક", "કા"), ("kn", "ಕ", "ಕಾ"),
             ("ta", "க", "கா"), ("te", "క", "కా"), ("or", "କ", "କା"), ("ta", "க", "க்")]
    for lang, ref, heard in cases:
        assert similarity(ref, heard, lang, letter_item=True) == 1.0, (lang, heard)
    # A different consonant is still wrong.
    assert similarity("க", "ப", "ta", letter_item=True) < 1.0


def test_normalize_nukta_in_precomposed_and_other_scripts():
    assert normalize("ड़", "hi") == normalize("ड", "hi")  # U+095C decomposes under NFC
    assert normalize("ऩ", "hi") == normalize("न", "hi")  # U+0929 stays composed under NFC
    assert normalize("ଡ଼", "or") == normalize("ଡ", "or")


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


def test_joined_and_split_compounds_are_not_errors():
    # Seen on a real recording: Azure wrote "everyday" for "every day".
    ref = tokenize("I play with it every day", "en")
    assert [o.label for o in align(ref, tokenize("I play with it everyday", "en"), "en")] == ["correct"] * 6
    ref = tokenize("दोनों पेड़ के नीचे बैठकर आम खाने लगीं", "hi")
    hyp = tokenize("दोनों पेड़ के नीचे बैठ कर आम खाने लगीं", "hi")
    assert [o.label for o in align(ref, hyp, "hi")] == ["correct"] * 8
    # A genuinely different word is still an error.
    assert [o.label for o in align(tokenize("every day", "en"), ["everybody"], "en")] != ["correct", "correct"]


def test_letter_reversal_is_two_errors():
    ops = align(["d", "b", "n", "e", "g"], ["bee", "dee", "en", "ee", "gee"], "en", letter_item=True)
    assert [o.label for o in ops] == ["sub", "sub", "correct", "correct", "correct"]


def test_letter_card_skip_is_one_omission():
    ops = align(["क", "म", "स", "र", "ल"], ["क", "स", "र", "ल"], "hi", letter_item=True)
    assert [o.label for o in ops] == ["correct", "omit", "correct", "correct", "correct"]


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


def test_fuse_correct_vs_self_correct_is_not_uncertain():
    # Both count as read correctly, so the teacher is not asked to confirm.
    ref = tokenize("कमल जल में", "hi")
    fused = fuse(ref, {"sarvam": tokenize("कमाल कमल जल में", "hi"), "azure_stt": ref}, "hi")
    assert fused[0].labels == {"sarvam": "self_correct", "azure_stt": "correct"}
    assert not fused[0].uncertain
    assert counts(fused)["errors"] == 0


def test_fuse_sub_vs_omit_is_not_uncertain():
    ref = tokenize("the cat sat", "en")
    fused = fuse(ref, {"sarvam": tokenize("the cat sit", "en"), "azure_stt": tokenize("the cat", "en")}, "en")
    assert fused[2].labels == {"sarvam": "sub", "azure_stt": "omit"}
    assert not fused[2].uncertain
    assert fused[2].label == "sub"  # tie inside the error side -> primary (first) path


def test_extras_lists_insertions():
    ref = tokenize("the cat", "en")
    assert [o.hyp for o in extras(ref, tokenize("the big cat", "en"), "en")] == ["big"]
