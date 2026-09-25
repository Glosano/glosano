# ruff: noqa: RUF001 -- Unicode numeric forms are intentional regression fixtures.
"""Unit tests for tokenization primitives (AC#2). No DB."""

from __future__ import annotations

import pytest

from glosano.modules.lesson_library.tokenization import (
    Token,
    is_word_like,
    normalize_token,
    tokenize,
)


def test_normalize_lowercases_and_trims_outer_punctuation() -> None:
    assert normalize_token("Mundo.") == "mundo"
    assert normalize_token("«Olá»") == "olá"
    assert normalize_token("HELLO!") == "hello"


def test_normalize_preserves_diacritics() -> None:
    assert normalize_token("Não.") == "não"
    assert normalize_token("Café,") == "café"
    assert normalize_token("Что-то") == "что-то"


def test_normalize_preserves_internal_hyphen_and_apostrophe() -> None:
    assert normalize_token("co-op,") == "co-op"
    assert normalize_token("L'eau") == "l'eau"
    assert normalize_token("don't") == "don't"


def test_normalize_punctuation_only_is_empty() -> None:
    assert normalize_token("...") == ""
    assert normalize_token(",") == ""


def test_is_word_like() -> None:
    assert is_word_like("mundo") is True
    assert is_word_like("co-op") is True
    assert is_word_like("3.14") is False
    assert is_word_like(".") is False
    assert is_word_like("—") is False


@pytest.mark.parametrize(
    "surface",
    ["2020", "3.14", "1,000", "-42", "٢٠٢٠", "२०२०", "２０２０", "²", "Ⅷ", "___", "\u0301"],
)
def test_numbers_and_non_letters_are_not_words(surface: str) -> None:
    assert not is_word_like(surface)


@pytest.mark.parametrize(
    "surface", ["B2B", "COVID-19", "3D", "It's", "café", "год", "中文", "日本語", "أُحِبُّ", "हिन्दी"]
)
def test_words_with_letters_remain_learnable(surface: str) -> None:
    assert is_word_like(surface)


def test_year_stays_in_text_without_counting_as_a_word() -> None:
    text = "It's 2020. You're the most senior person on your team"
    tokens = tokenize(text, language_code="en", base_offset=7)
    assert sum(t.is_word_like for t in tokens) == 9
    year = tokens[1]
    assert year.surface_text == year.normalized_text == "2020"
    assert not year.is_word_like
    for token in tokens:
        assert text[token.start_char_offset - 7 : token.end_char_offset - 7] == token.surface_text


def test_tokenize_splits_words_and_punctuation_with_offsets() -> None:
    tokens = tokenize("Olá mundo.")
    assert [t.surface_text for t in tokens] == ["Olá", "mundo", "."]
    assert [t.normalized_text for t in tokens] == ["olá", "mundo", ""]
    assert [t.is_word_like for t in tokens] == [True, True, False]
    first = tokens[0]
    assert "Olá mundo."[first.start_char_offset : first.end_char_offset] == "Olá"
    period = tokens[-1]
    assert "Olá mundo."[period.start_char_offset : period.end_char_offset] == "."


def test_tokenize_keeps_internal_marks_as_one_token() -> None:
    tokens = tokenize("co-op l'eau")
    assert [t.surface_text for t in tokens] == ["co-op", "l'eau"]
    assert all(isinstance(t, Token) for t in tokens)
