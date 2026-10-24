"""Every item bank must meet the ASER item spec; these tests are the gate for adding a language."""

import pytest

from app.content import available_languages, get_item, items, languages, pick_item
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
    assert pick_item("hi", "paragraph", avoid={"hi-para-a", "hi-para-b"}).id == "hi-para-a"  # wraps around
