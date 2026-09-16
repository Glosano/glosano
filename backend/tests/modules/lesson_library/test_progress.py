"""Формула процента прочитанного (FLQ-8a) — зеркало ReaderPage.tsx:133-137."""

from __future__ import annotations

from glosano.modules.lesson_library.progress import ZERO_PROGRESS, read_percent


def test_no_position_means_not_started() -> None:
    """Урок ни разу не открывали — строки reader_positions нет."""
    assert read_percent(None, 42) == 0


def test_lesson_without_words_is_zero() -> None:
    """MAX(ordinal) по пустой выборке — NULL; деления быть не должно."""
    assert read_percent(0, None) == 0


def test_single_word_lesson_is_complete() -> None:
    """max_ordinal == 0: единственное слово урока и есть его конец."""
    assert read_percent(0, 0) == 100


def test_halfway_through() -> None:
    assert read_percent(50, 100) == 50


def test_last_word_is_hundred() -> None:
    assert read_percent(100, 100) == 100


def test_position_past_end_clamps_to_hundred() -> None:
    """Текст переимпортировали и он стал короче — позиция осталась старой."""
    assert read_percent(150, 100) == 100


def test_negative_position_clamps_to_zero() -> None:
    assert read_percent(-5, 100) == 0


def test_rounds_to_nearest_integer() -> None:
    assert read_percent(1, 3) == 33


def test_half_up_rounding_12_5_percent() -> None:
    """Regression: Python round() vs JS Math.round() semantics on .5 boundaries.

    position=1, max_ordinal=8 → 1/8 * 100 = 12.5%
    Python's round(12.5) == 12 (banker's rounding), but JS Math.round(12.5) === 13.
    Must use math.floor(x + 0.5) to match the reader bar.
    """
    assert read_percent(1, 8) == 13


def test_half_up_rounding_37_5_percent() -> None:
    """Regression: another .5 boundary case.

    position=3, max_ordinal=8 → 3/8 * 100 = 37.5%
    Must round up to 38 to match JS Math.round().
    """
    assert read_percent(3, 8) == 38


def test_zero_progress_constant_is_all_zeroes() -> None:
    assert ZERO_PROGRESS.read_percent == 0
    assert ZERO_PROGRESS.new_words_remaining == 0
