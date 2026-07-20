"""SM-2 full quality scale (FLQ-20): EF-дельты по формуле, floor, reset при q<3."""

from datetime import UTC, datetime, timedelta

import pytest

from flinq.modules.review.sm2 import (
    INITIAL_STATE,
    Sm2State,
    apply_answer,
    state_from_json,
    state_to_json,
)

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("quality", "expected_delta"),
    [(5, 0.1), (4, 0.0), (3, -0.14), (2, -0.32), (1, -0.54), (0, -0.8)],
)
def test_ef_delta_formula(quality: int, expected_delta: float):
    state = Sm2State(ease_factor=2.5, interval_days=6.0, repetitions=2)
    new, _ = apply_answer(state, quality=quality, now=NOW)
    assert new.ease_factor == round(2.5 + expected_delta, 2)


def test_first_success_gives_one_day():
    state, due = apply_answer(INITIAL_STATE, quality=4, now=NOW)
    assert state == Sm2State(ease_factor=2.5, interval_days=1.0, repetitions=1)
    assert due == NOW + timedelta(days=1)


def test_second_success_gives_six_days():
    s1, _ = apply_answer(INITIAL_STATE, quality=4, now=NOW)
    s2, due = apply_answer(s1, quality=4, now=NOW)
    assert s2.interval_days == 6.0 and s2.repetitions == 2
    assert due == NOW + timedelta(days=6)


def test_third_success_multiplies_by_new_ef():
    s = Sm2State(ease_factor=2.5, interval_days=6.0, repetitions=2)
    s3, due = apply_answer(s, quality=5, now=NOW)
    # EF' = 2.6 (q=5: +0.1); interval = round(6 * 2.6) = 16 — новый EF, каноничный SM-2
    assert s3.ease_factor == 2.6
    assert s3.interval_days == 16.0 and s3.repetitions == 3
    assert due == NOW + timedelta(days=16)


def test_q3_progresses_but_penalizes_ef():
    s = Sm2State(ease_factor=2.5, interval_days=6.0, repetitions=2)
    s3, _ = apply_answer(s, quality=3, now=NOW)
    assert s3.ease_factor == 2.36  # -0.14
    assert s3.repetitions == 3  # q=3 — всё ещё прогресс


def test_failure_resets_and_due_now():
    s = Sm2State(ease_factor=2.5, interval_days=15.0, repetitions=3)
    s2, due = apply_answer(s, quality=2, now=NOW)
    assert s2 == Sm2State(ease_factor=2.18, interval_days=0.0, repetitions=0)
    assert due == NOW


def test_ef_floor_on_worst_answer():
    s = Sm2State(ease_factor=1.5, interval_days=1.0, repetitions=1)
    s2, _ = apply_answer(s, quality=0, now=NOW)
    assert s2.ease_factor == 1.3  # 1.5 - 0.8 = 0.7 -> floor


def test_repeated_failure_at_floor_stays_at_floor():
    s = Sm2State(ease_factor=1.3, interval_days=0.0, repetitions=0)
    s2, _ = apply_answer(s, quality=0, now=NOW)
    assert s2.ease_factor == 1.3


def test_json_roundtrip_and_missing_keys():
    s = Sm2State(ease_factor=2.18, interval_days=15.0, repetitions=3)
    assert state_from_json(state_to_json(s)) == s
    assert state_from_json({}) == INITIAL_STATE
