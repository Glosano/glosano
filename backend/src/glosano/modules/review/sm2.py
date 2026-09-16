"""SM-2 (FLQ-20): полная шкала качества 0..5.

Formula: EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02)), floor 1.3, rounding to 2 places.
q>=3: progress with intervals 1 / 6 / round(interval x новый EF).
q<3: reset repetitions/interval to 0, due=now (card returns to next session).
Confidence (ADR-0005 mapping) is a separate axis in review/service.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

MIN_EASE_FACTOR = 1.3


@dataclass(frozen=True)
class Sm2State:
    ease_factor: float = 2.5
    interval_days: float = 0.0
    repetitions: int = 0


INITIAL_STATE = Sm2State()


def apply_answer(state: Sm2State, *, quality: int, now: datetime) -> tuple[Sm2State, datetime]:
    """Вернуть (новое состояние, новый due_at) для самооценки quality 0..5."""
    ef_delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    new_ef = max(MIN_EASE_FACTOR, round(state.ease_factor + ef_delta, 2))
    if quality < 3:
        return Sm2State(ease_factor=new_ef, interval_days=0.0, repetitions=0), now
    repetitions = state.repetitions + 1
    if repetitions == 1:
        interval = 1.0
    elif repetitions == 2:
        interval = 6.0
    else:
        interval = float(round(state.interval_days * new_ef))
    new = Sm2State(ease_factor=new_ef, interval_days=interval, repetitions=repetitions)
    return new, now + timedelta(days=interval)


def state_to_json(state: Sm2State) -> dict[str, float | int]:
    return {
        "ease_factor": state.ease_factor,
        "interval_days": state.interval_days,
        "repetitions": state.repetitions,
    }


def state_from_json(data: dict) -> Sm2State:  # type: ignore[type-arg]
    return Sm2State(
        ease_factor=float(data.get("ease_factor", INITIAL_STATE.ease_factor)),
        interval_days=float(data.get("interval_days", INITIAL_STATE.interval_days)),
        repetitions=int(data.get("repetitions", INITIAL_STATE.repetitions)),
    )
