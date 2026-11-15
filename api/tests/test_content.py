"""Every item bank must meet the ASER item spec; these tests are the gate for adding a language."""

import random

import pytest

from app.content import available_languages, draw_card, get_item, items, languages, pick_item, pictured, pool
from app.speech.align import tokenize

LANGS = available_languages()


def test_tier1_banks_exist():
    assert {"hi", "en"} <= set(LANGS)


def test_every_bank_language_is_configured():
    assert set(LANGS) <= set(languages())


@pytest.mark.parametrize("lang", LANGS)
def test_bank_meets_aser_spec(lang):
    by_level: dict[str, list] = {}
    for item in items(lang).values():
        assert item.id.startswith(f"{lang}-"), item.id
        by_level.setdefault(item.level, []).append(item)
        if item.level in ("letter", "word"):
            assert item.units and len(item.units) == 5, item.id
            assert len(set(item.units)) == 5, f"{item.id}: duplicate units"
            assert all(len(tokenize(u, lang)) == 1 for u in item.units), item.id
        elif item.level == "paragraph":
            assert item.sentences and len(item.sentences) == 4, item.id
            for s in item.sentences:
                assert len(tokenize(s, lang)) <= 6, f"{item.id}: {s}"
        elif item.level == "story":
            assert item.sentences and 7 <= len(item.sentences) <= 10, item.id
        else:
            pytest.fail(f"{item.id}: unknown level {item.level}")
    for level in ("letter", "word", "paragraph", "story"):
        assert len(by_level.get(level, [])) >= 2, f"{lang}: needs >=2 {level} variants"


def test_get_and_pick():
    assert get_item("hi-para-a").level == "paragraph"
    assert pick_item("hi", "word").id == "hi-word-a"
    assert pick_item("hi", "word", avoid={"hi-word-a"}).id == "hi-word-b"
    paragraphs = {it.id for it in items("hi").values() if it.level == "paragraph"}
    assert pick_item("hi", "paragraph", avoid=paragraphs).id == "hi-para-a"  # every one read: wraps around


# ---- more cards: pools to draw letter and word cards from, more paragraphs and stories, all as hard as the reviewed


@pytest.mark.parametrize("lang", LANGS)
def test_pools_follow_aser(lang):
    from scripts.draft_cards import word_problem  # noqa: PLC0415

    letters, words = pool(lang, "letter"), pool(lang, "word")
    assert len(set(letters)) == len(letters) >= 20 and all(len(tokenize(x, lang)) == 1 for x in letters)
    reviewed = {u for it in items(lang).values() if it.level == "letter" for u in it.units}
    assert reviewed <= {x.lower() for x in letters}, "the reviewed cards' letters are in the pool"
    assert len(set(words)) == len(words) >= 40
    assert [w for w in words if word_problem(w, lang)] == []
    assert len(set(words) & pictured(lang)) >= 6, "enough words with a picture for the meaning step"


@pytest.mark.parametrize("lang", LANGS)
def test_new_texts_are_as_hard_as_the_reviewed_ones(lang):
    from scripts.draft_cards import fits_like  # noqa: PLC0415

    for level, least in (("paragraph", 8), ("story", 6)):
        texts = [it for it in items(lang).values() if it.level == level]
        assert len(texts) >= least, (lang, level)
        for it in texts:
            assert it.title and not fits_like(list(it.sentences), lang, level), (it.id, fits_like(list(it.sentences), lang, level))
        assert len({it.title for it in texts}) == len(texts), f"{lang} {level}: titles repeat"


def test_a_drawn_card_carries_its_letters_or_words():
    rng = random.Random(1)
    card = draw_card("hi", "word", rng)
    assert card.id.startswith("hi-word~") and len(card.units) == 5 and len(set(card.units)) == 5
    assert get_item(card.id) == card  # scoring, replay and the phone's offline checks find it by its id
    assert len(set(card.units) & pictured("hi")) >= 2  # the meaning step has pictures to ask about
    assert draw_card("hi", "word", random.Random(1)) == card  # the same seed, the same card
    assert len({draw_card("hi", "letter", random.Random(n)).id for n in range(20)}) >= 18  # rarely the same twice
    with pytest.raises(KeyError):
        get_item("hi-word~गाय~पानी~मोर~केला~xyz")  # only the language's own words
    with pytest.raises(KeyError):
        get_item("hi-word~गाय~गाय~मोर~केला~दिन")
    recent = set(card.units)
    assert not recent & set(draw_card("hi", "word", random.Random(2), avoid_units=recent).units)
