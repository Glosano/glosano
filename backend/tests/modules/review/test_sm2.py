"""SM-2 baseline (FLQ-7 Task 2): интервалы 1/6/x EF, EF-штраф with floor, reset."""

from datetime import UTC, datetime, timedelta

from flinq.modules.review.sm2 import (
    INITIAL_STATE,
    Sm2State,
    apply_answer,
    state_from_json,
    state_to_json,
)

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


def test_first_correct_gives_one_day():
    state, due = apply_answer(INITIAL_STATE, correct=True, now=NOW)
    assert state == Sm2State(ease_factor=2.5, interval_days=1.0, repetitions=1)
    assert due == NOW + timedelta(days=1)


def test_second_correct_gives_six_days():
    s1, _ = apply_answer(INITIAL_STATE, correct=True, now=NOW)
    s2, due = apply_answer(s1, correct=True, now=NOW)
    assert s2.interval_days == 6.0 and s2.repetitions == 2
    assert due == NOW + timedelta(days=6)


def test_third_correct_multiplies_by_ease_factor():
    s = Sm2State(ease_factor=2.5, interval_days=6.0, repetitions=2)
    s3, due = apply_answer(s, correct=True, now=NOW)
    assert s3.interval_days == 15.0  # round(6 * 2.5)
    assert s3.repetitions == 3
    assert due == NOW + timedelta(days=15)


def test_correct_keeps_ease_factor():
    """quality=4 в формуле SM-2 даёт дельту EF ровно 0."""
    s = Sm2State(ease_factor=2.1, interval_days=6.0, repetitions=2)
    s2, _ = apply_answer(s, correct=True, now=NOW)
    assert s2.ease_factor == 2.1


def test_wrong_resets_and_penalizes_ease_factor():
    s = Sm2State(ease_factor=2.5, interval_days=15.0, repetitions=3)
    s2, due = apply_answer(s, correct=False, now=NOW)
    assert s2 == Sm2State(ease_factor=2.18, interval_days=0.0, repetitions=0)
    assert due == NOW  # снова due сразу


def test_wrong_ease_factor_floor():
    s = Sm2State(ease_factor=1.4, interval_days=1.0, repetitions=1)
    s2, _ = apply_answer(s, correct=False, now=NOW)
    assert s2.ease_factor == 1.3


def test_json_roundtrip_and_missing_keys():
    s = Sm2State(ease_factor=2.18, interval_days=15.0, repetitions=3)
    assert state_from_json(state_to_json(s)) == s
    assert state_from_json({}) == INITIAL_STATE
