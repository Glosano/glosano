"""Tag normalization shared by every tag write and filter (FLQ-39, ADR-0026)."""

import time
import unicodedata

import pytest

from glosano.modules.lesson_library.tags import (
    MAX_TAG_LENGTH,
    MAX_TAGS_PER_LESSON,
    normalize_tags,
)


def test_normalizes_case_whitespace_and_unicode_form() -> None:
    nfd = unicodedata.normalize("NFD", "Café")
    assert normalize_tags([f"  {nfd} ", " CAFÉ", "Grammar\t  B2"]) == ["café", "grammar b2"]


def test_drops_empty_pieces_and_duplicates_keeping_first_order() -> None:
    assert normalize_tags(["b", "", "  ", "a", "B"]) == ["b", "a"]


def test_separators_inside_a_value_split_it() -> None:
    assert normalize_tags(["a,b", "c;d", "e，f、g；h"]) == list("abcdefgh")  # noqa: RUF001


def test_length_limit() -> None:
    assert normalize_tags(["x" * MAX_TAG_LENGTH]) == ["x" * 40]
    with pytest.raises(ValueError, match="longer than 40"):
        normalize_tags(["x" * 41])


def test_count_limit_applies_after_dedupe() -> None:
    tags = [f"t{i}" for i in range(MAX_TAGS_PER_LESSON)]
    assert normalize_tags([*tags, "T0"]) == tags
    with pytest.raises(ValueError, match="no more than 20"):
        normalize_tags([*tags, "extra"])


def test_oversized_input_is_rejected_quickly() -> None:
    huge = [f"t{i}" for i in range(200_000)]
    started = time.perf_counter()
    with pytest.raises(ValueError, match="no more than 20"):
        normalize_tags(huge)
    assert time.perf_counter() - started < 0.5


def test_max_tags_none_disables_the_count_limit() -> None:
    many = [f"t{i}" for i in range(25)]
    assert normalize_tags(many, max_tags=None) == many
