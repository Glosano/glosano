"""SM-2 baseline (FLQ-7). Бинарный ответ мапится в SM-2 quality: верно=4, ошибка=2.

При q=4 формула EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02)) даёт дельту 0 — EF
не меняется. При q=2 дельта -0.32, floor 1.3 (константы SM-2). Ошибка сбрасывает
repetitions/interval, due — сразу (карточка вернётся в ближайшую сессию).
Confidence (ADR-0005 ±1) — отдельная ось, живёт в review/service.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

MIN_EASE_FACTOR = 1.3
WRONG_EF_PENALTY = 0.32


@dataclass(frozen=True)
class Sm2State:
    ease_factor: float = 2.5
    interval_days: float = 0.0
    repetitions: int = 0


INITIAL_STATE = Sm2State()


def apply_answer(state: Sm2State, *, correct: bool, now: datetime) -> tuple[Sm2State, datetime]:
    """Вернуть (новое состояние, новый due_at)."""
    if not correct:
        new = Sm2State(
            ease_factor=max(MIN_EASE_FACTOR, round(state.ease_factor - WRONG_EF_PENALTY, 2)),
            interval_days=0.0,
            repetitions=0,
        )
        return new, now
    repetitions = state.repetitions + 1
    if repetitions == 1:
        interval = 1.0
    elif repetitions == 2:
        interval = 6.0
    else:
        interval = float(round(state.interval_days * state.ease_factor))
    new = Sm2State(ease_factor=state.ease_factor, interval_days=interval, repetitions=repetitions)
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
