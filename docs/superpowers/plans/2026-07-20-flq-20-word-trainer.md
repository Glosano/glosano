# FLQ-20 Word Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Тренажёр изучения слов поверх SRS: самооценка 0..5 (полный SM-2), режимы Новые/Cloze/Reverse/Практика перевода с AI-генерацией упражнений на лету, экран выбора режима на `/learn/$lang/review`, письменное упражнение по ошибкам.

**Architecture:** Backend: миграция 0013 (`review_events.quality`), полная шкала в `sm2.py`, `answer(quality)`, режимы очереди (`due|new|practice`) + `/counts`, новый сервис `modules/review/exercises.py` поверх гейтвея FLQ-3 (провайдер получает параметр `max_tokens`, audit-писатель становится публичным). Frontend: `useReviewSession`-хук (общая логика сессии), `GradeBar` 0..5 вместо ✗/✓, экран выбора режима, карточки-компоненты по режимам, загрузка упражнения при показе карточки.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + pytest/testcontainers; React 19 + TanStack Router/Query + vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-word-trainer-design.md` (одобрена, commit b4a9d17). Backlog: FLQ-20.

## Global Constraints

- Backend-команды из `backend/`: `uv run pytest`, `uv run pyright`, `uv run ruff check .`; **`ruff format` запускать ТОЛЬКО на изменённых файлах** (не `.` — переформатирует чужие).
- Frontend-команды из `frontend/` (**pnpm**): `pnpm exec vitest run <path>`, `pnpm exec tsc -b`, `pnpm run lint`.
- Коммиты: conventional commits, БЕЗ Co-Authored-By трейлера. Никаких noqa внутри докстрингов; suppressions — только при реальной ругани линтера.
- Шкала качества: 0..5. SM-2: `EF += 0.1 − (5−q)·(0.08 + (5−q)·0.02)`, floor 1.3, округление EF до 2 знаков; q≥3 — прогресс (интервалы 1 / 6 / `round(interval × новый EF)`); q<3 — сброс (`repetitions=0`, `interval=0`, `due=now`).
- Confidence (амендмент ADR-0005): q≤2 → −1 (floor 0); q=3 → 0; q≥4 → +1 (cap 5). Graduation: q≥4 при `confidence == 5` → `known` + деактивация.
- `answer_value` события — производное: `'correct'` при q≥3, иначе `'wrong'` (старая аналитика не ломается); `quality` пишется в новую колонку.
- Практика перевода: НЕ пишет review_events, вне дневного лимита. Режимы new/cloze/reverse/cards — SRS-режимы, считаются в лимит.
- Лимиты сессий: new — `min(20, остаток дневного лимита)`; practice — 5 случайных.
- AI: только через паттерн FLQ-3 (kill-switch `AIDisabled` → HTTP 503; `ProviderUnavailable/Rejected` и непарсибельный JSON после одного ретрая → HTTP 502; audit `AIRequest` best-effort; сырой текст ответов НЕ логируется — ADR-0003).
- UI-строки на русском. Подписи GradeBar: 5 Идеально · 4 С заминкой · 3 С трудом · 2 Ошибка, легко вспомнил · 1 Ошибка, вспомнил · 0 Полный провал.

---

### Task 1: Миграция 0013 — `review_events.quality`

**Files:**
- Modify: `backend/src/glosano/modules/review/models.py` (класс ReviewEvent, ~строки 60-85)
- Create: `backend/migrations/versions/0013_review_quality.py`
- Test: Modify `backend/tests/modules/review/test_models.py` (добавить тесты)

**Interfaces:**
- Produces: `ReviewEvent.quality: Mapped[int | None]` (SMALLINT, CHECK 0..5, NULL для старых строк); миграция `0013_review_quality` (`down_revision = "0012_review"`).

- [ ] **Step 1: Написать падающие тесты** — добавить в конец `backend/tests/modules/review/test_models.py`:

```python
async def test_review_event_quality_roundtrip():
    now = datetime.now(UTC)
    async with session_scope() as s:
        user_id = await _make_user(s)
        ri = ReviewItem(
            user_id=user_id, item_kind="token", item_id=uuid.uuid4(),
            language_code="pt", algorithm_state_json={}, due_at=now,
        )
        s.add(ri)
        await s.flush()
        s.add(
            ReviewEvent(
                review_item_id=ri.id, user_id=user_id, answer_value="correct",
                quality=4, previous_confidence=1, new_confidence=2,
                previous_due_at=now, new_due_at=now,
            )
        )
        # старые события без quality остаются валидными
        s.add(
            ReviewEvent(
                review_item_id=ri.id, user_id=user_id, answer_value="wrong",
                previous_confidence=1, new_confidence=0,
                previous_due_at=now, new_due_at=now,
            )
        )
        await s.commit()
    async with session_scope() as s:
        rows = (await s.execute(select(ReviewEvent).order_by(ReviewEvent.reviewed_at))).scalars().all()
        assert {r.quality for r in rows} == {4, None}


def test_migration_0013_chains_from_0012():
    spec = importlib.util.spec_from_file_location(
        "0013_review_quality",
        Path(__file__).parent.parent.parent.parent
        / "migrations" / "versions" / "0013_review_quality.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.revision == "0013_review_quality"
    assert mod.down_revision == "0012_review"
    assert callable(mod.upgrade) and callable(mod.downgrade)
```

- [ ] **Step 2: Запустить — падают**

Run: `cd backend && uv run pytest tests/modules/review/test_models.py -v`
Expected: FAIL — `TypeError: 'quality' is an invalid keyword argument` / файл миграции не найден

- [ ] **Step 3: Реализация — модель**

В `ReviewEvent` (models.py) после `answer_value` добавить:

```python
    quality: Mapped[int | None] = mapped_column(SmallInteger)
```

и в `__table_args__` добавить:

```python
        CheckConstraint(
            "quality IS NULL OR (quality >= 0 AND quality <= 5)",
            name="ck_review_events_quality_range",
        ),
```

- [ ] **Step 4: Реализация — миграция**

```python
# backend/migrations/versions/0013_review_quality.py
"""review_events.quality — самооценка 0..5 (FLQ-20)

Revision ID: 0013_review_quality
Revises: 0012_review
Create Date: 2026-07-20 00:00:00.000000

Новые события пишут quality и производный answer_value ('correct' при q>=3).
Старые строки остаются с quality NULL — аналитика по answer_value не ломается.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_review_quality"
down_revision: str | Sequence[str] | None = "0012_review"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("review_events", sa.Column("quality", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "ck_review_events_quality_range",
        "review_events",
        "quality IS NULL OR (quality >= 0 AND quality <= 5)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_review_events_quality_range", "review_events", type_="check")
    op.drop_column("review_events", "quality")
```

- [ ] **Step 5: Прогнать тесты, линт/типы**

Run: `cd backend && uv run pytest tests/modules/review/test_models.py -v && uv run ruff check . && uv run ruff format src/glosano/modules/review/models.py migrations/versions/0013_review_quality.py tests/modules/review/test_models.py && uv run pyright`
Expected: все PASS, чисто

- [ ] **Step 6: Commit**

```bash
git add backend/src/glosano/modules/review/models.py backend/migrations/versions/0013_review_quality.py backend/tests/modules/review/test_models.py
git commit -m "feat(review): review_events.quality column, migration 0013"
```

---

### Task 2: SM-2 — полная шкала качества

**Files:**
- Modify: `backend/src/glosano/modules/review/sm2.py` (весь файл)
- Modify: `backend/src/glosano/modules/review/service.py` (одна строка вызова в `answer()`, ~324-326)
- Test: Modify `backend/tests/modules/review/test_sm2.py` (переписать под quality)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `apply_answer(state: Sm2State, *, quality: int, now: datetime) -> tuple[Sm2State, datetime]` — **заменяет** `correct: bool`. Временный шим в service.py (`quality=4 if correct else 2`) сохраняет текущее поведение до Task 3 (при q=4 дельта EF = 0, при q=2 = −0.32 — байт-в-байт старые интервалы/EF, регресс FLQ-7 остаётся зелёным).

- [ ] **Step 1: Переписать тесты test_sm2.py** (файл целиком):

```python
# backend/tests/modules/review/test_sm2.py
"""SM-2 full quality scale (FLQ-20): EF-дельты по формуле, floor, reset при q<3."""

from datetime import UTC, datetime, timedelta

import pytest

from glosano.modules.review.sm2 import (
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
    state = Sm2State(ease_factor=2.0, interval_days=6.0, repetitions=2)
    new, _ = apply_answer(state, quality=quality, now=NOW)
    assert new.ease_factor == round(2.0 + expected_delta, 2)


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
    assert s3.ease_factor == 2.36  # −0.14
    assert s3.repetitions == 3  # q=3 — всё ещё прогресс


def test_failure_resets_and_due_now():
    s = Sm2State(ease_factor=2.5, interval_days=15.0, repetitions=3)
    s2, due = apply_answer(s, quality=2, now=NOW)
    assert s2 == Sm2State(ease_factor=2.18, interval_days=0.0, repetitions=0)
    assert due == NOW


def test_ef_floor_on_worst_answer():
    s = Sm2State(ease_factor=1.5, interval_days=1.0, repetitions=1)
    s2, _ = apply_answer(s, quality=0, now=NOW)
    assert s2.ease_factor == 1.3  # 1.5 − 0.8 = 0.7 → floor


def test_repeated_failure_at_floor_stays_at_floor():
    s = Sm2State(ease_factor=1.3, interval_days=0.0, repetitions=0)
    s2, _ = apply_answer(s, quality=0, now=NOW)
    assert s2.ease_factor == 1.3


def test_json_roundtrip_and_missing_keys():
    s = Sm2State(ease_factor=2.18, interval_days=15.0, repetitions=3)
    assert state_from_json(state_to_json(s)) == s
    assert state_from_json({}) == INITIAL_STATE
```

- [ ] **Step 2: Запустить — падают**

Run: `cd backend && uv run pytest tests/modules/review/test_sm2.py -v`
Expected: FAIL — `TypeError: apply_answer() got an unexpected keyword argument 'quality'`

- [ ] **Step 3: Реализация sm2.py** (файл целиком):

```python
# backend/src/glosano/modules/review/sm2.py
"""SM-2 (FLQ-20): полная шкала качества 0..5.

EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02)), floor 1.3, округление до 2 знаков.
q>=3 — прогресс: интервалы 1 / 6 / round(interval x новый EF).
q<3 — сброс: repetitions=0, interval=0, due=now (карточка вернётся в сессию).
Confidence (ADR-0005, маппинг q) — отдельная ось, живёт в review/service.py.
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
```

- [ ] **Step 4: Шим в service.py** — в `answer()` заменить

```python
    new_state, due_at = apply_answer(
        state_from_json(ri.algorithm_state_json), correct=correct, now=now
    )
```

на

```python
    new_state, due_at = apply_answer(
        state_from_json(ri.algorithm_state_json), quality=4 if correct else 2, now=now
    )
```

**Внимание к регрессу**: при q=4 интервал теперь умножается на НОВЫЙ EF, но дельта q=4 равна 0 → EF не меняется → интервалы идентичны FLQ-7. Существующие тесты answer/API должны остаться зелёными без правок.

- [ ] **Step 5: Прогнать модуль + регресс**

Run: `cd backend && uv run pytest tests/modules/review/ tests/api/test_review.py -v && uv run ruff check . && uv run ruff format src/glosano/modules/review/sm2.py src/glosano/modules/review/service.py tests/modules/review/test_sm2.py && uv run pyright`
Expected: все PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/glosano/modules/review/sm2.py backend/src/glosano/modules/review/service.py backend/tests/modules/review/test_sm2.py
git commit -m "feat(review): SM-2 full 0..5 quality scale (binary call sites shimmed)"
```

---

### Task 3: `answer(quality)` — сервис и API

**Files:**
- Modify: `backend/src/glosano/modules/review/service.py` (`answer()`, ~304-363)
- Modify: `backend/src/glosano/modules/review/schemas.py` (`AnswerRequest`, `AnswerResponse`)
- Modify: `backend/src/glosano/api/review.py` (эндпоинт `answer`)
- Test: Modify `backend/tests/modules/review/test_review_answer.py`, `backend/tests/api/test_review.py`

**Interfaces:**
- Consumes: `apply_answer(state, *, quality, now)` (Task 2), `ReviewEvent.quality` (Task 1).
- Produces:
  - `service.answer(session, *, user_id, review_item_id, quality: int, now=None) -> AnswerResult` — quality 0..5 (валидация на API); confidence по маппингу Global Constraints; graduation q≥4 при c=5; событие пишет `quality` и производный `answer_value`.
  - HTTP: `POST /api/review/answer {"review_item_id", "quality": 0..5}` → как раньше `{new_confidence, new_status, due_at, done_today}`; 422 при quality вне 0..5.

- [ ] **Step 1: Переписать сервис-тесты** — в `test_review_answer.py` заменить тела тестов (setup-helpers `_make_user`/`_setup`/`_clean` не трогать):

```python
async def test_q4_bumps_confidence_and_schedules():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=1)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
        assert res.new_confidence == 2 and res.new_status == "tracked"
        assert res.due_at == NOW + timedelta(days=1)
        assert res.done_today == 1
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.quality == 4 and ev.answer_value == "correct"
        assert (ev.previous_confidence, ev.new_confidence) == (1, 2)


async def test_q3_keeps_confidence_but_progresses_srs():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=2)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=3, now=NOW)
        assert res.new_confidence == 2  # q=3: confidence без изменений
        assert res.due_at == NOW + timedelta(days=1)  # но SRS прогрессирует
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.quality == 3 and ev.answer_value == "correct"


async def test_q0_drops_confidence_floor_zero_and_due_now():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=0)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=0, now=NOW)
        assert res.new_confidence == 0  # floor
        assert res.due_at == NOW
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.quality == 0 and ev.answer_value == "wrong"


async def test_graduation_at_q4_confidence_five():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=5)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
        assert res.new_status == "known" and res.new_confidence is None
    async with session_scope() as s:
        item_db = (await s.execute(select(TokenItem))).scalars().one()
        assert item_db.status == "known" and item_db.confidence is None
        ri_db = (await s.execute(select(ReviewItem))).scalars().one()
        assert ri_db.is_active is False


async def test_q3_at_confidence_five_does_not_graduate():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=5)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=3, now=NOW)
        assert res.new_status == "tracked" and res.new_confidence == 5


async def test_events_are_append_only_across_answers():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=1)
        await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
        await answer(s, user_id=user_id, review_item_id=ri.id, quality=1, now=NOW)
        events = (await s.execute(select(ReviewEvent))).scalars().all()
        assert len(events) == 2


async def test_foreign_or_inactive_item_raises():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=5)
        stranger = await _make_user(s)
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=stranger, review_item_id=ri.id, quality=4, now=NOW)
        await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)  # graduation
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
```

- [ ] **Step 2: Переписать API-тесты** — в `tests/api/test_review.py`: в `test_answer_flow_updates_confidence_and_counts` body → `{"review_item_id": review_item_id, "quality": 4}`; в `test_answer_invalid_value_422_and_foreign_404` невалидный body → `{"review_item_id": review_item_id, "quality": 7}` (422), foreign-запрос → `{"review_item_id": review_item_id, "quality": 4}` (404).

- [ ] **Step 3: Запустить — падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_answer.py tests/api/test_review.py -v`
Expected: FAIL — `unexpected keyword argument 'quality'`

- [ ] **Step 4: Реализация — service.answer()**

Заменить сигнатуру и тело мутационной части:

```python
async def answer(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    review_item_id: uuid.UUID,
    quality: int,
    now: datetime | None = None,
) -> AnswerResult:
    now = now or datetime.now(UTC)
    ri = await session.get(ReviewItem, review_item_id)
    if ri is None or ri.user_id != user_id or not ri.is_active:
        raise ReviewItemNotFound(str(review_item_id))
    item = await session.get(_VOCAB_MODEL_BY_KIND[ri.item_kind], ri.item_id)
    if item is None or item.user_id != user_id or item.status != "tracked":
        raise ReviewItemNotFound(str(review_item_id))

    prev_confidence = item.confidence if item.confidence is not None else 0
    prev_due = ri.due_at

    new_state, due_at = apply_answer(
        state_from_json(ri.algorithm_state_json), quality=quality, now=now
    )
    ri.algorithm_state_json = state_to_json(new_state)
    ri.due_at = due_at
    ri.last_reviewed_at = now

    new_confidence: int | None
    if quality >= 4 and prev_confidence >= 5:
        # Graduation (spec §3): q>=4 при confidence 5 -> known, review закрывается.
        item.status = "known"
        item.confidence = None
        ri.is_active = False
        new_confidence = None
        new_status = "known"
    else:
        if quality >= 4:
            new_confidence = min(5, prev_confidence + 1)
        elif quality == 3:
            new_confidence = prev_confidence
        else:
            new_confidence = max(0, prev_confidence - 1)
        item.confidence = new_confidence
        new_status = "tracked"

    session.add(
        ReviewEvent(
            review_item_id=ri.id,
            user_id=user_id,
            answer_value="correct" if quality >= 3 else "wrong",
            quality=quality,
            previous_confidence=prev_confidence,
            new_confidence=new_confidence,
            previous_due_at=prev_due,
            new_due_at=due_at,
            reviewed_at=now,
        )
    )
    await session.commit()
    daily = await _daily_info(session, user_id=user_id, now=now)
    return AnswerResult(
        new_confidence=new_confidence,
        new_status=new_status,
        due_at=due_at,
        done_today=daily.done_today,
    )
```

- [ ] **Step 5: Реализация — schemas + API**

`schemas.py`: `AnswerRequest` →

```python
from pydantic import BaseModel, Field


class AnswerRequest(BaseModel):
    review_item_id: uuid.UUID
    quality: int = Field(ge=0, le=5)
```

`api/review.py`: в эндпоинте `answer` заменить `answer_value=body.answer` на `quality=body.quality`.

- [ ] **Step 6: Прогнать backend-регресс**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run ruff format src/glosano/modules/review/service.py src/glosano/modules/review/schemas.py src/glosano/api/review.py tests/modules/review/test_review_answer.py tests/api/test_review.py && uv run pyright`
Expected: все PASS. Примечание: фронтенд теперь временно несовместим с API (мигрирует в Task 8-9) — vitest это не ломает (моки).

- [ ] **Step 7: Commit**

```bash
git add backend/src/glosano/modules/review/service.py backend/src/glosano/modules/review/schemas.py backend/src/glosano/api/review.py backend/tests/modules/review/test_review_answer.py backend/tests/api/test_review.py
git commit -m "feat(review): answer accepts quality 0..5, confidence mapping + graduation per spec"
```

---

### Task 4: Режимы очереди + `/counts`

**Files:**
- Modify: `backend/src/glosano/modules/review/service.py` (`get_queue` + новые функции)
- Modify: `backend/src/glosano/modules/review/schemas.py` (+ `CountsResponse`)
- Modify: `backend/src/glosano/api/review.py` (queue: параметр mode; + GET /counts)
- Test: Modify `backend/tests/modules/review/test_review_queue.py`, `backend/tests/api/test_review.py`

**Interfaces:**
- Produces:
  - `get_queue(session, *, user_id, language_code, mode: str = "due", lesson_id=None, now=None)` — `mode ∈ {"due","new","practice"}`; `lesson_id` игнорирует mode (остаётся как было).
  - `new`: активные review_items с `last_reviewed_at IS NULL`, оба kind, сортировка `ReviewItem.created_at DESC`, срез `min(NEW_SESSION_LIMIT=20, остаток дневного лимита)`; при исчерпании лимита — пусто + `limit_reached`.
  - `practice`: tracked с `confidence >= 4`, оба kind, `ORDER BY random()`, `LIMIT PRACTICE_SESSION_LIMIT=5`, дневным лимитом не режется, `limit_reached` в ответе всегда False.
  - `get_counts(session, *, user_id, language_code, now=None) -> CountsInfo` — dataclass `{due: int, new: int, practice: int, ai_enabled: bool}` (`ai_enabled` из `get_settings().llm_enabled`).
  - HTTP: `GET /api/review/queue?lang=..&mode=due|new|practice`; `GET /api/review/counts?lang=..` → `{due, new, practice, ai_enabled}`.

- [ ] **Step 1: Написать падающие тесты** — добавить в `test_review_queue.py`:

```python
from glosano.modules.review.service import get_counts


async def test_new_mode_returns_unreviewed_newest_first():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")
        b = await _tracked_token(s, user_id, "dois")
        # отвеченное слово выпадает из режима new
        ri_a = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == a.id)))
            .scalars().one()
        )
        ri_a.last_reviewed_at = NOW
        await s.commit()
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", mode="new", now=NOW
        )
        assert [i.text for i in items] == ["dois"]
        assert not daily.limit_reached


async def test_practice_mode_returns_confident_items_and_ignores_limit():
    async with session_scope() as s:
        user_id = await _make_user(s)
        strong = await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="forte", status="tracked", confidence=4,
        )
        await _tracked_token(s, user_id, "fraco")  # confidence 1 — не попадает
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == strong.id)))
            .scalars().one()
        )
        for _ in range(20):  # дневной лимит исчерпан
            s.add(
                ReviewEvent(
                    review_item_id=ri.id, user_id=user_id, answer_value="correct",
                    previous_confidence=4, new_confidence=4,
                    previous_due_at=NOW, new_due_at=NOW, reviewed_at=NOW,
                )
            )
        await s.commit()
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", mode="practice", now=NOW
        )
        assert [i.text for i in items] == ["forte"]  # лимит не режет practice
        assert daily.limit_reached is False


async def test_counts_reports_due_new_practice():
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _tracked_token(s, user_id, "um")      # due + new
        strong = await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="forte", status="tracked", confidence=4,
        )
        counts = await get_counts(s, user_id=user_id, language_code="pt", now=NOW)
        assert counts.due == 2 and counts.new == 2 and counts.practice == 1
        assert counts.ai_enabled is False  # llm выключен в тестовом окружении
```

И в `tests/api/test_review.py`:

```python
async def test_counts_endpoint():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/counts", params={"lang": "pt"})
        assert r.status_code == 200
        body = r.json()
        assert body["due"] == 1 and body["new"] == 1
        assert body["practice"] == 0 and body["ai_enabled"] is False


async def test_queue_mode_new():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt", "mode": "new"})
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1
```

- [ ] **Step 2: Запустить — падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_queue.py tests/api/test_review.py -v`
Expected: FAIL — `cannot import name 'get_counts'` / `unexpected keyword argument 'mode'`

- [ ] **Step 3: Реализация — service.py**

Добавить константы и dataclass:

```python
NEW_SESSION_LIMIT = 20
PRACTICE_SESSION_LIMIT = 5


@dataclass
class CountsInfo:
    due: int
    new: int
    practice: int
    ai_enabled: bool
```

Импорт: `from glosano.core.config import get_settings`.

В `get_queue` добавить параметр `mode: str = "due"` (после `language_code`) и перед блоком `if daily.limit_reached:` вставить ветки (lesson-ветка выше остаётся первой и не меняется):

```python
    def _mode_stmt(kind: str, model: type[TokenItem] | type[PhraseItem]):
        return (
            select(ReviewItem, model)
            .join(model, ReviewItem.item_id == model.id)
            .where(
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == kind,
                ReviewItem.language_code == language_code,
                ReviewItem.is_active.is_(True),
                model.status == "tracked",
            )
        )

    if mode == "new":
        if daily.limit_reached:
            return [], daily
        fetch = min(NEW_SESSION_LIMIT, max(0, daily.limit - daily.done_today))
        pairs = []
        for kind, model in _VOCAB_MODEL_BY_KIND.items():
            stmt = (
                _mode_stmt(kind, model)
                .where(ReviewItem.last_reviewed_at.is_(None))
                .order_by(ReviewItem.created_at.desc())
                .limit(fetch)
            )
            pairs.extend((ri, it) for ri, it in (await session.execute(stmt)).all())
        pairs.sort(key=lambda p: p[0].created_at, reverse=True)
        pairs = pairs[:fetch]
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily

    if mode == "practice":
        pairs = []
        for kind, model in _VOCAB_MODEL_BY_KIND.items():
            stmt = (
                _mode_stmt(kind, model)
                .where(model.confidence >= 4)
                .order_by(func.random())
                .limit(PRACTICE_SESSION_LIMIT)
            )
            pairs.extend((ri, it) for ri, it in (await session.execute(stmt)).all())
        pairs = pairs[:PRACTICE_SESSION_LIMIT]
        daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily
```

(`_VOCAB_MODEL_BY_KIND` объявлен ниже по файлу — перенести его объявление ВЫШЕ `get_queue`, к константам.) Ветка `due` — существующий код без изменений.

Новая функция:

```python
async def get_counts(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: str,
    now: datetime | None = None,
) -> CountsInfo:
    now = now or datetime.now(UTC)

    async def _count(extra_where) -> int:
        total = 0
        for kind, model in _VOCAB_MODEL_BY_KIND.items():
            stmt = (
                select(func.count())
                .select_from(ReviewItem)
                .join(model, ReviewItem.item_id == model.id)
                .where(
                    ReviewItem.user_id == user_id,
                    ReviewItem.item_kind == kind,
                    ReviewItem.language_code == language_code,
                    ReviewItem.is_active.is_(True),
                    model.status == "tracked",
                    *extra_where(model),
                )
            )
            total += (await session.execute(stmt)).scalar_one()
        return total

    due = await _count(lambda m: [ReviewItem.due_at <= now])
    new = await _count(lambda m: [ReviewItem.last_reviewed_at.is_(None)])
    practice = await _count(lambda m: [m.confidence >= 4])
    return CountsInfo(
        due=due, new=new, practice=practice, ai_enabled=get_settings().llm_enabled
    )
```

- [ ] **Step 4: Реализация — schemas + API**

`schemas.py`:

```python
class CountsResponse(BaseModel):
    due: int
    new: int
    practice: int
    ai_enabled: bool
```

`api/review.py`: в `queue` добавить параметр `mode: Literal["due", "new", "practice"] = "due"` и прокинуть в `service.get_queue(..., mode=mode, ...)`; добавить эндпоинт:

```python
@router.get("/counts", response_model=CountsResponse)
async def counts(
    request: Request,
    lang: LangCode,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CountsResponse:
    user_id = _require_user(request)
    c = await service.get_counts(session, user_id=user_id, language_code=lang)
    return CountsResponse(due=c.due, new=c.new, practice=c.practice, ai_enabled=c.ai_enabled)
```

- [ ] **Step 5: Прогнать регресс, линт/типы**

Run: `cd backend && uv run pytest tests/modules/review/ tests/api/test_review.py -v && uv run ruff check . && uv run ruff format src/glosano/modules/review/service.py src/glosano/modules/review/schemas.py src/glosano/api/review.py tests/modules/review/test_review_queue.py tests/api/test_review.py && uv run pyright`
Expected: все PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/glosano/modules/review/service.py backend/src/glosano/modules/review/schemas.py backend/src/glosano/api/review.py backend/tests/modules/review/test_review_queue.py backend/tests/api/test_review.py
git commit -m "feat(review): queue modes new/practice and counts endpoint"
```

---

### Task 5: Гейтвей — `max_tokens` у провайдера + публичный `write_audit`

**Files:**
- Modify: `backend/src/glosano/modules/ai_translation/provider.py` (Protocol + OpenAICompatibleProvider.complete, ~38-57)
- Modify: `backend/src/glosano/modules/ai_translation/service.py` (переименовать `_write_audit` → `write_audit`, обновить внутренние вызовы)
- Test: Modify существующий тест провайдера (`backend/tests/modules/ai_translation/` — найти файл теста провайдера; если параметр нигде не тестируется, добавить тест в него)

**Interfaces:**
- Produces:
  - `LLMProvider.complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion` — дефолт 100 сохраняет поведение translate-путей байт-в-байт.
  - `glosano.modules.ai_translation.service.write_audit(...)` — публичное имя прежнего `_write_audit` (сигнатура не меняется); потребитель — exercises (Task 6).

- [ ] **Step 1: Найти тесты провайдера**

Run: `cd backend && grep -rln "OpenAICompatibleProvider\|_write_audit" tests/ src/glosano/`
Ожидание: список файлов; во всех местах `_write_audit` — только внутри `ai_translation/service.py`.

- [ ] **Step 2: Написать падающий тест** — в файл тестов провайдера (по факту из Step 1) добавить:

```python
async def test_complete_passes_max_tokens(respx_or_httpx_mock_style_of_this_file):
    """max_tokens прокидывается в payload; дефолт 100 сохраняется."""
    # Использовать стиль мока HTTP, уже принятый в этом файле (httpx.MockTransport
    # или respx). Ассерты:
    #   1) вызов complete(system=..., user=...) шлёт "max_tokens": 100
    #   2) вызов complete(system=..., user=..., max_tokens=800) шлёт "max_tokens": 800
```

Примечание реализатору: это скелет — открой файл тестов провайдера, посмотри, как там мокается httpx, и напиши два ассерта на тело запроса в этом стиле. RED: `TypeError: complete() got an unexpected keyword argument 'max_tokens'`.

- [ ] **Step 3: Реализация**

`provider.py`:

```python
class LLMProvider(Protocol):
    async def complete(
        self, *, system: str, user: str, max_tokens: int = 100
    ) -> LLMCompletion: ...
```

и в `OpenAICompatibleProvider.complete` — сигнатура `async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion:`, в payload `"max_tokens": max_tokens`.

`service.py`: переименовать `_write_audit` → `write_audit` (def + все внутренние вызовы; `git grep _write_audit` после — пусто).

- [ ] **Step 4: Прогнать AI-модуль + полный регресс**

Run: `cd backend && uv run pytest tests/ -k "ai" -v && uv run pytest && uv run ruff check . && uv run ruff format src/glosano/modules/ai_translation/provider.py src/glosano/modules/ai_translation/service.py && uv run pyright`
Expected: все PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/glosano/modules/ai_translation/provider.py backend/src/glosano/modules/ai_translation/service.py backend/tests/modules/ai_translation
git commit -m "refactor(ai): provider max_tokens param, public write_audit for reuse"
```

---

### Task 6: Сервис упражнений (`exercises.py` + промпты)

**Files:**
- Create: `backend/src/glosano/modules/review/exercise_prompts.py`
- Create: `backend/src/glosano/modules/review/exercises.py`
- Test: `backend/tests/modules/review/test_exercises.py`

**Interfaces:**
- Consumes: `LLMProvider` (+max_tokens), `write_audit`, `AIDisabled` (ai_translation); `ReviewItem`, `_VOCAB_MODEL_BY_KIND`, `PersonalTranslation`, `PersonalNote`, `UserSettings`.
- Produces (в `glosano.modules.review.exercises`):

```python
class ExerciseParseError(Exception): ...   # непарсибельный/невалидный JSON после ретрая

@dataclass(frozen=True)
class ExerciseResult:
    payload: dict     # структура по kind (см. spec §5)
    model: str
    latency_ms: int

async def generate_exercise(
    session, *, user_id: uuid.UUID, kind: str,
    review_item_id: uuid.UUID | None = None,
    review_item_ids: list[uuid.UUID] | None = None,   # только для kind='writing'
    provider: LLMProvider | None = None, now=None,
) -> ExerciseResult   # ReviewItemNotFound на чужой/несуществующий item; AIDisabled при выключенном LLM

async def translation_feedback(
    session, *, user_id, review_item_id, sentence_translation: str, user_text: str,
    provider: LLMProvider | None = None,
) -> ExerciseResult   # payload = {"feedback": str}
```

- Валидация payload по kind (обязательные ключи; для cloze/reverse — ровно 4 options и ровно один `is_correct=true`); невалидно → один ретрай → `ExerciseParseError`.
- max_tokens по kind: example 500, cloze 600, reverse 600, translation_task 300, writing 1200, feedback 500.

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/modules/review/test_exercises.py
"""generate_exercise/translation_feedback: fake-провайдер, парсинг, ретрай, ownership."""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.ai_translation.provider import LLMCompletion
from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.exercises import (
    ExerciseParseError,
    generate_exercise,
    translation_feedback,
)
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.review.service import ReviewItemNotFound
from glosano.modules.vocabulary import service as vocab
from glosano.modules.vocabulary.models import PersonalTranslation, TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


class FakeProvider:
    def __init__(self, texts: list[str]):
        self.texts = list(texts)
        self.calls: list[dict] = []

    async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion:
        self.calls.append({"system": system, "user": user, "max_tokens": max_tokens})
        return LLMCompletion(text=self.texts.pop(0), input_tokens=10, output_tokens=20)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    return user.id


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (ReviewEvent, ReviewItem, PersonalTranslation, TokenItem):
            await s.execute(delete(model))


async def _setup_item(s: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """Вернуть (user_id, review_item_id) для tracked-слова с переводом."""
    user_id = await _make_user(s)
    item = await vocab.create_item(
        s, user_id=user_id, kind="token", language_code="pt",
        text="cada", status="tracked", confidence=1,
    )
    await vocab.add_translation(
        s, user_id=user_id, kind="token", item_id=item.id,
        target_language_code="ru", translation_text="каждый", source_type="user",
    )
    ri = (
        (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
        .scalars().one()
    )
    return user_id, ri.id


EXAMPLE_JSON = json.dumps(
    {
        "sentence": "Cada dia é único.",
        "sentence_translation": "Каждый день уникален.",
        "base_form": "cada",
        "base_form_translation": "каждый",
    }
)

CLOZE_JSON = json.dumps(
    {
        "sentence_with_gap": "___ dia é único.",
        "sentence_translation": "Каждый день уникален.",
        "options": [
            {"text": "Cada", "is_correct": True},
            {"text": "Todo", "is_correct": False},
            {"text": "Muito", "is_correct": False},
            {"text": "Pouco", "is_correct": False},
        ],
    }
)


async def test_example_exercise_happy_path(monkeypatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    from glosano.core.config import get_settings

    get_settings.cache_clear()
    try:
        provider = FakeProvider([EXAMPLE_JSON])
        async with session_scope() as s:
            user_id, ri_id = await _setup_item(s)
            res = await generate_exercise(
                s, user_id=user_id, kind="example", review_item_id=ri_id, provider=provider
            )
        assert res.payload["sentence"] == "Cada dia é único."
        assert provider.calls[0]["max_tokens"] == 500
        # слово и его перевод попали в промпт
        assert "cada" in provider.calls[0]["user"] and "каждый" in provider.calls[0]["user"]
    finally:
        get_settings.cache_clear()


async def test_cloze_validates_options_and_retries_once(monkeypatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    from glosano.core.config import get_settings

    get_settings.cache_clear()
    try:
        # первый ответ — мусор, второй — валидный: должен получиться ретрай
        provider = FakeProvider(["oops not json", CLOZE_JSON])
        async with session_scope() as s:
            user_id, ri_id = await _setup_item(s)
            res = await generate_exercise(
                s, user_id=user_id, kind="cloze", review_item_id=ri_id, provider=provider
            )
        assert len(res.payload["options"]) == 4
        assert len(provider.calls) == 2
    finally:
        get_settings.cache_clear()


async def test_two_bad_responses_raise_parse_error(monkeypatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    from glosano.core.config import get_settings

    get_settings.cache_clear()
    try:
        provider = FakeProvider(["garbage", '{"options": []}'])
        async with session_scope() as s:
            user_id, ri_id = await _setup_item(s)
            with pytest.raises(ExerciseParseError):
                await generate_exercise(
                    s, user_id=user_id, kind="cloze", review_item_id=ri_id, provider=provider
                )
    finally:
        get_settings.cache_clear()


async def test_ai_disabled_raises():
    from glosano.modules.ai_translation.service import AIDisabled

    provider = FakeProvider([EXAMPLE_JSON])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        with pytest.raises(AIDisabled):  # GLOSANO_LLM_ENABLED=false в тестовом окружении
            await generate_exercise(
                s, user_id=user_id, kind="example", review_item_id=ri_id, provider=provider
            )


async def test_foreign_item_raises(monkeypatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    from glosano.core.config import get_settings

    get_settings.cache_clear()
    try:
        provider = FakeProvider([EXAMPLE_JSON])
        async with session_scope() as s:
            _, ri_id = await _setup_item(s)
            stranger = await _make_user(s)
            with pytest.raises(ReviewItemNotFound):
                await generate_exercise(
                    s, user_id=stranger, kind="example", review_item_id=ri_id, provider=provider
                )
    finally:
        get_settings.cache_clear()


async def test_feedback_happy_path(monkeypatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    from glosano.core.config import get_settings

    get_settings.cache_clear()
    try:
        provider = FakeProvider([json.dumps({"feedback": "Хорошо. Опечатка в слове dia."})])
        async with session_scope() as s:
            user_id, ri_id = await _setup_item(s)
            res = await translation_feedback(
                s, user_id=user_id, review_item_id=ri_id,
                sentence_translation="Каждый день уникален.",
                user_text="Cada dia e unico.",
                provider=provider,
            )
        assert "Опечатка" in res.payload["feedback"]
    finally:
        get_settings.cache_clear()


async def test_writing_exercise_needs_items(monkeypatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    from glosano.core.config import get_settings

    get_settings.cache_clear()
    try:
        provider = FakeProvider([json.dumps({"text": "1. ___ dia...\nОтветы: 1. Cada"})])
        async with session_scope() as s:
            user_id, ri_id = await _setup_item(s)
            res = await generate_exercise(
                s, user_id=user_id, kind="writing", review_item_ids=[ri_id], provider=provider
            )
        assert "Ответы" in res.payload["text"]
        assert provider.calls[0]["max_tokens"] == 1200
    finally:
        get_settings.cache_clear()
```

- [ ] **Step 2: Запустить — падают**

Run: `cd backend && uv run pytest tests/modules/review/test_exercises.py -v`
Expected: FAIL — `ModuleNotFoundError: glosano.modules.review.exercises`

- [ ] **Step 3: Реализация — exercise_prompts.py**

```python
# backend/src/glosano/modules/review/exercise_prompts.py
"""Промпты и парсинг AI-упражнений (FLQ-20). Чистые функции, без I/O.

Обобщение промптов личного CLI-тренажёра: языки берутся из настроек
пользователя, JSON запрашивается прямо в промпте, парсится extract_json.
"""

from __future__ import annotations

import json
from typing import Any

from glosano.modules.ai_translation.prompts import LANGUAGE_NAMES

SYSTEM_PROMPT = (
    "You are a language tutor inside a vocabulary trainer. "
    "Always reply with a single JSON object exactly matching the requested schema. "
    "No prose outside JSON, no markdown fences."
)

MAX_TOKENS_BY_KIND: dict[str, int] = {
    "example": 500,
    "cloze": 600,
    "reverse": 600,
    "translation_task": 300,
    "writing": 1200,
    "feedback": 500,
}


def _lang(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def _word_block(word: str, translation: str | None, notes: str | None) -> str:
    parts = [f"Word: {word}"]
    if translation:
        parts.append(f"Meaning (user's own translation): {translation}")
    if notes:
        parts.append(f"User notes: {notes}")
    return "\n".join(parts)


def build_example_prompt(
    *, word: str, translation: str | None, notes: str | None,
    learn_lang: str, target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one short {_lang(learn_lang)} sentence (level B1) using the word "
        f"in this exact meaning and the same form. "
        f"Translate the sentence into {_lang(target_lang)}. "
        f"Also give the base form of the word (infinitive / singular) with its "
        f"{_lang(target_lang)} translation.\n"
        'JSON schema: {"sentence": str, "sentence_translation": str, '
        '"base_form": str, "base_form_translation": str}'
    )


def build_cloze_prompt(
    *, word: str, translation: str | None, notes: str | None,
    learn_lang: str, target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one short {_lang(learn_lang)} sentence (level B1) where this word is "
        f"replaced by a gap '___'. Translate the full sentence (no gap) into "
        f"{_lang(target_lang)}. Give 4 answer options in {_lang(learn_lang)}: the "
        f"correct word (in the form fitting the gap) and 3 plausible distractors.\n"
        'JSON schema: {"sentence_with_gap": str, "sentence_translation": str, '
        '"options": [{"text": str, "is_correct": bool} x4, exactly one is_correct=true]}'
    )


def build_reverse_prompt(
    *, word: str, translation: str | None, notes: str | None,
    learn_lang: str, target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one short {_lang(learn_lang)} example sentence with this word. "
        f"Give 4 {_lang(target_lang)} translation options for the word itself: "
        f"the correct one and 3 plausible distractors (synonyms, same topic, "
        f"similar-sounding).\n"
        'JSON schema: {"sentence": str, '
        '"options": [{"text": str, "is_correct": bool} x4, exactly one is_correct=true]}'
    )


def build_translation_task_prompt(
    *, word: str, translation: str | None, notes: str | None,
    learn_lang: str, target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one {_lang(target_lang)} sentence (level A2/B1) whose "
        f"{_lang(learn_lang)} translation naturally uses this word. "
        f"Return only the {_lang(target_lang)} sentence.\n"
        'JSON schema: {"sentence_translation": str}'
    )


def build_writing_prompt(
    *, pairs: list[tuple[str, str | None]], learn_lang: str, target_lang: str
) -> str:
    words = "\n".join(f"- {w} — {t or '(no translation saved)'}" for w, t in pairs)
    return (
        f"The learner struggled with these {_lang(learn_lang)} words:\n{words}\n"
        f"For each word write one {_lang(learn_lang)} sentence with the word replaced "
        f"by a gap '___' (change the word form where natural), followed by its "
        f"{_lang(target_lang)} translation. After all sentences add an 'Answers' "
        f"section listing the correct forms. Plain text, numbered.\n"
        'JSON schema: {"text": str}'
    )


def build_feedback_prompt(
    *, word: str, sentence_translation: str, user_text: str,
    learn_lang: str, target_lang: str,
) -> str:
    return (
        f"A learner translated this {_lang(target_lang)} sentence into "
        f"{_lang(learn_lang)}:\n"
        f"Sentence: {sentence_translation}\n"
        f"Learner's translation: {user_text}\n"
        f"The sentence practices the word: {word}\n"
        f"Grade the translation (плохо / нормально / хорошо / отлично), point out "
        f"every inaccuracy briefly (missing diacritics and misspellings count), "
        f"and give a correct reference translation. Answer in Russian.\n"
        'JSON schema: {"feedback": str}'
    )


def extract_json(text: str) -> dict[str, Any]:
    """Первая '{' … последняя '}' → json.loads. ValueError, если структуры нет."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in response")
    return json.loads(text[start : end + 1])


_REQUIRED_KEYS: dict[str, set[str]] = {
    "example": {"sentence", "sentence_translation", "base_form", "base_form_translation"},
    "cloze": {"sentence_with_gap", "sentence_translation", "options"},
    "reverse": {"sentence", "options"},
    "translation_task": {"sentence_translation"},
    "writing": {"text"},
    "feedback": {"feedback"},
}


def validate_payload(kind: str, payload: dict[str, Any]) -> None:
    """ValueError при отсутствии ключей / неверных options."""
    missing = _REQUIRED_KEYS[kind] - payload.keys()
    if missing:
        raise ValueError(f"missing keys: {sorted(missing)}")
    if kind in ("cloze", "reverse"):
        options = payload["options"]
        if not isinstance(options, list) or len(options) != 4:
            raise ValueError("options must contain exactly 4 items")
        correct = [o for o in options if isinstance(o, dict) and o.get("is_correct") is True]
        if len(correct) != 1:
            raise ValueError("options must contain exactly one correct answer")
```

- [ ] **Step 4: Реализация — exercises.py**

```python
# backend/src/glosano/modules/review/exercises.py
"""AI-генерация упражнений тренажёра (FLQ-20). Session-first module functions.

Паттерн FLQ-3: kill-switch AIDisabled -> провайдер -> extract_json (+1 ретрай)
-> audit write_audit (best-effort, сырой текст не логируется — ADR-0003).
"""

from __future__ import annotations

import hashlib
import random
import time
import uuid
from dataclasses import dataclass
from datetime import datetime

from loguru import logger
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.modules.ai_translation.provider import LLMProvider, OpenAICompatibleProvider
from glosano.modules.ai_translation.service import AIDisabled, write_audit
from glosano.modules.identity.models import UserSettings
from glosano.modules.review import exercise_prompts as ep
from glosano.modules.review.models import ReviewItem
from glosano.modules.review.service import _VOCAB_MODEL_BY_KIND, ReviewItemNotFound
from glosano.modules.vocabulary.models import PersonalNote, PersonalTranslation


class ExerciseParseError(Exception):  # noqa: N818 -- matches ai_translation naming
    """Провайдер ответил, но валидного JSON нет и после ретрая."""


@dataclass(frozen=True)
class ExerciseResult:
    payload: dict  # type: ignore[type-arg]
    model: str
    latency_ms: int


@dataclass(frozen=True)
class _ItemContext:
    word: str
    translation: str | None
    notes: str | None
    learn_lang: str
    target_lang: str


async def _load_context(
    session: AsyncSession, *, user_id: uuid.UUID, review_item_id: uuid.UUID
) -> _ItemContext:
    ri = await session.get(ReviewItem, review_item_id)
    if ri is None or ri.user_id != user_id or not ri.is_active:
        raise ReviewItemNotFound(str(review_item_id))
    item = await session.get(_VOCAB_MODEL_BY_KIND[ri.item_kind], ri.item_id)
    if item is None or item.user_id != user_id:
        raise ReviewItemNotFound(str(review_item_id))
    settings_row = await session.get(UserSettings, user_id)
    target = (
        settings_row.preferred_translation_language_code if settings_row is not None else "en"
    )
    key = (ri.item_kind, ri.item_id)
    translation_row = (
        (
            await session.execute(
                select(PersonalTranslation).where(
                    PersonalTranslation.owner_user_id == user_id,
                    PersonalTranslation.is_primary.is_(True),
                    tuple_(
                        PersonalTranslation.item_kind, PersonalTranslation.item_id
                    ).in_([key]),
                )
            )
        )
        .scalars()
        .first()
    )
    note_row = (
        (
            await session.execute(
                select(PersonalNote).where(
                    PersonalNote.owner_user_id == user_id,
                    tuple_(PersonalNote.item_kind, PersonalNote.item_id).in_([key]),
                )
            )
        )
        .scalars()
        .first()
    )
    word = item.token_text if hasattr(item, "token_text") else item.display_text
    return _ItemContext(
        word=word,
        translation=translation_row.translation_text if translation_row else None,
        notes=note_row.note_text if note_row else None,
        learn_lang=ri.language_code,
        target_lang=target,
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _call_llm(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    user_prompt: str,
    subject_text: str,
    provider: LLMProvider | None,
) -> ExerciseResult:
    """Общий путь: kill-switch -> провайдер -> parse+validate (+1 ретрай) -> audit."""
    settings = get_settings()
    if not settings.llm_enabled:
        raise AIDisabled
    provider = provider or OpenAICompatibleProvider(settings)
    max_tokens = ep.MAX_TOKENS_BY_KIND[kind]
    prompt_hash = _sha256(ep.SYSTEM_PROMPT + "\n" + user_prompt)
    subject_hash = _sha256(subject_text)
    request_id = uuid.uuid4()
    started = time.monotonic()

    async def _audit(success: bool, error_code: str | None, completion=None) -> None:
        await write_audit(
            session,
            request_id=request_id,
            user_id=user_id,
            lesson_id=None,
            settings=settings,
            prompt_hash=prompt_hash,
            selected_text_hash=subject_hash,
            started=started,
            success=success,
            error_code=error_code,
            input_tokens=completion.input_tokens if completion else None,
            output_tokens=completion.output_tokens if completion else None,
        )

    last_error: Exception | None = None
    completion = None
    for attempt in range(2):  # исходный вызов + один ретрай на плохой JSON
        try:
            completion = await provider.complete(
                system=ep.SYSTEM_PROMPT, user=user_prompt, max_tokens=max_tokens
            )
        except Exception as exc:  # ProviderUnavailable/Rejected — наружу с аудитом
            await _audit(False, type(exc).__name__.lower())
            raise
        try:
            payload = ep.extract_json(completion.text)
            ep.validate_payload(kind, payload)
        except ValueError as exc:
            last_error = exc
            logger.warning(
                "exercise parse failed (kind={}, attempt={}/2)", kind, attempt + 1
            )
            continue
        await _audit(True, None, completion)
        return ExerciseResult(
            payload=payload,
            model=settings.llm_model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    await _audit(False, "exercise_parse_error", completion)
    raise ExerciseParseError(str(last_error))


async def generate_exercise(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    review_item_id: uuid.UUID | None = None,
    review_item_ids: list[uuid.UUID] | None = None,
    provider: LLMProvider | None = None,
    now: datetime | None = None,
) -> ExerciseResult:
    if kind == "writing":
        assert review_item_ids  # непустой список валидируется на API-слое
        pairs: list[tuple[str, str | None]] = []
        learn_lang = target_lang = None
        for rid in review_item_ids:
            ctx = await _load_context(session, user_id=user_id, review_item_id=rid)
            pairs.append((ctx.word, ctx.translation))
            learn_lang, target_lang = ctx.learn_lang, ctx.target_lang
        assert learn_lang is not None and target_lang is not None
        prompt = ep.build_writing_prompt(
            pairs=pairs, learn_lang=learn_lang, target_lang=target_lang
        )
        subject = ",".join(w for w, _ in pairs)
    else:
        assert review_item_id is not None  # валидируется на API-слое
        ctx = await _load_context(session, user_id=user_id, review_item_id=review_item_id)
        builders = {
            "example": ep.build_example_prompt,
            "cloze": ep.build_cloze_prompt,
            "reverse": ep.build_reverse_prompt,
            "translation_task": ep.build_translation_task_prompt,
        }
        prompt = builders[kind](
            word=ctx.word,
            translation=ctx.translation,
            notes=ctx.notes,
            learn_lang=ctx.learn_lang,
            target_lang=ctx.target_lang,
        )
        subject = ctx.word
    result = await _call_llm(
        session,
        user_id=user_id,
        kind=kind,
        user_prompt=prompt,
        subject_text=subject,
        provider=provider,
    )
    if kind in ("cloze", "reverse"):
        options = list(result.payload["options"])
        random.shuffle(options)  # порядок вариантов не должен выдавать ответ
        return ExerciseResult(
            payload={**result.payload, "options": options},
            model=result.model,
            latency_ms=result.latency_ms,
        )
    return result


async def translation_feedback(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    review_item_id: uuid.UUID,
    sentence_translation: str,
    user_text: str,
    provider: LLMProvider | None = None,
) -> ExerciseResult:
    ctx = await _load_context(session, user_id=user_id, review_item_id=review_item_id)
    prompt = ep.build_feedback_prompt(
        word=ctx.word,
        sentence_translation=sentence_translation,
        user_text=user_text,
        learn_lang=ctx.learn_lang,
        target_lang=ctx.target_lang,
    )
    return await _call_llm(
        session,
        user_id=user_id,
        kind="feedback",
        user_prompt=prompt,
        subject_text=ctx.word,
        provider=provider,
    )
```

Примечание: `random.shuffle` в модуле сервиса допустим (это не workflow-скрипт). `_VOCAB_MODEL_BY_KIND` импортируется из service.py — если pyright ругнётся на приватный импорт, переименовать в `VOCAB_MODEL_BY_KIND` в service.py и обновить оба места.

- [ ] **Step 5: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/test_exercises.py -v && uv run ruff check . && uv run ruff format src/glosano/modules/review/exercises.py src/glosano/modules/review/exercise_prompts.py tests/modules/review/test_exercises.py && uv run pyright`
Expected: 8 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/glosano/modules/review/exercises.py backend/src/glosano/modules/review/exercise_prompts.py backend/tests/modules/review/test_exercises.py
git commit -m "feat(review): AI exercise generation service (example/cloze/reverse/translation/writing/feedback)"
```

---

### Task 7: API упражнений

**Files:**
- Modify: `backend/src/glosano/modules/review/schemas.py` (+ Exercise/Feedback схемы)
- Modify: `backend/src/glosano/api/review.py` (+ 2 эндпоинта)
- Test: Modify `backend/tests/api/test_review.py`

**Interfaces:**
- Produces HTTP (потребляется frontend'ом):
  - `POST /api/review/exercise` `{"kind": "example|cloze|reverse|translation_task", "review_item_id": uuid}` либо `{"kind": "writing", "review_item_ids": [uuid, ...]}` → `{"payload": {...}, "model": str, "latency_ms": int}`; 503 `ai_disabled`; 502 `ai_provider_error`/`exercise_parse_error`; 404 чужой item; 422 при несоответствии kind↔id-полей.
  - `POST /api/review/exercise/feedback` `{"review_item_id", "sentence_translation", "user_text"}` → `{"feedback": str}`.

- [ ] **Step 1: Написать падающие тесты** — добавить в `tests/api/test_review.py`:

```python
async def test_exercise_returns_503_when_ai_disabled():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/exercise",
            headers={"X-CSRF-Token": csrf},
            json={"kind": "example", "review_item_id": review_item_id},
        )
        assert r.status_code == 503
        assert r.json()["detail"] == "ai_disabled"


async def test_exercise_validation_422():
    async with await _client() as c:
        csrf = await _register(c)
        # writing без review_item_ids
        r = await c.post(
            "/api/review/exercise",
            headers={"X-CSRF-Token": csrf},
            json={"kind": "writing"},
        )
        assert r.status_code == 422
        # example без review_item_id
        r = await c.post(
            "/api/review/exercise",
            headers={"X-CSRF-Token": csrf},
            json={"kind": "example"},
        )
        assert r.status_code == 422


async def test_feedback_returns_503_when_ai_disabled():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/exercise/feedback",
            headers={"X-CSRF-Token": csrf},
            json={
                "review_item_id": review_item_id,
                "sentence_translation": "Каждый день уникален.",
                "user_text": "Cada dia e unico.",
            },
        )
        assert r.status_code == 503
```

(Позитивные пути с fake-провайдером покрыты сервис-тестами Task 6; API-слой в тестовом окружении с выключенным LLM проверяет коды и валидацию.)

- [ ] **Step 2: Запустить — падают** (404 на неизвестные роуты)

Run: `cd backend && uv run pytest tests/api/test_review.py -v`

- [ ] **Step 3: Реализация — schemas.py**

```python
from pydantic import model_validator


class ExerciseRequest(BaseModel):
    kind: Literal["example", "cloze", "reverse", "translation_task", "writing"]
    review_item_id: uuid.UUID | None = None
    review_item_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _check_ids(self) -> "ExerciseRequest":
        if self.kind == "writing":
            if not self.review_item_ids:
                raise ValueError("writing requires review_item_ids")
        elif self.review_item_id is None:
            raise ValueError(f"{self.kind} requires review_item_id")
        return self


class ExerciseResponse(BaseModel):
    payload: dict  # структура зависит от kind (spec §5); валидирована сервисом
    model: str
    latency_ms: int


class FeedbackRequest(BaseModel):
    review_item_id: uuid.UUID
    sentence_translation: str = Field(min_length=1, max_length=500)
    user_text: str = Field(min_length=1, max_length=1000)


class FeedbackResponse(BaseModel):
    feedback: str
```

- [ ] **Step 4: Реализация — api/review.py**

```python
from glosano.modules.ai_translation.provider import ProviderRejected, ProviderUnavailable
from glosano.modules.ai_translation.service import AIDisabled
from glosano.modules.review import exercises
from glosano.modules.review.schemas import (
    ExerciseRequest,
    ExerciseResponse,
    FeedbackRequest,
    FeedbackResponse,
)


@router.post("/exercise", response_model=ExerciseResponse)
async def exercise(
    request: Request,
    body: ExerciseRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ExerciseResponse:
    user_id = _require_user(request)
    try:
        res = await exercises.generate_exercise(
            session,
            user_id=user_id,
            kind=body.kind,
            review_item_id=body.review_item_id,
            review_item_ids=body.review_item_ids,
        )
    except AIDisabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="ai_disabled") from None
    except (ProviderUnavailable, ProviderRejected):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ai_provider_error") from None
    except exercises.ExerciseParseError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="exercise_parse_error") from None
    except service.ReviewItemNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return ExerciseResponse(payload=res.payload, model=res.model, latency_ms=res.latency_ms)


@router.post("/exercise/feedback", response_model=FeedbackResponse)
async def exercise_feedback(
    request: Request,
    body: FeedbackRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FeedbackResponse:
    user_id = _require_user(request)
    try:
        res = await exercises.translation_feedback(
            session,
            user_id=user_id,
            review_item_id=body.review_item_id,
            sentence_translation=body.sentence_translation,
            user_text=body.user_text,
        )
    except AIDisabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="ai_disabled") from None
    except (ProviderUnavailable, ProviderRejected):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ai_provider_error") from None
    except exercises.ExerciseParseError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="exercise_parse_error") from None
    except service.ReviewItemNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return FeedbackResponse(feedback=str(res.payload["feedback"]))
```

- [ ] **Step 5: Полный backend-регресс + коммит**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run ruff format src/glosano/modules/review/schemas.py src/glosano/api/review.py tests/api/test_review.py && uv run pyright`

```bash
git add backend/src/glosano/modules/review/schemas.py backend/src/glosano/api/review.py backend/tests/api/test_review.py
git commit -m "feat(review): exercise + feedback endpoints"
```

---

### Task 8: Frontend — api/review.ts + GradeBar

**Files:**
- Modify: `frontend/src/api/review.ts` (quality, counts, exercise, feedback)
- Create: `frontend/src/features/review/GradeBar.tsx`
- Test: `frontend/src/features/review/GradeBar.test.tsx`

**Interfaces:**
- Produces:

```ts
// api/review.ts — дополнения (существующие типы queue не меняются):
answer: (reviewItemId: string, quality: number) => Promise<ReviewAnswerResponse>  // body {review_item_id, quality}
counts: (lang: string) => Promise<ReviewCounts>   // GET /api/review/counts
exercise: (body: ExerciseRequestBody) => Promise<ExerciseResponse>       // POST /api/review/exercise
exerciseFeedback: (body: FeedbackRequestBody) => Promise<{ feedback: string }>
export type ReviewMode = 'cards' | 'new' | 'cloze' | 'reverse' | 'translation'
export interface ReviewCounts { due: number; new: number; practice: number; ai_enabled: boolean }
export interface ExerciseOption { text: string; is_correct: boolean }
export interface ExampleExercise { sentence: string; sentence_translation: string; base_form: string; base_form_translation: string }
export interface ClozeExercise { sentence_with_gap: string; sentence_translation: string; options: ExerciseOption[] }
export interface ReverseExercise { sentence: string; options: ExerciseOption[] }
```

- `<GradeBar onGrade={(q: number) => void} disabled={boolean} />` — 6 кнопок `0`..`5` с подписями (title/aria-label полные, на кнопке цифра + короткая подпись), клик → `onGrade(q)`. Хоткеи НЕ здесь (в сессионном хуке Task 9).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// frontend/src/features/review/GradeBar.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GradeBar } from './GradeBar'

describe('GradeBar', () => {
  it('renders six grade buttons and reports clicks', () => {
    const onGrade = vi.fn()
    render(<GradeBar onGrade={onGrade} disabled={false} />)
    const btn5 = screen.getByRole('button', { name: /5.*Идеально/ })
    fireEvent.click(btn5)
    expect(onGrade).toHaveBeenCalledWith(5)
    fireEvent.click(screen.getByRole('button', { name: /0.*Полный провал/ }))
    expect(onGrade).toHaveBeenCalledWith(0)
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  it('disables all buttons while answering', () => {
    const onGrade = vi.fn()
    render(<GradeBar onGrade={onGrade} disabled />)
    const btn = screen.getByRole('button', { name: /3.*С трудом/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onGrade).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Запустить — падают**

Run: `cd frontend && pnpm exec vitest run src/features/review/GradeBar.test.tsx`

- [ ] **Step 3: Реализация — GradeBar.tsx**

```tsx
// frontend/src/features/review/GradeBar.tsx
export const GRADE_LABELS: Record<number, string> = {
  5: 'Идеально',
  4: 'С заминкой',
  3: 'С трудом',
  2: 'Ошибка, легко вспомнил',
  1: 'Ошибка, вспомнил',
  0: 'Полный провал',
}

interface Props {
  onGrade: (quality: number) => void
  disabled: boolean
}

export function GradeBar({ onGrade, disabled }: Props) {
  return (
    <div className="mt-6 grid grid-cols-6 gap-2">
      {[0, 1, 2, 3, 4, 5].map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(q)}
          aria-label={`${q} — ${GRADE_LABELS[q]}`}
          title={GRADE_LABELS[q]}
          className="flex flex-col items-center rounded-md border border-border py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <span className="text-base font-medium">{q}</span>
          <span className="mt-0.5 hidden text-[10px] leading-tight text-muted-foreground sm:block">
            {GRADE_LABELS[q].split(',')[0]}
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Реализация — api/review.ts** (дополнить существующий файл):

```ts
export type ReviewMode = 'cards' | 'new' | 'cloze' | 'reverse' | 'translation'

export interface ReviewCounts {
  due: number
  new: number
  practice: number
  ai_enabled: boolean
}

export interface ExerciseOption {
  text: string
  is_correct: boolean
}

export interface ExampleExercise {
  sentence: string
  sentence_translation: string
  base_form: string
  base_form_translation: string
}

export interface ClozeExercise {
  sentence_with_gap: string
  sentence_translation: string
  options: ExerciseOption[]
}

export interface ReverseExercise {
  sentence: string
  options: ExerciseOption[]
}

export interface ExerciseResponse<P> {
  payload: P
  model: string
  latency_ms: number
}
```

В объекте `reviewApi`:
- `queue: (lang, lessonId?, mode?)` — добавить третий параметр, `if (mode) q.set('mode', mode)` (серверные mode: `'due' | 'new' | 'practice'`);
- `answer: (reviewItemId: string, quality: number)` — body `{ review_item_id: reviewItemId, quality }`;
- добавить:

```ts
  counts: (lang: string) => api<ReviewCounts>(`/api/review/counts?lang=${lang}`),
  exercise: <P>(body: {
    kind: 'example' | 'cloze' | 'reverse' | 'translation_task' | 'writing'
    review_item_id?: string
    review_item_ids?: string[]
  }) =>
    api<ExerciseResponse<P>>('/api/review/exercise', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  exerciseFeedback: (body: {
    review_item_id: string
    sentence_translation: string
    user_text: string
  }) =>
    api<{ feedback: string }>('/api/review/exercise/feedback', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
```

- [ ] **Step 5: Прогнать + коммит**

Run: `cd frontend && pnpm exec vitest run src/features/review/GradeBar.test.tsx && pnpm exec tsc -b`
Expected: 2 PASS; tsc УПАДЁТ на ReviewPage (answer теперь quality) — это ожидаемо до Task 9? НЕТ: плану нужен зелёный tsc на каждом коммите. Поэтому в ЭТОМ таске также заменить в `ReviewPage.tsx` минимально: `reviewApi.answer(id, a)` → `reviewApi.answer(id, a === 'correct' ? 4 : 2)` (временный шим до Task 9, поведение UI неизменно; тест ReviewPage `toHaveBeenCalledWith('R1', 'correct')` поправить на `('R1', 4)`).

Run: `cd frontend && pnpm exec vitest run src/features/review && pnpm exec tsc -b`
Expected: все PASS, tsc чисто.

```bash
git add frontend/src/api/review.ts frontend/src/features/review/GradeBar.tsx frontend/src/features/review/GradeBar.test.tsx frontend/src/features/review/ReviewPage.tsx frontend/src/features/review/ReviewPage.test.tsx
git commit -m "feat(review-ui): quality answer api, counts/exercise clients, GradeBar"
```

---

### Task 9: Frontend — useReviewSession, режим cards на GradeBar, экран выбора режима

**Files:**
- Create: `frontend/src/features/review/useReviewSession.ts`
- Create: `frontend/src/features/review/ModeSelect.tsx`
- Modify: `frontend/src/features/review/ReviewPage.tsx` (переписать: роутер режимов + cards-сессия на хук)
- Modify: `frontend/src/features/review/ReviewCard.tsx` (убрать кнопки ✗/✓; GradeBar рендерит сессия)
- Modify: `frontend/src/routes/learn.$lang.review.tsx` (`?mode=`)
- Test: Modify `frontend/src/features/review/ReviewPage.test.tsx`, `ReviewCard.test.tsx`; Create `ModeSelect.test.tsx`

**Interfaces:**
- Produces:

```ts
// useReviewSession.ts
export interface ReviewSessionResult {
  status: 'loading' | 'error' | 'empty' | 'limit' | 'active' | 'done'
  daily: ReviewDaily | undefined
  current: ReviewQueueItem | undefined
  idx: number
  total: number
  results: { item: ReviewQueueItem; quality: number }[]  // накопленные ответы сессии
  answering: boolean
  answerError: string | null
  graduated: boolean                       // показать тост
  dismissGraduation: () => void
  grade: (quality: number) => void         // POST answer + переход к следующей
  skip: () => void                         // пропустить карточку БЕЗ события
  restart: () => void
  retryQueue: () => void
}
export function useReviewSession(
  lang: string,
  opts: { serverMode: 'due' | 'new' | 'practice'; lessonId?: string },
): ReviewSessionResult
```

Хук вбирает текущую логику ReviewPage: queue-запрос (`['review-queue', lang, serverMode, lessonId ?? null]`, staleTime Infinity, gcTime 0), freshness-гейт сидинга (`seededAtRef`/`dataUpdatedAt` — сохранить как есть), мутацию ответа (`reviewApi.answer(id, quality)`), инвалидации `['reader-statuses']`/`['vocab-list']`/`['phrases']` при завершении и в restart, graduation-состояние. Хоткеи НЕ в хуке (разные по режимам — в компонентах сессий).

- `<ModeSelect lang={string} />` — плитки: Карточки (due) / Новые слова (new) / Квиз: пропуск (due) / Квиз: перевод (due) / Практика перевода (practice); счётчики из `reviewApi.counts`; при `ai_enabled: false` плитки new/cloze/reverse/translation задизейблены с подписью «AI отключён»; клик → navigate search `{mode}`.
- `ReviewPage`: `lessonId` → cards-сессия (lesson); `?mode=` отсутствует → `<ModeSelect>`; `mode='cards'` → cards-сессия; остальные режимы — заглушки «Скоро» до Tasks 10-12 (плитки уже ведут, но компоненты добавляются следующими тасками; заглушка = `<p>Режим в разработке</p>` с кнопкой назад — она ЗАМЕНЯЕТСЯ в Tasks 10-12).
- Cards-сессия: flip как раньше (Space), после переворота GradeBar + хоткеи 0..5; финальный экран: статистика (среднее качество, count по q<3/q≥3), список слов с q<4, restart.

- [ ] **Step 1: Обновить тесты**

`ReviewCard.test.tsx`: удалить тест `back shows ... answer buttons` про ✗/✓-клики; оборот теперь без кнопок (их рендерит сессия) — заменить ассерты: перевод и заметки видны, кнопок ответа нет (`screen.queryByRole('button', { name: '✗ Ошибка' })` → null).

`ReviewPage.test.tsx`: адаптировать:
- рендер-helper получает `mode`: `renderPage({ lessonId, mode })`, компонент `<ReviewPage lang="pt" lessonId={lessonId} mode={mode} />`;
- тесты состояний очереди — с `mode="cards"`;
- session-flow: flip → клик по GradeBar `5` → `expect(reviewApi.answer).toHaveBeenCalledWith('R1', 5)`;
- хоткей-тест: Space → flip; keydown `'4'` → answer('R1', 4);
- новый тест: `renderPage({})` без mode → мокнутый `reviewApi.counts` → рендерится ModeSelect с плитками и счётчиками;
- restart-race и graduation-тесты сохранить (graduation теперь при `new_status: 'known'` как раньше).

`ModeSelect.test.tsx` (новый):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))
const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigateMock,
}))

import { reviewApi } from '@/api/review'
import { ModeSelect } from './ModeSelect'

function renderModeSelect() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ModeSelect lang="pt" />
    </QueryClientProvider>,
  )
}

describe('ModeSelect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows tiles with counts and navigates on click', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 3, new: 2, practice: 1, ai_enabled: true })
    renderModeSelect()
    expect(await screen.findByText('Карточки')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy() // due count
    screen.getByText('Новые слова').closest('button')!.click()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ mode: 'new' }) }),
    )
  })

  it('disables AI modes when ai is off', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 3, new: 2, practice: 1, ai_enabled: false })
    renderModeSelect()
    await screen.findByText('Карточки')
    const newTile = screen.getByText('Новые слова').closest('button') as HTMLButtonElement
    expect(newTile.disabled).toBe(true)
    expect(screen.getAllByText('AI отключён').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Запустить — падают**

Run: `cd frontend && pnpm exec vitest run src/features/review`

- [ ] **Step 3: Реализация**

`useReviewSession.ts` — извлечь из текущего ReviewPage.tsx (строки 19-115) с изменениями:
- параметры `(lang, { serverMode, lessonId })`; queryKey `['review-queue', lang, serverMode, lessonId ?? null]`; `queryFn: () => reviewApi.queue(lang, lessonId, serverMode === 'due' ? undefined : serverMode)`;
- SessionState: `{ items, idx, results: {item, quality}[] }`; `grade(quality)` — мутация `reviewApi.answer(current.review_item_id, quality)`, onSuccess: сброс ошибки, `graduated = res.new_status === 'known'`, `idx+1` + `results.push({item: current, quality})` (через чистый апдейтер);
- `skip()` — просто `idx+1` без мутации (для ошибок генерации в следующих тасках);
- вычислить `status`: `loading | error | limit | empty | active | done` (limit — только когда `session === null && daily.limit_reached`);
- freshness-гейт и инвалидации перенести КАК ЕСТЬ (комментарии сохранить);
- вернуть объект по контракту выше.

`ReviewCard.tsx` — удалить блок кнопок `✗/✓` и пропсы `answering`/`onAnswer`; оставить flip-структуру (front: text+context+«Показать перевод», back: перевод+заметки+error). Пропсы: `{item, flipped, error, onFlip}`.

`ReviewPage.tsx` — переписать:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { ReviewMode } from '@/api/review'
import { GradeBar } from './GradeBar'
import { ModeSelect } from './ModeSelect'
import { ReviewCard } from './ReviewCard'
import { useReviewSession } from './useReviewSession'

interface Props {
  lang: string
  lessonId: string | undefined
  mode: ReviewMode | undefined
}

export function ReviewPage({ lang, lessonId, mode }: Props) {
  if (lessonId) return <CardsSession lang={lang} lessonId={lessonId} />
  if (!mode) return <ModeSelect lang={lang} />
  if (mode === 'cards') return <CardsSession lang={lang} lessonId={undefined} />
  // Tasks 10-12 заменяют эти заглушки на настоящие сессии
  return <ModePlaceholder lang={lang} />
}
```

`CardsSession` — компонент в том же файле: `useReviewSession(lang, { serverMode: 'due', lessonId })` + локальный `flipped`, хоткеи (Space → flip; после переворота цифры 0..5 → `grade(q)`; guard input/textarea), рендер состояний (тексты как сейчас), активная карточка: `<ReviewCard …/>` + (flipped && `<GradeBar onGrade={grade} disabled={answering} />`), финальный экран: `Средняя оценка: {avg}` + список `results.filter(r => r.quality < 4)` («Повторите ещё раз: слово — перевод») + кнопка restart + graduation-тост (перенести компонент GraduationToast без изменений).

`ModeSelect.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { reviewApi, type ReviewMode } from '@/api/review'

const MODES: {
  mode: ReviewMode
  title: string
  hint: string
  countKey: 'due' | 'new' | 'practice'
  needsAi: boolean
}[] = [
  { mode: 'cards', title: 'Карточки', hint: 'Классические flip-карточки', countKey: 'due', needsAi: false },
  { mode: 'new', title: 'Новые слова', hint: 'AI-пример и первое знакомство', countKey: 'new', needsAi: true },
  { mode: 'cloze', title: 'Квиз: пропуск', hint: 'Предложение с пропуском, 4 варианта', countKey: 'due', needsAi: true },
  { mode: 'reverse', title: 'Квиз: перевод', hint: 'Слово и 4 варианта перевода', countKey: 'due', needsAi: true },
  { mode: 'translation', title: 'Практика перевода', hint: 'Переведи предложение, AI проверит', countKey: 'practice', needsAi: true },
]

export function ModeSelect({ lang }: { lang: string }) {
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['review-counts', lang],
    queryFn: () => reviewApi.counts(lang),
  })

  if (isPending) return <p className="p-8 text-center">Загрузка…</p>
  if (isError)
    return (
      <div className="p-8 text-center">
        <p className="text-destructive">Не удалось загрузить счётчики</p>
        <button type="button" className="mt-2 underline" onClick={() => void refetch()}>
          Повторить
        </button>
      </div>
    )

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-6 text-center text-xl font-semibold">Повторение</h1>
      <div className="grid gap-3">
        {MODES.map((m) => {
          const aiOff = m.needsAi && !data.ai_enabled
          return (
            <button
              key={m.mode}
              type="button"
              disabled={aiOff}
              onClick={() =>
                void navigate({
                  to: '/learn/$lang/review',
                  params: { lang },
                  search: { mode: m.mode },
                })
              }
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 text-left hover:bg-accent disabled:opacity-50"
            >
              <span>
                <span className="block font-medium">{m.title}</span>
                <span className="block text-sm text-muted-foreground">
                  {aiOff ? 'AI отключён' : m.hint}
                </span>
              </span>
              <span className="ml-4 text-2xl font-semibold">{data[m.countKey]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

`routes/learn.$lang.review.tsx` — validateSearch:

```tsx
const MODES = ['cards', 'new', 'cloze', 'reverse', 'translation'] as const

validateSearch: (search: Record<string, unknown>): { lessonId?: string; mode?: ReviewMode } => ({
  ...(typeof search.lessonId === 'string' && search.lessonId
    ? { lessonId: search.lessonId }
    : {}),
  ...(MODES.includes(search.mode as ReviewMode) ? { mode: search.mode as ReviewMode } : {}),
}),
```

и прокинуть `mode` в `<ReviewPage>`.

- [ ] **Step 4: Прогнать фичу + полный фронт**

Run: `cd frontend && pnpm exec vitest run src/features/review && pnpm exec vitest run && pnpm exec tsc -b && pnpm run lint`
Expected: все PASS (включая существующие reader/vocabulary тесты — навигация из BottomToolbar/VocabularyPage не менялась)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/review frontend/src/routes/learn.\$lang.review.tsx
git commit -m "feat(review-ui): mode select screen, session hook, cards mode on 0..5 GradeBar"
```

---

### Task 10: Frontend — режим «Новые слова»

**Files:**
- Create: `frontend/src/features/review/NewWordsSession.tsx`
- Modify: `frontend/src/features/review/ReviewPage.tsx` (`mode === 'new'` → `<NewWordsSession>`)
- Test: `frontend/src/features/review/NewWordsSession.test.tsx`

**Interfaces:**
- Consumes: `useReviewSession(lang, { serverMode: 'new' })`, `reviewApi.exercise<ExampleExercise>({ kind: 'example', review_item_id })`, `GradeBar`.
- Produces: `<NewWordsSession lang={string} />`. Флоу карточки: слово → загрузка example («Готовим пример…») → предложение → «Показать перевод» (Space) → личный перевод + `base_form → base_form_translation` + перевод предложения → GradeBar (хоткеи 0..5). Ошибка генерации → «Не удалось сгенерировать упражнение» + кнопки «Повторить» (refetch exercise) и «Пропустить» (`skip()`).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// frontend/src/features/review/NewWordsSession.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { NewWordsSession } from './NewWordsSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }
const EXAMPLE = {
  payload: {
    sentence: 'Cada dia é único.', sentence_translation: 'Каждый день уникален.',
    base_form: 'cada', base_form_translation: 'каждый',
  },
  model: 'm', latency_ms: 5,
}

function renderSession() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NewWordsSession lang="pt" />
    </QueryClientProvider>,
  )
}

describe('NewWordsSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads example, reveals translation, grades', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(EXAMPLE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderSession()
    expect(await screen.findByText('Cada dia é único.')).toBeTruthy()
    expect(reviewApi.exercise).toHaveBeenCalledWith({ kind: 'example', review_item_id: 'R1' })
    expect(screen.queryByText('Каждый день уникален.')).toBeNull() // до раскрытия
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    expect(await screen.findByText('Каждый день уникален.')).toBeTruthy()
    expect(screen.getByText(/cada → каждый/)).toBeTruthy() // начальная форма
    fireEvent.click(screen.getByRole('button', { name: /4.*С заминкой/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 4))
  })

  it('generation failure offers retry and skip', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockRejectedValue(new Error('502'))
    renderSession()
    expect(await screen.findByText('Не удалось сгенерировать упражнение')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(reviewApi.answer).not.toHaveBeenCalled() // пропуск не пишет событие
  })
})
```

- [ ] **Step 2: Запустить — падают** (`Cannot find module './NewWordsSession'`)

- [ ] **Step 3: Реализация — NewWordsSession.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { reviewApi, type ExampleExercise } from '@/api/review'
import { GradeBar } from './GradeBar'
import { useReviewSession } from './useReviewSession'
import { SessionShell, SessionStates, SessionSummary } from './sessionUi'

export function NewWordsSession({ lang }: { lang: string }) {
  const s = useReviewSession(lang, { serverMode: 'new' })
  const [revealed, setRevealed] = useState(false)

  const exercise = useQuery({
    queryKey: ['exercise', 'example', s.current?.review_item_id ?? null],
    queryFn: () =>
      reviewApi.exercise<ExampleExercise>({
        kind: 'example',
        review_item_id: s.current!.review_item_id,
      }),
    enabled: s.current !== undefined,
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => setRevealed(false), [s.current?.review_item_id])

  // хоткеи: Space — раскрыть; 0..5 — оценка после раскрытия
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!s.current || !exercise.data) return
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && /^[0-5]$/.test(e.key)) {
        s.grade(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const states = SessionStates(s, 'Новые слова')
  if (states) return states
  const item = s.current!

  return (
    <SessionShell subtitle="Новые слова" idx={s.idx} total={s.total}>
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-center text-2xl font-medium">{item.text}</p>
        {exercise.isPending && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Готовим пример…</p>
        )}
        {exercise.isError && (
          <div className="mt-4 text-center">
            <p className="text-sm text-destructive">Не удалось сгенерировать упражнение</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                Повторить
              </button>
              <button type="button" className="underline" onClick={s.skip}>
                Пропустить
              </button>
            </div>
          </div>
        )}
        {exercise.data && (
          <>
            <p className="mt-3 text-center text-base">{exercise.data.payload.sentence}</p>
            {!revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-6 w-full rounded-md border border-border py-3 text-sm hover:bg-accent"
              >
                Показать перевод
              </button>
            ) : (
              <>
                <hr className="my-4 border-border" />
                {item.translation && <p className="text-center text-xl">{item.translation}</p>}
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {exercise.data.payload.base_form} → {exercise.data.payload.base_form_translation}
                </p>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                  {exercise.data.payload.sentence_translation}
                </p>
                {s.answerError && (
                  <p className="mt-2 text-center text-sm text-destructive">{s.answerError}</p>
                )}
                <GradeBar onGrade={s.grade} disabled={s.answering} />
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
```

Примечание: `SessionShell` / `SessionStates` / `SessionSummary` — общие куски UI (заголовок+счётчик, состояния loading/error/empty/limit/done, финальный экран). Task 9 создаёт их inline в ReviewPage; в этом таске ВЫНЕСТИ их в `frontend/src/features/review/sessionUi.tsx` и переиспользовать в CardsSession и NewWordsSession (обнови импорт в ReviewPage.tsx). `SessionStates(s, subtitle)` возвращает JSX для не-active статусов или `null`.

Подключить в ReviewPage: `if (mode === 'new') return <NewWordsSession lang={lang} />`.

- [ ] **Step 4: Прогнать + коммит**

Run: `cd frontend && pnpm exec vitest run src/features/review && pnpm exec tsc -b && pnpm run lint`

```bash
git add frontend/src/features/review
git commit -m "feat(review-ui): new-words mode with AI example flow"
```

---

### Task 11: Frontend — квизы Cloze и Reverse

**Files:**
- Create: `frontend/src/features/review/QuizSession.tsx` (один компонент на оба квиза — различаются kind и рендером вопроса)
- Modify: `frontend/src/features/review/ReviewPage.tsx` (`cloze`/`reverse` → `<QuizSession kind=…>`)
- Test: `frontend/src/features/review/QuizSession.test.tsx`

**Interfaces:**
- Consumes: `useReviewSession(lang, { serverMode: 'due' })`, `reviewApi.exercise<ClozeExercise | ReverseExercise>`, `GradeBar`, `sessionUi`.
- Produces: `<QuizSession lang={string} kind={'cloze' | 'reverse'} />`. Флоу: загрузка упражнения → вопрос (cloze: `sentence_translation` + `sentence_with_gap`; reverse: слово + `sentence`) + 4 кнопки-варианта (хоткеи 1..4) → выбор: подсветка выбранного (верно — зелёная рамка, неверно — красная + подсветить правильный) + строка «✅ Верно!» / «❌ Правильный ответ: …» → GradeBar (хоткеи 0..5). Ошибка генерации → Повторить/Пропустить (как Task 10).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// frontend/src/features/review/QuizSession.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { QuizSession } from './QuizSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }
const CLOZE = {
  payload: {
    sentence_with_gap: '___ dia é único.',
    sentence_translation: 'Каждый день уникален.',
    options: [
      { text: 'Todo', is_correct: false },
      { text: 'Cada', is_correct: true },
      { text: 'Muito', is_correct: false },
      { text: 'Pouco', is_correct: false },
    ],
  },
  model: 'm', latency_ms: 5,
}

function renderQuiz(kind: 'cloze' | 'reverse' = 'cloze') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <QuizSession lang="pt" kind={kind} />
    </QueryClientProvider>,
  )
}

describe('QuizSession (cloze)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(CLOZE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
  })

  it('correct option shows feedback then grade bar posts quality', async () => {
    renderQuiz()
    expect(await screen.findByText('___ dia é único.')).toBeTruthy()
    expect(reviewApi.exercise).toHaveBeenCalledWith({ kind: 'cloze', review_item_id: 'R1' })
    // до выбора GradeBar нет
    expect(screen.queryByRole('button', { name: /5.*Идеально/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cada' }))
    expect(await screen.findByText('✅ Верно!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /5.*Идеально/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 5))
  })

  it('wrong option reveals the correct answer', async () => {
    renderQuiz()
    fireEvent.click(await screen.findByRole('button', { name: 'Todo' }))
    expect(await screen.findByText(/❌ Правильный ответ: Cada/)).toBeTruthy()
    // варианты заблокированы после выбора
    const opt = screen.getByRole('button', { name: 'Muito' }) as HTMLButtonElement
    expect(opt.disabled).toBe(true)
  })

  it('option hotkeys 1..4 select the option', async () => {
    renderQuiz()
    await screen.findByText('___ dia é único.')
    fireEvent.keyDown(window, { key: '2' }) // второй вариант = Cada
    expect(await screen.findByText('✅ Верно!')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Запустить — падают**

- [ ] **Step 3: Реализация — QuizSession.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { reviewApi, type ClozeExercise, type ReverseExercise } from '@/api/review'
import { GradeBar } from './GradeBar'
import { SessionShell, SessionStates } from './sessionUi'
import { useReviewSession } from './useReviewSession'

type QuizKind = 'cloze' | 'reverse'
type QuizPayload = ClozeExercise | ReverseExercise

const SUBTITLES: Record<QuizKind, string> = {
  cloze: 'Квиз: пропуск',
  reverse: 'Квиз: перевод',
}

export function QuizSession({ lang, kind }: { lang: string; kind: QuizKind }) {
  const s = useReviewSession(lang, { serverMode: 'due' })
  const [picked, setPicked] = useState<number | null>(null)

  const exercise = useQuery({
    queryKey: ['exercise', kind, s.current?.review_item_id ?? null],
    queryFn: () =>
      reviewApi.exercise<QuizPayload>({ kind, review_item_id: s.current!.review_item_id }),
    enabled: s.current !== undefined,
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => setPicked(null), [s.current?.review_item_id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!s.current || !exercise.data) return
      if (picked === null && /^[1-4]$/.test(e.key)) {
        setPicked(Number(e.key) - 1)
      } else if (picked !== null && /^[0-5]$/.test(e.key)) {
        s.grade(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const states = SessionStates(s, SUBTITLES[kind])
  if (states) return states
  const item = s.current!
  const payload = exercise.data?.payload
  const options = payload?.options ?? []
  const correctIdx = options.findIndex((o) => o.is_correct)
  const isCorrect = picked !== null && options[picked]?.is_correct

  return (
    <SessionShell subtitle={SUBTITLES[kind]} idx={s.idx} total={s.total}>
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        {kind === 'reverse' && <p className="text-center text-2xl font-medium">{item.text}</p>}
        {exercise.isPending && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Готовим упражнение…</p>
        )}
        {exercise.isError && (
          <div className="mt-4 text-center">
            <p className="text-sm text-destructive">Не удалось сгенерировать упражнение</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                Повторить
              </button>
              <button type="button" className="underline" onClick={s.skip}>
                Пропустить
              </button>
            </div>
          </div>
        )}
        {payload && (
          <>
            {'sentence_with_gap' in payload ? (
              <>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {payload.sentence_translation}
                </p>
                <p className="mt-3 text-center text-lg">{payload.sentence_with_gap}</p>
              </>
            ) : (
              <p className="mt-3 text-center text-sm text-muted-foreground">{payload.sentence}</p>
            )}
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {options.map((o, i) => (
                <button
                  key={o.text}
                  type="button"
                  disabled={picked !== null}
                  onClick={() => setPicked(i)}
                  className={[
                    'rounded-md border py-3 text-base disabled:opacity-80',
                    picked === null && 'border-border hover:bg-accent',
                    picked !== null && o.is_correct && 'border-green-600',
                    picked === i && !o.is_correct && 'border-destructive',
                    picked !== null && picked !== i && !o.is_correct && 'border-border opacity-50',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {o.text}
                </button>
              ))}
            </div>
            {picked !== null && (
              <>
                <p className="mt-4 text-center text-base">
                  {isCorrect ? '✅ Верно!' : `❌ Правильный ответ: ${options[correctIdx]?.text}`}
                </p>
                {s.answerError && (
                  <p className="mt-2 text-center text-sm text-destructive">{s.answerError}</p>
                )}
                <GradeBar onGrade={s.grade} disabled={s.answering} />
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
```

Подключить в ReviewPage: `if (mode === 'cloze') return <QuizSession lang={lang} kind="cloze" />; if (mode === 'reverse') return <QuizSession lang={lang} kind="reverse" />`.

- [ ] **Step 4: Прогнать + коммит**

Run: `cd frontend && pnpm exec vitest run src/features/review && pnpm exec tsc -b && pnpm run lint`

```bash
git add frontend/src/features/review
git commit -m "feat(review-ui): cloze and reverse quiz modes"
```

---

### Task 12: Frontend — практика перевода, письменное упражнение, финальный регресс

**Files:**
- Create: `frontend/src/features/review/TranslationSession.tsx`
- Modify: `frontend/src/features/review/sessionUi.tsx` (финальный экран квизов: кнопка письменного упражнения)
- Modify: `frontend/src/features/review/ReviewPage.tsx` (`translation` → `<TranslationSession>`)
- Test: `frontend/src/features/review/TranslationSession.test.tsx`; Modify тест финального экрана в `ReviewPage.test.tsx` или `QuizSession.test.tsx`

**Interfaces:**
- Consumes: `reviewApi.queue(lang, undefined, 'practice')`, `reviewApi.exercise<{sentence_translation: string}>({kind: 'translation_task', …})`, `reviewApi.exerciseFeedback`, `reviewApi.exercise<{text: string}>({kind: 'writing', review_item_ids})`.
- Produces:
  - `<TranslationSession lang={string} />` — БЕЗ useReviewSession (не SRS): свой локальный прогон по очереди practice; карточка: `sentence_translation` → textarea → «Проверить» → feedback (текст) → «Дальше»; события не пишутся; финал — «Практика завершена» + restart.
  - Финальный экран SRS-сессий (`SessionSummary` в sessionUi): при `results.some(r => r.quality < 4)` — кнопка «Письменное упражнение по ошибкам» → `exercise({kind:'writing', review_item_ids: [ошибочные]})` → `<pre>` с текстом (загрузка/ошибка стандартно).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// frontend/src/features/review/TranslationSession.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { TranslationSession } from './TranslationSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 4, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }

function renderSession() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TranslationSession lang="pt" />
    </QueryClientProvider>,
  )
}

describe('TranslationSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue({
      payload: { sentence_translation: 'Каждый день уникален.' }, model: 'm', latency_ms: 5,
    })
    vi.mocked(reviewApi.exerciseFeedback).mockResolvedValue({
      feedback: 'Хорошо. Пропущена диакритика в único.',
    })
  })

  it('shows sentence, sends user translation, renders feedback, no SRS writes', async () => {
    renderSession()
    expect(await screen.findByText('Каждый день уникален.')).toBeTruthy()
    expect(reviewApi.queue).toHaveBeenCalledWith('pt', undefined, 'practice')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cada dia e unico.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() =>
      expect(reviewApi.exerciseFeedback).toHaveBeenCalledWith({
        review_item_id: 'R1',
        sentence_translation: 'Каждый день уникален.',
        user_text: 'Cada dia e unico.',
      }),
    )
    expect(await screen.findByText(/Пропущена диакритика/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))
    expect(await screen.findByText('Практика завершена')).toBeTruthy()
    expect(reviewApi.answer).not.toHaveBeenCalled()
  })
})
```

Тест письменного упражнения (добавить в тесты финального экрана SRS-сессии — рядом с существующим session-flow describe): очередь из 1 item, `answer` резолвится, GradeBar `2` (ошибка, q<4) → финальный экран → кнопка «Письменное упражнение по ошибкам» видна → мок `exercise` с `{payload: {text: '1. ___ dia...\nОтветы: ...'}}` → клик → текст отрендерен; при всех q≥4 кнопки нет.

- [ ] **Step 2: Запустить — падают**

- [ ] **Step 3: Реализация**

`TranslationSession.tsx` — самостоятельный компонент (очередь practice загружается один раз через useQuery с `staleTime: Infinity, gcTime: 0`; локальный idx; на карточку: useQuery `['exercise', 'translation_task', review_item_id]` → предложение; `useMutation` exerciseFeedback; после фидбека кнопка «Дальше» → idx+1; ошибки генерации — Повторить/Пропустить как в других режимах; финал «Практика завершена» + «Ещё раз» (refetch + сброс idx)).

`sessionUi.tsx` (`SessionSummary`): пропсы `{results, restartLabel, onRestart, showWriting?: boolean}`; при `showWriting && mistakes.length > 0` рендерить кнопку «Письменное упражнение по ошибкам»; по клику `useMutation(() => reviewApi.exercise<{text: string}>({kind: 'writing', review_item_ids: mistakes.map(m => m.item.review_item_id)}))`; результат — `<pre className="mt-4 whitespace-pre-wrap text-left text-sm">{text}</pre>`; `showWriting` включить для cloze/reverse (передаётся из QuizSession), выключить для cards/new (по спеке §7 — «для квизов»).

Подключить в ReviewPage: `if (mode === 'translation') return <TranslationSession lang={lang} />` и удалить `ModePlaceholder`.

- [ ] **Step 4: Полный регресс обоих стеков**

Run: `cd frontend && pnpm exec vitest run && pnpm exec tsc -b && pnpm run lint`
Run: `cd backend && uv run pytest && uv run pyright && uv run ruff check .`
Expected: всё PASS/чисто.

- [ ] **Step 5: Амендмент ADR-0005** — добавить в `docs/adr/ADR-0005-word-status-model-lingq-levels.md` строку в шапку амендментов:

```markdown
- Амендмент: 2026-07-20 — FLQ-20: самооценка 0..5 заменяет бинарный ответ ревью; правило confidence: q≤2 → −1, q=3 → 0, q≥4 → +1; graduation: q≥4 при confidence 5. Источник правил — docs/superpowers/specs/2026-07-20-word-trainer-design.md §3.
```

и в таблице переходов заменить строку `tracked → tracked (confidence ±1)` триггер на «ответ в review session (quality q≥4 → +1, q=3 → 0, q≤2 → −1, не опускаясь ниже 0)».

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/review docs/adr/ADR-0005-word-status-model-lingq-levels.md
git commit -m "feat(review-ui): translation practice mode, writing exercise on quiz summary"
```

---

## Верификация acceptance criteria FLQ-20 (после Task 12)

| AC | Покрытие |
|---|---|
| #1 экран выбора режима + счётчики + ai-off | Task 9 (ModeSelect + тесты) |
| #2 самооценка 0..5, SM-2/confidence/graduation по §3 | Tasks 2-3 (unit+сервис), Task 9 (GradeBar в cards) |
| #3 «Новые слова» с AI-примером, last_reviewed_at IS NULL | Task 4 (queue new) + Task 10 |
| #4 квизы 4 варианта, верно/неверно → GradeBar | Task 6 (валидация options) + Task 11 |
| #5 практика перевода вне SRS/лимита | Task 4 (practice mode) + Task 12 (no answer calls) |
| #6 письменное упражнение по ошибкам | Task 6 (kind writing) + Task 12 |
| #7 ошибки генерации: ретрай/пропуск; 503 деградация | Task 6 (ретрай/parse error), Task 7 (503/502), Tasks 10-12 (UI) |
| #8 quality в событиях, старая аналитика жива | Task 1 (nullable) + Task 3 (производный answer_value) |

Финальный шаг: живая проверка по рецепту `.claude/skills/verify/SKILL.md` — с реальным LLM (GLOSANO_LLM_ENABLED=true + ключ из backend/.env, если настроен; иначе проверить 503-деградацию: плитки disabled, карточки работают). После — backlog finalization FLQ-20.
