# FLQ-7 SRS Review Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SRS-движок повторений: таблицы `review_items`/`review_events`, SM-2 планировщик, `GET /api/review/queue` + `POST /api/review/answer`, страница `/learn/$lang/review` с карточками, lesson-scoped mini-review из reader.

**Architecture:** Новый backend-модуль `modules/review` (session-first функции, как `modules/vocabulary`): чистый SM-2 в `sm2.py`, lifecycle-синк вызывается из write-путей vocabulary, очередь и ответ — отдельные функции сервиса, роутер `api/review.py`. Frontend: фича `features/review/` (ReviewPage + ReviewCard), роут `learn.$lang.review` c `?lessonId=`, кнопка в BottomToolbar. Сессия stateless: каждый ответ персистится сразу.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + pytest/testcontainers; React 19 + TanStack Router/Query + vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-srs-review-engine-design.md` (одобрена). Backlog: FLQ-7.

## Global Constraints

- Backend-команды запускать из `backend/`: `uv run pytest`, `uv run pyright`, `uv run ruff check . && uv run ruff format .`.
- Frontend-команды из `frontend/` (менеджер — **pnpm**): `pnpm exec vitest run <file>`, `pnpm exec tsc -b`.
- Коммиты: conventional commits (`feat(review): ...`), **БЕЗ** трейлера Co-Authored-By.
- Языки в API: `Literal["en", "ru", "pt"]` (как в `api/vocabulary.py`).
- Статусная модель ADR-0005: `tracked` ⇔ `confidence IS NOT NULL` (0..5); graduation: ответ «верно» при confidence 5 → `known`.
- Дневной лимит мягкий: ограничивает только главную очередь; сервер не отвергает ответы сверх лимита; сутки — UTC.
- Все новые backend-модели — в side-effect импорты `backend/tests/conftest.py` (схема тестов строится `create_all`).
- UI-строки — на русском (как в существующем UI).

---

### Task 1: Модели review + миграция 0012 с backfill

**Files:**
- Create: `backend/src/flinq/modules/review/__init__.py` (пустой)
- Create: `backend/src/flinq/modules/review/models.py`
- Create: `backend/migrations/versions/0012_review.py`
- Modify: `backend/tests/conftest.py` (side-effect импорт моделей, после блока vocabulary ~строка 78-80)
- Test: `backend/tests/modules/review/test_models.py` (+ пустой `backend/tests/modules/review/__init__.py`, если pytest его требует — в остальных tests/modules его нет, значит не нужен)

**Interfaces:**
- Produces: ORM-классы `ReviewItem`, `ReviewEvent` (`flinq.modules.review.models`); миграция `0012_review` с константой `BACKFILL_SQL_TOKENS`, `BACKFILL_SQL_PHRASES`.

- [ ] **Step 1: Написать падающий тест**

```python
# backend/tests/modules/review/test_models.py
"""ReviewItem/ReviewEvent roundtrip + backfill SQL (FLQ-7 Task 1)."""

import importlib.util
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.vocabulary.models import TokenItem


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
        for model in (ReviewEvent, ReviewItem, TokenItem):
            await s.execute(delete(model))


async def test_review_item_and_event_roundtrip():
    now = datetime.now(UTC)
    async with session_scope() as s:
        user_id = await _make_user(s)
        ri = ReviewItem(
            user_id=user_id,
            item_kind="token",
            item_id=uuid.uuid4(),
            language_code="pt",
            algorithm_state_json={"ease_factor": 2.5, "interval_days": 0.0, "repetitions": 0},
            due_at=now,
        )
        s.add(ri)
        await s.flush()
        assert ri.is_active is True and ri.algorithm_name == "sm2"
        s.add(
            ReviewEvent(
                review_item_id=ri.id,
                user_id=user_id,
                answer_value="correct",
                previous_confidence=1,
                new_confidence=2,
                previous_due_at=now,
                new_due_at=now,
            )
        )
        await s.commit()
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.answer_value == "correct" and ev.reviewed_at is not None


async def test_unique_active_allows_inactive_duplicates():
    """Partial unique: два неактивных дубликата допустимы, активный — один."""
    now = datetime.now(UTC)
    async with session_scope() as s:
        user_id = await _make_user(s)
        item_id = uuid.uuid4()
        for active in (False, False, True):
            s.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind="token",
                    item_id=item_id,
                    language_code="pt",
                    is_active=active,
                    algorithm_state_json={},
                    due_at=now,
                )
            )
        await s.commit()  # не должно упасть


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "0012_review",
        Path(__file__).parent.parent.parent.parent / "migrations" / "versions" / "0012_review.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_chains_from_0011():
    mod = _load_migration()
    assert mod.revision == "0012_review"
    assert mod.down_revision == "0011_phrase_text_check"
    assert callable(mod.upgrade) and callable(mod.downgrade)


async def test_backfill_sql_creates_active_items_for_tracked():
    mod = _load_migration()
    async with session_scope() as s:
        user_id = await _make_user(s)
        s.add(
            TokenItem(
                user_id=user_id, language_code="pt", token_text="cada",
                status="tracked", confidence=1,
            )
        )
        s.add(
            TokenItem(
                user_id=user_id, language_code="pt", token_text="mundo",
                status="known", confidence=None,
            )
        )
        await s.flush()
        await s.execute(text(mod.BACKFILL_SQL_TOKENS))
        await s.execute(text(mod.BACKFILL_SQL_PHRASES))
        await s.commit()
    async with session_scope() as s:
        rows = (await s.execute(select(ReviewItem))).scalars().all()
        assert len(rows) == 1
        ri = rows[0]
        assert ri.is_active and ri.item_kind == "token" and ri.language_code == "pt"
        assert ri.algorithm_state_json == {
            "ease_factor": 2.5, "interval_days": 0.0, "repetitions": 0,
        }
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd backend && uv run pytest tests/modules/review/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'flinq.modules.review'`

- [ ] **Step 3: Реализация — модели**

```python
# backend/src/flinq/modules/review/models.py
"""SRS review tables (FLQ-7): current state + append-only history."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from flinq.core.db import Base


class ReviewItem(Base):
    """Текущее SRS-состояние одного learning item (domain model §10.2).

    (item_kind, item_id) — полиморфная ссылка на token_items/phrase_items без FK,
    как в PersonalTranslation. language_code денормализован: язык item неизменяем,
    а очередь фильтруется по нему без join.
    """

    __tablename__ = "review_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    item_kind: Mapped[str] = mapped_column(String(16))
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    language_code: Mapped[str] = mapped_column(String(8))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    algorithm_name: Mapped[str] = mapped_column(String(16), default="sm2")
    algorithm_state_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("item_kind IN ('token', 'phrase')", name="ck_review_items_kind"),
        Index(
            "uq_review_items_active",
            "user_id",
            "item_kind",
            "item_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        Index("ix_review_items_queue", "user_id", "language_code", "is_active", "due_at"),
    )


class ReviewEvent(Base):
    """Append-only история ответов (domain model §10.3). Нет UPDATE/DELETE путей."""

    __tablename__ = "review_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("review_items.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    answer_value: Mapped[str] = mapped_column(String(8))
    previous_confidence: Mapped[int | None] = mapped_column(SmallInteger)
    new_confidence: Mapped[int | None] = mapped_column(SmallInteger)
    previous_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    new_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("answer_value IN ('correct', 'wrong')", name="ck_review_events_answer"),
        Index("ix_review_events_user_time", "user_id", "reviewed_at"),
    )
```

Создать пустой `backend/src/flinq/modules/review/__init__.py`.

- [ ] **Step 4: Реализация — миграция**

```python
# backend/migrations/versions/0012_review.py
"""review_items + review_events + backfill active items for tracked vocab (FLQ-7)

Revision ID: 0012_review
Revises: 0011_phrase_text_check
Create Date: 2026-07-20 00:00:00.000000

Backfill: каждый tracked token/phrase item получает активный review_item
(due сразу, свежий SM-2 state). После этого инвариант «tracked ⇔ активный
review_item» поддерживает lifecycle-синк в modules/review/service.py.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0012_review"
down_revision: str | Sequence[str] | None = "0011_phrase_text_check"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INITIAL_STATE = '{"ease_factor": 2.5, "interval_days": 0.0, "repetitions": 0}'

BACKFILL_SQL_TOKENS = f"""
INSERT INTO review_items
    (id, user_id, item_kind, item_id, language_code, is_active,
     algorithm_name, algorithm_state_json, due_at, created_at, updated_at)
SELECT gen_random_uuid(), user_id, 'token', id, language_code, TRUE,
       'sm2', '{_INITIAL_STATE}'::jsonb, now(), now(), now()
FROM token_items WHERE status = 'tracked'
"""

BACKFILL_SQL_PHRASES = f"""
INSERT INTO review_items
    (id, user_id, item_kind, item_id, language_code, is_active,
     algorithm_name, algorithm_state_json, due_at, created_at, updated_at)
SELECT gen_random_uuid(), user_id, 'phrase', id, language_code, TRUE,
       'sm2', '{_INITIAL_STATE}'::jsonb, now(), now(), now()
FROM phrase_items WHERE status = 'tracked'
"""


def upgrade() -> None:
    op.create_table(
        "review_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("item_kind", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("language_code", sa.String(length=8), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("algorithm_name", sa.String(length=16), nullable=False),
        sa.Column("algorithm_state_json", JSONB(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("item_kind IN ('token', 'phrase')", name="ck_review_items_kind"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_review_items_active",
        "review_items",
        ["user_id", "item_kind", "item_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_index(
        "ix_review_items_queue",
        "review_items",
        ["user_id", "language_code", "is_active", "due_at"],
    )

    op.create_table(
        "review_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("review_item_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("answer_value", sa.String(length=8), nullable=False),
        sa.Column("previous_confidence", sa.SmallInteger(), nullable=True),
        sa.Column("new_confidence", sa.SmallInteger(), nullable=True),
        sa.Column("previous_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("new_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "reviewed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("answer_value IN ('correct', 'wrong')", name="ck_review_events_answer"),
        sa.ForeignKeyConstraint(["review_item_id"], ["review_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_events_user_time", "review_events", ["user_id", "reviewed_at"])

    op.execute(BACKFILL_SQL_TOKENS)
    op.execute(BACKFILL_SQL_PHRASES)


def downgrade() -> None:
    op.drop_index("ix_review_events_user_time", table_name="review_events")
    op.drop_table("review_events")
    op.drop_index("ix_review_items_queue", table_name="review_items")
    op.drop_index("uq_review_items_active", table_name="review_items")
    op.drop_table("review_items")
```

- [ ] **Step 5: Зарегистрировать модели в conftest**

В `backend/tests/conftest.py` после импорта `vocabulary.models` (строки ~78-80) добавить:

```python
    from flinq.modules.review import (
        models as _review_models,  # noqa: F401  # pyright: ignore[reportUnusedImport]
    )
```

(вставить в алфавитном порядке — между `reader_state` и `vocabulary`).

- [ ] **Step 6: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/test_models.py -v`
Expected: 4 PASS

- [ ] **Step 7: Линт/типы и коммит**

Run: `cd backend && uv run ruff check . && uv run ruff format . && uv run pyright`
Expected: чисто.

```bash
git add backend/src/flinq/modules/review backend/migrations/versions/0012_review.py backend/tests/conftest.py backend/tests/modules/review
git commit -m "feat(review): review_items/review_events models, migration 0012 with tracked backfill"
```

---

### Task 2: Чистый SM-2 модуль

**Files:**
- Create: `backend/src/flinq/modules/review/sm2.py`
- Test: `backend/tests/modules/review/test_sm2.py`

**Interfaces:**
- Produces:
  - `Sm2State` — frozen dataclass `(ease_factor: float = 2.5, interval_days: float = 0.0, repetitions: int = 0)`
  - `INITIAL_STATE: Sm2State`
  - `apply_answer(state: Sm2State, *, correct: bool, now: datetime) -> tuple[Sm2State, datetime]`
  - `state_to_json(state: Sm2State) -> dict[str, float | int]`
  - `state_from_json(data: dict) -> Sm2State` (отсутствующие ключи → значения INITIAL_STATE)

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/modules/review/test_sm2.py
"""SM-2 baseline (FLQ-7 Task 2): интервалы 1/6/×EF, EF-штраф с floor, reset."""

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
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_sm2.py -v`
Expected: FAIL — `ModuleNotFoundError` / `ImportError`

- [ ] **Step 3: Реализация**

```python
# backend/src/flinq/modules/review/sm2.py
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
    new = Sm2State(
        ease_factor=state.ease_factor, interval_days=interval, repetitions=repetitions
    )
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

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/test_sm2.py -v`
Expected: 7 PASS

- [ ] **Step 5: Линт/типы и коммит**

Run: `cd backend && uv run ruff check . && uv run ruff format . && uv run pyright`

```bash
git add backend/src/flinq/modules/review/sm2.py backend/tests/modules/review/test_sm2.py
git commit -m "feat(review): pure SM-2 scheduler (binary answer, EF floor, reset on wrong)"
```

---

### Task 3: Lifecycle-синк review_items

**Files:**
- Create: `backend/src/flinq/modules/review/service.py`
- Test: `backend/tests/modules/review/test_review_lifecycle.py`

**Interfaces:**
- Consumes: `ReviewItem` (Task 1), `INITIAL_STATE`, `state_to_json` (Task 2).
- Produces (в `flinq.modules.review.service`):
  - `async def sync_review_item(session, *, user_id: uuid.UUID, item_kind: str, item_id: uuid.UUID, language_code: str, status: str, now: datetime | None = None) -> None` — **не коммитит**; вызывающий (vocabulary service) коммитит сам.
  - `async def deactivate_review_items(session, *, user_id: uuid.UUID, item_kind: str, item_ids: list[uuid.UUID]) -> None` — bulk-версия, не коммитит.

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/modules/review/test_review_lifecycle.py
"""sync_review_item: tracked ⇒ активный review_item; known/ignored ⇒ деактивация."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import deactivate_review_items, sync_review_item
from flinq.modules.review.sm2 import INITIAL_STATE, state_to_json

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


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
        for model in (ReviewEvent, ReviewItem):
            await s.execute(delete(model))


async def _one(s: AsyncSession) -> ReviewItem:
    return (await s.execute(select(ReviewItem))).scalars().one()


async def test_tracked_creates_active_item():
    item_id = uuid.uuid4()
    async with session_scope() as s:
        user_id = await _make_user(s)
        await sync_review_item(
            s, user_id=user_id, item_kind="token", item_id=item_id,
            language_code="pt", status="tracked", now=NOW,
        )
        await s.commit()
    async with session_scope() as s:
        ri = await _one(s)
        assert ri.is_active and ri.due_at == NOW and ri.item_id == item_id
        assert ri.algorithm_state_json == state_to_json(INITIAL_STATE)


async def test_tracked_again_does_not_duplicate_or_reset():
    item_id = uuid.uuid4()
    async with session_scope() as s:
        user_id = await _make_user(s)
        await sync_review_item(
            s, user_id=user_id, item_kind="token", item_id=item_id,
            language_code="pt", status="tracked", now=NOW,
        )
        await s.commit()
        # активный item: смена confidence руками не должна трогать SRS state
        (await _one(s)).algorithm_state_json = {"ease_factor": 2.1, "interval_days": 6.0, "repetitions": 2}
        await s.commit()
        await sync_review_item(
            s, user_id=user_id, item_kind="token", item_id=item_id,
            language_code="pt", status="tracked", now=NOW,
        )
        await s.commit()
    async with session_scope() as s:
        ri = await _one(s)
        assert ri.algorithm_state_json["repetitions"] == 2  # state сохранён


async def test_known_deactivates_and_retrack_reactivates_fresh():
    item_id = uuid.uuid4()
    async with session_scope() as s:
        user_id = await _make_user(s)
        await sync_review_item(
            s, user_id=user_id, item_kind="token", item_id=item_id,
            language_code="pt", status="tracked", now=NOW,
        )
        await s.commit()
        (await _one(s)).algorithm_state_json = {"ease_factor": 2.1, "interval_days": 6.0, "repetitions": 2}
        await sync_review_item(
            s, user_id=user_id, item_kind="token", item_id=item_id,
            language_code="pt", status="known", now=NOW,
        )
        await s.commit()
        assert (await _one(s)).is_active is False
        await sync_review_item(
            s, user_id=user_id, item_kind="token", item_id=item_id,
            language_code="pt", status="tracked", now=NOW,
        )
        await s.commit()
    async with session_scope() as s:
        ri = await _one(s)  # реактивация той же строки, не дубликат
        assert ri.is_active is True
        assert ri.algorithm_state_json == state_to_json(INITIAL_STATE)  # fresh state
        assert ri.due_at == NOW


async def test_bulk_deactivate():
    ids = [uuid.uuid4(), uuid.uuid4()]
    async with session_scope() as s:
        user_id = await _make_user(s)
        for iid in ids:
            await sync_review_item(
                s, user_id=user_id, item_kind="token", item_id=iid,
                language_code="pt", status="tracked", now=NOW,
            )
        await s.commit()
        await deactivate_review_items(s, user_id=user_id, item_kind="token", item_ids=ids)
        await s.commit()
    async with session_scope() as s:
        rows = (await s.execute(select(ReviewItem))).scalars().all()
        assert all(not r.is_active for r in rows) and len(rows) == 2
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_lifecycle.py -v`
Expected: FAIL — `ImportError` (нет service.py)

- [ ] **Step 3: Реализация**

```python
# backend/src/flinq/modules/review/service.py
"""SRS review service (FLQ-7). Session-first module functions.

Lifecycle-инвариант (domain model §10.1): tracked item ⇔ активный review_item.
sync_review_item/deactivate_review_items вызываются из write-путей vocabulary
ДО их commit — сами не коммитят.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.modules.review.models import ReviewItem
from flinq.modules.review.sm2 import INITIAL_STATE, state_to_json


async def sync_review_item(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    item_kind: str,
    item_id: uuid.UUID,
    language_code: str,
    status: str,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(UTC)
    existing = (
        (
            await session.execute(
                select(ReviewItem).where(
                    ReviewItem.user_id == user_id,
                    ReviewItem.item_kind == item_kind,
                    ReviewItem.item_id == item_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if status == "tracked":
        if existing is None:
            session.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind=item_kind,
                    item_id=item_id,
                    language_code=language_code,
                    is_active=True,
                    algorithm_state_json=state_to_json(INITIAL_STATE),
                    due_at=now,
                )
            )
        elif not existing.is_active:
            # Реактивация (known/ignored -> tracked): свежая траектория (spec §3).
            existing.is_active = True
            existing.algorithm_state_json = state_to_json(INITIAL_STATE)
            existing.due_at = now
        # Уже активный: ручная смена confidence SRS state не трогает.
    elif existing is not None and existing.is_active:
        existing.is_active = False


async def deactivate_review_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    item_kind: str,
    item_ids: list[uuid.UUID],
) -> None:
    await session.execute(
        update(ReviewItem)
        .where(
            ReviewItem.user_id == user_id,
            ReviewItem.item_kind == item_kind,
            ReviewItem.item_id.in_(item_ids),
            ReviewItem.is_active.is_(True),
        )
        .values(is_active=False)
    )
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/test_review_lifecycle.py -v`
Expected: 4 PASS

- [ ] **Step 5: Линт/типы и коммит**

Run: `cd backend && uv run ruff check . && uv run ruff format . && uv run pyright`

```bash
git add backend/src/flinq/modules/review/service.py backend/tests/modules/review/test_review_lifecycle.py
git commit -m "feat(review): review_item lifecycle sync (tracked <-> active invariant)"
```

---

### Task 4: Вызовы синка из vocabulary service

**Files:**
- Modify: `backend/src/flinq/modules/vocabulary/service.py` (`create_item` ~123-210, `patch_item` ~213-228, `bulk_action` ~804-871)
- Test: `backend/tests/modules/review/test_vocab_sync_integration.py`

**Interfaces:**
- Consumes: `sync_review_item`, `deactivate_review_items` (Task 3).
- Produces: инвариант «tracked ⇔ активный review_item» на всех write-путях vocabulary. Сигнатуры vocabulary-функций **не меняются**.

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/modules/review/test_vocab_sync_integration.py
"""Write-пути vocabulary поддерживают инвариант tracked ⇔ активный review_item."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.vocabulary import service as vocab
from flinq.modules.vocabulary.models import PhraseItem, TokenItem


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
        for model in (ReviewEvent, ReviewItem, PhraseItem, TokenItem):
            await s.execute(delete(model))


async def _active_items(s: AsyncSession) -> list[ReviewItem]:
    return list(
        (await s.execute(select(ReviewItem).where(ReviewItem.is_active.is_(True))))
        .scalars()
        .all()
    )


async def test_create_tracked_token_creates_review_item():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="cada", status="tracked", confidence=1,
        )
    async with session_scope() as s:
        [ri] = await _active_items(s)
        assert (ri.item_kind, ri.item_id, ri.language_code) == ("token", item.id, "pt")


async def test_create_tracked_phrase_creates_review_item():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s, user_id=user_id, kind="phrase", language_code="pt",
            text="bom dia", status="tracked", confidence=1,
        )
    async with session_scope() as s:
        [ri] = await _active_items(s)
        assert (ri.item_kind, ri.item_id) == ("phrase", item.id)


async def test_create_known_does_not_create_review_item():
    async with session_scope() as s:
        user_id = await _make_user(s)
        await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="mundo", status="known", confidence=None,
        )
    async with session_scope() as s:
        assert await _active_items(s) == []


async def test_patch_to_known_deactivates_and_back_reactivates():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="cada", status="tracked", confidence=1,
        )
        await vocab.patch_item(
            s, user_id=user_id, kind="token", item_id=item.id,
            status="known", confidence=None,
        )
        assert await _active_items(s) == []
        await vocab.patch_item(
            s, user_id=user_id, kind="token", item_id=item.id,
            status="tracked", confidence=1,
        )
        assert len(await _active_items(s)) == 1


async def test_bulk_set_known_and_delete_deactivate():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="um", status="tracked", confidence=1,
        )
        b = await vocab.create_item(
            s, user_id=user_id, kind="token", language_code="pt",
            text="dois", status="tracked", confidence=1,
        )
        await vocab.bulk_action(
            s, user_id=user_id, item_ids=[a.id], action="set_known", tag_name=None,
        )
        assert len(await _active_items(s)) == 1
        await vocab.bulk_action(
            s, user_id=user_id, item_ids=[b.id], action="delete", tag_name=None,
        )
        assert await _active_items(s) == []
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_vocab_sync_integration.py -v`
Expected: FAIL — assert по review_items (синк ещё не вызывается)

- [ ] **Step 3: Реализация — вставить вызовы синка**

В `backend/src/flinq/modules/vocabulary/service.py`:

1. Импорт вверху (к остальным импортам):

```python
from flinq.modules.review.service import deactivate_review_items, sync_review_item
```

2. В `create_item` — во **всех пяти** ветках завершения перед `await session.commit()` вставить синк. Ветка «existing phrase» (~143-147):

```python
        if existing_phrase is not None:
            existing_phrase.status = status
            existing_phrase.confidence = confidence
            _promote_to_user(existing_phrase)
            await sync_review_item(
                session, user_id=user_id, item_kind="phrase", item_id=existing_phrase.id,
                language_code=language_code, status=status,
            )
            await session.commit()
            return existing_phrase
```

Ветка «new phrase» (~148-159) — id появляется после flush:

```python
        session.add(phrase)
        try:
            await session.flush()
            await sync_review_item(
                session, user_id=user_id, item_kind="phrase", item_id=phrase.id,
                language_code=language_code, status=status,
            )
            await session.commit()
        except IntegrityError:
```

В race-ветке phrase (~164-174) добавить тот же синк для `existing_phrase.id` перед `await session.commit()`. Аналогично три токен-ветки: «existing token» (~180-185), «new token» (после `session.add(item)` — `await session.flush()` + синк c `item_kind="token", item_id=item.id`), race-ветка (~199-209).

3. В `patch_item` перед `await session.commit()` (~227):

```python
    await sync_review_item(
        session, user_id=user_id, item_kind=kind, item_id=item.id,
        language_code=item.language_code, status=status,
    )
    await session.commit()
```

4. В `bulk_action`: в ветке `set_known`/`set_ignored` внутри цикла `for kind, ids in owned_by_kind.items():` после `await session.execute(update(...))` добавить:

```python
            await deactivate_review_items(session, user_id=user_id, item_kind=kind, item_ids=ids)
```

В ветке `delete` — та же строка после `await session.execute(delete(model)...)`.

- [ ] **Step 4: Прогнать тесты (новые + регресс vocabulary)**

Run: `cd backend && uv run pytest tests/modules/review/test_vocab_sync_integration.py tests/modules/test_vocabulary_service.py tests/api/test_vocabulary.py -v`
Expected: все PASS (регресс vocabulary не сломан)

- [ ] **Step 5: Линт/типы и коммит**

Run: `cd backend && uv run ruff check . && uv run ruff format . && uv run pyright`

```bash
git add backend/src/flinq/modules/vocabulary/service.py backend/tests/modules/review/test_vocab_sync_integration.py
git commit -m "feat(review): wire review_item lifecycle sync into vocabulary write paths"
```

---

### Task 5: Сервис очереди + дневной счётчик

**Files:**
- Modify: `backend/src/flinq/modules/review/service.py` (добавить)
- Test: `backend/tests/modules/review/test_review_queue.py`

**Interfaces:**
- Consumes: модели Task 1; `UserSettings` (`flinq.modules.identity.models`, `daily_goal_reviews`); `Lesson`, `LessonSegment`, `LessonTokenOccurrence` (`flinq.modules.lesson_library.models`); `TokenItem`, `PhraseItem`, `PersonalTranslation`, `PersonalNote` (`flinq.modules.vocabulary.models`).
- Produces (в `flinq.modules.review.service`):

```python
class LessonNotFound(Exception): ...

@dataclass
class QueueItem:
    review_item_id: uuid.UUID
    item_kind: str
    item_id: uuid.UUID
    text: str
    confidence: int
    translation: str | None
    notes: str | None
    context_sentence: str | None

@dataclass
class DailyInfo:
    limit: int
    done_today: int
    limit_reached: bool

async def get_queue(
    session, *, user_id: uuid.UUID, language_code: str,
    lesson_id: uuid.UUID | None = None, now: datetime | None = None,
) -> tuple[list[QueueItem], DailyInfo]
```

- Константа `MAX_QUEUE_SIZE = 100`.

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/modules/review/test_review_queue.py
"""get_queue: главная очередь (due, сортировка, лимит) и lesson-режим."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.models import UserSettings
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import LessonNotFound, get_queue
from flinq.modules.vocabulary import service as vocab
from flinq.modules.vocabulary.models import PersonalTranslation, PhraseItem, TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    s.add(UserSettings(user_id=user.id))
    await s.flush()
    return user.id


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (
            ReviewEvent, ReviewItem, PersonalTranslation,
            LessonTokenOccurrence, LessonSegment, Lesson, PhraseItem, TokenItem,
        ):
            await s.execute(delete(model))


async def _tracked_token(s: AsyncSession, user_id: uuid.UUID, text: str) -> TokenItem:
    item = await vocab.create_item(
        s, user_id=user_id, kind="token", language_code="pt",
        text=text, status="tracked", confidence=1,
    )
    assert isinstance(item, TokenItem)
    return item


async def _set_due(s: AsyncSession, item_id: uuid.UUID, due: datetime) -> None:
    ri = (
        (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item_id)))
        .scalars()
        .one()
    )
    ri.due_at = due
    await s.commit()


async def test_main_queue_returns_due_sorted_and_skips_not_due():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")
        b = await _tracked_token(s, user_id, "dois")
        c = await _tracked_token(s, user_id, "tres")
        await _set_due(s, a.id, NOW - timedelta(days=1))
        await _set_due(s, b.id, NOW - timedelta(days=2))
        await _set_due(s, c.id, NOW + timedelta(days=1))  # не due
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert [i.text for i in items] == ["dois", "um"]  # старейший due первым
        assert daily.limit == 20 and daily.done_today == 0 and not daily.limit_reached


async def test_queue_includes_translation_and_confidence():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        await vocab.add_translation(
            s, user_id=user_id, kind="token", item_id=item.id,
            target_language_code="ru", translation_text="каждый", source_type="user",
        )
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert items[0].translation == "каждый" and items[0].confidence == 1


async def test_limit_reached_empties_main_queue():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
            .scalars()
            .one()
        )
        for _ in range(20):  # daily_goal_reviews default = 20
            s.add(
                ReviewEvent(
                    review_item_id=ri.id, user_id=user_id, answer_value="correct",
                    previous_confidence=1, new_confidence=2,
                    previous_due_at=NOW, new_due_at=NOW, reviewed_at=NOW,
                )
            )
        await s.commit()
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert items == [] and daily.limit_reached and daily.done_today == 20


async def _lesson_with_occurrence(
    s: AsyncSession, user_id: uuid.UUID, token_text: str
) -> Lesson:
    lesson = Lesson(
        owner_user_id=user_id, language_code="pt",
        title="T", raw_text=f"{token_text} mundo",
    )
    s.add(lesson)
    await s.flush()
    seg = LessonSegment(
        lesson_id=lesson.id, ordinal=0, text=f"{token_text} mundo.",
        start_char_offset=0, end_char_offset=10,
    )
    s.add(seg)
    await s.flush()
    s.add(
        LessonTokenOccurrence(
            lesson_id=lesson.id, segment_id=seg.id, ordinal_in_lesson=0,
            ordinal_in_segment=0, surface_text=token_text, normalized_text=token_text,
            start_char_offset=0, end_char_offset=len(token_text),
        )
    )
    await s.flush()
    return lesson


async def test_lesson_queue_returns_all_tracked_ignoring_due_and_limit():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        await _tracked_token(s, user_id, "fora")  # tracked, но не в уроке
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _set_due(s, item.id, NOW + timedelta(days=3))  # не due — всё равно попадает
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW,
        )
        assert [i.text for i in items] == ["cada"]
        assert items[0].context_sentence is None or "cada" in items[0].context_sentence
        assert not daily.limit_reached


async def test_lesson_queue_foreign_lesson_raises():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, other_id, "cada")
        with pytest.raises(LessonNotFound):
            await get_queue(
                s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW,
            )
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_queue.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_queue'`

- [ ] **Step 3: Реализация — дополнить `modules/review/service.py`**

Добавить импорты:

```python
from dataclasses import dataclass

from sqlalchemy import func

from flinq.modules.identity.models import UserSettings
from flinq.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from flinq.modules.review.models import ReviewEvent
from flinq.modules.vocabulary.models import PersonalNote, PersonalTranslation, PhraseItem, TokenItem
```

И код:

```python
MAX_QUEUE_SIZE = 100
DEFAULT_DAILY_LIMIT = 20


class LessonNotFound(Exception):  # noqa: N818 -- matches vocabulary exception naming
    """Lesson does not exist or is not owned by the user."""


@dataclass
class QueueItem:
    review_item_id: uuid.UUID
    item_kind: str
    item_id: uuid.UUID
    text: str
    confidence: int
    translation: str | None
    notes: str | None
    context_sentence: str | None


@dataclass
class DailyInfo:
    limit: int
    done_today: int
    limit_reached: bool


def _day_start_utc(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


async def _daily_info(
    session: AsyncSession, *, user_id: uuid.UUID, now: datetime
) -> DailyInfo:
    settings = await session.get(UserSettings, user_id)
    limit = settings.daily_goal_reviews if settings is not None else DEFAULT_DAILY_LIMIT
    done_today = (
        await session.execute(
            select(func.count())
            .select_from(ReviewEvent)
            .where(ReviewEvent.user_id == user_id, ReviewEvent.reviewed_at >= _day_start_utc(now))
        )
    ).scalar_one()
    return DailyInfo(limit=limit, done_today=done_today, limit_reached=done_today >= limit)


async def _build_queue_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    rows: list[tuple[ReviewItem, TokenItem | PhraseItem]],
) -> list[QueueItem]:
    """Обогатить пары (review_item, vocab_item) переводом/заметкой/контекстом."""
    settings = await session.get(UserSettings, user_id)
    preferred_target = settings.preferred_translation_language_code if settings else None

    refs = [(ri.item_kind, ri.item_id) for ri, _ in rows]
    translations: dict[tuple[str, uuid.UUID], str] = {}
    notes: dict[tuple[str, uuid.UUID], str] = {}
    if refs:
        t_rows = (
            await session.execute(
                select(PersonalTranslation).where(
                    PersonalTranslation.owner_user_id == user_id,
                    PersonalTranslation.is_primary.is_(True),
                )
            )
        ).scalars()
        for t in t_rows:
            key = (t.item_kind, t.item_id)
            if key not in refs:
                continue
            # предпочесть перевод на preferred_translation_language_code
            if key not in translations or t.target_language_code == preferred_target:
                translations[key] = t.translation_text
        n_rows = (
            await session.execute(
                select(PersonalNote).where(PersonalNote.owner_user_id == user_id)
            )
        ).scalars()
        for n in n_rows:
            if (n.item_kind, n.item_id) in refs:
                notes[(n.item_kind, n.item_id)] = n.note_text

    # Контекст токенов: created_from_occurrence_id -> occurrence -> segment.text
    occ_by_key: dict[tuple[str, uuid.UUID], uuid.UUID] = {
        ("token", item.id): item.created_from_occurrence_id
        for _, item in rows
        if isinstance(item, TokenItem) and item.created_from_occurrence_id is not None
    }
    contexts: dict[uuid.UUID, str] = {}
    if occ_by_key:
        ctx_rows = await session.execute(
            select(LessonTokenOccurrence.id, LessonSegment.text)
            .join(LessonSegment, LessonTokenOccurrence.segment_id == LessonSegment.id)
            .where(LessonTokenOccurrence.id.in_(occ_by_key.values()))
        )
        contexts = {occ_id: seg_text for occ_id, seg_text in ctx_rows.all()}

    out: list[QueueItem] = []
    for ri, item in rows:
        key = (ri.item_kind, ri.item_id)
        text_value = item.token_text if isinstance(item, TokenItem) else item.display_text
        occ_id = occ_by_key.get(key)
        out.append(
            QueueItem(
                review_item_id=ri.id,
                item_kind=ri.item_kind,
                item_id=ri.item_id,
                text=text_value,
                confidence=item.confidence if item.confidence is not None else 0,
                translation=translations.get(key),
                notes=notes.get(key),
                context_sentence=contexts.get(occ_id) if occ_id else None,
            )
        )
    return out


async def get_queue(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: str,
    lesson_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> tuple[list[QueueItem], DailyInfo]:
    now = now or datetime.now(UTC)
    daily = await _daily_info(session, user_id=user_id, now=now)

    if lesson_id is not None:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFound(str(lesson_id))
        stmt = (
            select(ReviewItem, TokenItem)
            .join(TokenItem, ReviewItem.item_id == TokenItem.id)
            .join(
                LessonTokenOccurrence,
                LessonTokenOccurrence.normalized_text == TokenItem.token_text,
            )
            .where(
                LessonTokenOccurrence.lesson_id == lesson_id,
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == "token",
                ReviewItem.is_active.is_(True),
                TokenItem.user_id == user_id,
                TokenItem.language_code == lesson.language_code,
                TokenItem.status == "tracked",
            )
            .distinct()
        )
        pairs = [(ri, item) for ri, item in (await session.execute(stmt)).all()]
        # due первыми, внутри групп — по due_at
        pairs.sort(key=lambda p: (p[0].due_at > now, p[0].due_at))
        # мягкий лимит: lesson-режим не блокируется
        daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily

    if daily.limit_reached:
        return [], daily

    def _due_stmt(kind: str, model: type[TokenItem] | type[PhraseItem]):
        return (
            select(ReviewItem, model)
            .join(model, ReviewItem.item_id == model.id)
            .where(
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == kind,
                ReviewItem.language_code == language_code,
                ReviewItem.is_active.is_(True),
                ReviewItem.due_at <= now,
                model.status == "tracked",
            )
        )

    token_pairs = [(ri, it) for ri, it in (await session.execute(_due_stmt("token", TokenItem))).all()]
    phrase_pairs = [(ri, it) for ri, it in (await session.execute(_due_stmt("phrase", PhraseItem))).all()]
    pairs = sorted(token_pairs + phrase_pairs, key=lambda p: p[0].due_at)
    remaining = max(0, daily.limit - daily.done_today)
    pairs = pairs[: min(remaining, MAX_QUEUE_SIZE)]
    return await _build_queue_items(session, user_id=user_id, rows=pairs), daily
```

Примечание для реализатора: `vocab.add_translation` в тесте — существующая функция `modules/vocabulary/service.py` с сигнатурой `add_translation(session, *, user_id, kind, item_id, target_language_code, translation_text, source_type) -> tuple[PersonalTranslation, bool]` — проверь её фактическую сигнатуру перед использованием и поправь вызов в тесте, если отличается.

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/test_review_queue.py -v`
Expected: 5 PASS

- [ ] **Step 5: Линт/типы и коммит**

Run: `cd backend && uv run ruff check . && uv run ruff format . && uv run pyright`

```bash
git add backend/src/flinq/modules/review/service.py backend/tests/modules/review/test_review_queue.py
git commit -m "feat(review): queue service (due ordering, soft daily limit, lesson scope)"
```

---

### Task 6: Сервис ответа (SM-2 + confidence + graduation + event)

**Files:**
- Modify: `backend/src/flinq/modules/review/service.py` (добавить)
- Test: `backend/tests/modules/review/test_review_answer.py`

**Interfaces:**
- Consumes: `apply_answer`, `state_from_json`, `state_to_json` (Task 2); модели Task 1.
- Produces (в `flinq.modules.review.service`):

```python
class ReviewItemNotFound(Exception): ...

@dataclass
class AnswerResult:
    new_confidence: int | None   # None после graduation
    new_status: str              # 'tracked' | 'known'
    due_at: datetime
    done_today: int

async def answer(
    session, *, user_id: uuid.UUID, review_item_id: uuid.UUID,
    answer_value: str,  # 'correct' | 'wrong' (валидируется на API-слое)
    now: datetime | None = None,
) -> AnswerResult   # коммитит сам
```

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/modules/review/test_review_answer.py
"""answer(): SM-2 + confidence ±1, graduation на c=5, append-only events."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import ReviewItemNotFound, answer
from flinq.modules.vocabulary import service as vocab
from flinq.modules.vocabulary.models import TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


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
        for model in (ReviewEvent, ReviewItem, TokenItem):
            await s.execute(delete(model))


async def _setup(s: AsyncSession, confidence: int = 1) -> tuple[uuid.UUID, TokenItem, ReviewItem]:
    user_id = await _make_user(s)
    item = await vocab.create_item(
        s, user_id=user_id, kind="token", language_code="pt",
        text="cada", status="tracked", confidence=confidence,
    )
    assert isinstance(item, TokenItem)
    ri = (
        (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
        .scalars()
        .one()
    )
    return user_id, item, ri


async def test_correct_bumps_confidence_and_schedules():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=1)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
        assert res.new_confidence == 2 and res.new_status == "tracked"
        assert res.due_at == NOW + timedelta(days=1)
        assert res.done_today == 1
    async with session_scope() as s:
        item_db = (await s.execute(select(TokenItem))).scalars().one()
        assert item_db.confidence == 2
        ri_db = (await s.execute(select(ReviewItem))).scalars().one()
        assert ri_db.last_reviewed_at == NOW
        assert ri_db.algorithm_state_json["repetitions"] == 1
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert (ev.previous_confidence, ev.new_confidence) == (1, 2)
        assert ev.answer_value == "correct"


async def test_wrong_drops_confidence_floor_zero_and_due_now():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=0)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="wrong", now=NOW)
        assert res.new_confidence == 0  # floor
        assert res.due_at == NOW  # снова due сразу


async def test_graduation_at_confidence_five():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=5)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
        assert res.new_status == "known" and res.new_confidence is None
    async with session_scope() as s:
        item_db = (await s.execute(select(TokenItem))).scalars().one()
        assert item_db.status == "known" and item_db.confidence is None
        ri_db = (await s.execute(select(ReviewItem))).scalars().one()
        assert ri_db.is_active is False
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.previous_confidence == 5 and ev.new_confidence is None


async def test_events_are_append_only_across_answers():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=1)
        await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
        # item снова due только через день, но answer по id всё равно валиден
        await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="wrong", now=NOW)
        events = (await s.execute(select(ReviewEvent))).scalars().all()
        assert len(events) == 2


async def test_foreign_or_inactive_item_raises():
    async with session_scope() as s:
        user_id, item, ri = await _setup(s, confidence=5)
        stranger = await _make_user(s)
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=stranger, review_item_id=ri.id, answer_value="correct", now=NOW)
        # graduation деактивирует — повторный ответ по неактивному запрещён
        await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_answer.py -v`
Expected: FAIL — `ImportError: cannot import name 'answer'`

- [ ] **Step 3: Реализация — дополнить `modules/review/service.py`**

Импорты: добавить `from flinq.modules.review.sm2 import apply_answer, state_from_json` (state_to_json/INITIAL_STATE уже есть). Код:

```python
class ReviewItemNotFound(Exception):  # noqa: N818 -- matches vocabulary exception naming
    """Review item does not exist, is inactive, or is not owned by the user."""


_VOCAB_MODEL_BY_KIND: dict[str, type[TokenItem] | type[PhraseItem]] = {
    "token": TokenItem,
    "phrase": PhraseItem,
}


@dataclass
class AnswerResult:
    new_confidence: int | None
    new_status: str
    due_at: datetime
    done_today: int


async def answer(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    review_item_id: uuid.UUID,
    answer_value: str,
    now: datetime | None = None,
) -> AnswerResult:
    now = now or datetime.now(UTC)
    ri = await session.get(ReviewItem, review_item_id)
    if ri is None or ri.user_id != user_id or not ri.is_active:
        raise ReviewItemNotFound(str(review_item_id))
    item = await session.get(_VOCAB_MODEL_BY_KIND[ri.item_kind], ri.item_id)
    if item is None or item.user_id != user_id or item.status != "tracked":
        raise ReviewItemNotFound(str(review_item_id))

    correct = answer_value == "correct"
    prev_confidence = item.confidence if item.confidence is not None else 0
    prev_due = ri.due_at

    new_state, due_at = apply_answer(
        state_from_json(ri.algorithm_state_json), correct=correct, now=now
    )
    ri.algorithm_state_json = state_to_json(new_state)
    ri.due_at = due_at
    ri.last_reviewed_at = now

    new_confidence: int | None
    if correct and prev_confidence >= 5:
        # Graduation (ADR-0005): «верно» при confidence 5 -> known, review закрывается.
        item.status = "known"
        item.confidence = None
        ri.is_active = False
        new_confidence = None
        new_status = "known"
    else:
        new_confidence = min(5, prev_confidence + 1) if correct else max(0, prev_confidence - 1)
        item.confidence = new_confidence
        new_status = "tracked"

    session.add(
        ReviewEvent(
            review_item_id=ri.id,
            user_id=user_id,
            answer_value=answer_value,
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

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/ -v`
Expected: все PASS

- [ ] **Step 5: Линт/типы и коммит**

Run: `cd backend && uv run ruff check . && uv run ruff format . && uv run pyright`

```bash
git add backend/src/flinq/modules/review/service.py backend/tests/modules/review/test_review_answer.py
git commit -m "feat(review): answer service (SM-2 apply, confidence step, graduation, events)"
```

---

### Task 7: API `/api/review` + регистрация

**Files:**
- Create: `backend/src/flinq/modules/review/schemas.py`
- Create: `backend/src/flinq/api/review.py`
- Modify: `backend/src/flinq/main.py` (импорт ~строка 24, include ~строка 71)
- Test: `backend/tests/api/test_review.py`

**Interfaces:**
- Consumes: `get_queue`, `answer`, `LessonNotFound`, `ReviewItemNotFound` (Tasks 5-6).
- Produces HTTP-контракт (используется frontend'ом в Task 8):
  - `GET /api/review/queue?lang=pt[&lesson_id=<uuid>]` → `200 {"items": [{"review_item_id", "item_kind", "item_id", "text", "confidence", "translation", "notes", "context_sentence"}], "daily": {"limit", "done_today", "limit_reached"}}`; `404` чужой/несуществующий урок; `401` без сессии.
  - `POST /api/review/answer {"review_item_id": "<uuid>", "answer": "correct"|"wrong"}` → `200 {"new_confidence", "new_status", "due_at", "done_today"}`; `404` чужой/неактивный item; `422` невалидный answer.

- [ ] **Step 1: Написать падающие тесты**

```python
# backend/tests/api/test_review.py
"""API /api/review (FLQ-7): queue + answer, авторизация, лимит."""

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from flinq.core.db import session_scope
from flinq.main import create_app
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.vocabulary.models import TokenItem


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (ReviewEvent, ReviewItem, TokenItem):
            await s.execute(delete(model))


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test")


async def _register(c: AsyncClient) -> str:
    r = await c.post(
        "/auth/register",
        json={
            "display_name": "T",
            "email": f"{uuid.uuid4().hex}@t.io",
            "password": "abcdefghij",
        },
    )
    assert r.status_code == 201
    csrf = c.cookies.get("flinq_csrf")
    assert csrf
    return csrf


async def _create_tracked(c: AsyncClient, csrf: str, text: str = "cada") -> None:
    r = await c.post(
        "/api/vocabulary/items",
        headers={"X-CSRF-Token": csrf},
        json={
            "kind": "token", "language_code": "pt", "text": text,
            "status": "tracked", "confidence": 1,
        },
    )
    assert r.status_code == 201


async def test_queue_requires_auth():
    async with await _client() as c:
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        assert r.status_code == 401


async def test_queue_returns_due_item_and_daily():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        assert r.status_code == 200
        body = r.json()
        assert body["daily"] == {"limit": 20, "done_today": 0, "limit_reached": False}
        assert len(body["items"]) == 1
        item = body["items"][0]
        assert item["text"] == "cada" and item["confidence"] == 1
        assert item["item_kind"] == "token"


async def test_answer_flow_updates_confidence_and_counts():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf},
            json={"review_item_id": review_item_id, "answer": "correct"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["new_confidence"] == 2 and body["new_status"] == "tracked"
        assert body["done_today"] == 1
        # после ответа item не due — очередь пуста
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        assert r.json()["items"] == []


async def test_answer_invalid_value_422_and_foreign_404():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf},
            json={"review_item_id": review_item_id, "answer": "maybe"},
        )
        assert r.status_code == 422
    async with await _client() as c2:
        csrf2 = await _register(c2)
        r = await c2.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf2},
            json={"review_item_id": review_item_id, "answer": "correct"},
        )
        assert r.status_code == 404


async def test_lesson_queue_unknown_lesson_404():
    async with await _client() as c:
        await _register(c)
        r = await c.get(
            "/api/review/queue",
            params={"lang": "pt", "lesson_id": str(uuid.uuid4())},
        )
        assert r.status_code == 404
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd backend && uv run pytest tests/api/test_review.py -v`
Expected: FAIL — 404 на /api/review/* (роутер не зарегистрирован)

- [ ] **Step 3: Реализация — схемы**

```python
# backend/src/flinq/modules/review/schemas.py
"""Pydantic-схемы API /api/review (FLQ-7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class QueueItemOut(BaseModel):
    review_item_id: uuid.UUID
    item_kind: Literal["token", "phrase"]
    item_id: uuid.UUID
    text: str
    confidence: int
    translation: str | None
    notes: str | None
    context_sentence: str | None


class DailyOut(BaseModel):
    limit: int
    done_today: int
    limit_reached: bool


class QueueResponse(BaseModel):
    items: list[QueueItemOut]
    daily: DailyOut


class AnswerRequest(BaseModel):
    review_item_id: uuid.UUID
    answer: Literal["correct", "wrong"]


class AnswerResponse(BaseModel):
    new_confidence: int | None
    new_status: Literal["tracked", "known"]
    due_at: datetime
    done_today: int
```

- [ ] **Step 4: Реализация — роутер**

```python
# backend/src/flinq/api/review.py
"""SRS review API (FLQ-7)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import get_session
from flinq.modules.review import service
from flinq.modules.review.schemas import (
    AnswerRequest,
    AnswerResponse,
    DailyOut,
    QueueItemOut,
    QueueResponse,
)

router = APIRouter(prefix="/api/review", tags=["review"])

LangCode = Literal["en", "ru", "pt"]


def _require_user(request: Request) -> uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return user_id


@router.get("/queue", response_model=QueueResponse)
async def queue(
    request: Request,
    lang: LangCode,
    session: Annotated[AsyncSession, Depends(get_session)],
    lesson_id: uuid.UUID | None = None,
) -> QueueResponse:
    user_id = _require_user(request)
    try:
        items, daily = await service.get_queue(
            session, user_id=user_id, language_code=lang, lesson_id=lesson_id
        )
    except service.LessonNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return QueueResponse(
        items=[
            QueueItemOut(
                review_item_id=i.review_item_id,
                item_kind=cast('Literal["token", "phrase"]', i.item_kind),
                item_id=i.item_id,
                text=i.text,
                confidence=i.confidence,
                translation=i.translation,
                notes=i.notes,
                context_sentence=i.context_sentence,
            )
            for i in items
        ],
        daily=DailyOut(
            limit=daily.limit, done_today=daily.done_today, limit_reached=daily.limit_reached
        ),
    )


@router.post("/answer", response_model=AnswerResponse)
async def answer(
    request: Request,
    body: AnswerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AnswerResponse:
    user_id = _require_user(request)
    try:
        res = await service.answer(
            session,
            user_id=user_id,
            review_item_id=body.review_item_id,
            answer_value=body.answer,
        )
    except service.ReviewItemNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return AnswerResponse(
        new_confidence=res.new_confidence,
        new_status=cast('Literal["tracked", "known"]', res.new_status),
        due_at=res.due_at,
        done_today=res.done_today,
    )
```

В `backend/src/flinq/main.py`: добавить `from flinq.api.review import router as review_router` (после `reader`, ~строка 23-24) и `app.include_router(review_router)` (после `reader_router`, ~строка 68-71).

- [ ] **Step 5: Прогнать тесты**

Run: `cd backend && uv run pytest tests/api/test_review.py -v`
Expected: 6 PASS

- [ ] **Step 6: Полный backend-регресс, линт/типы, коммит**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run ruff format . && uv run pyright`
Expected: все PASS, чисто.

```bash
git add backend/src/flinq/modules/review/schemas.py backend/src/flinq/api/review.py backend/src/flinq/main.py backend/tests/api/test_review.py
git commit -m "feat(review): /api/review queue + answer endpoints"
```

---

### Task 8: Frontend — api/review.ts, роут, ReviewPage (состояния очереди)

**Files:**
- Create: `frontend/src/api/review.ts`
- Create: `frontend/src/routes/learn.$lang.review.tsx`
- Modify: `frontend/src/routeTree.ts` (импорт + `addChildren`, строки 8-11 и 27)
- Create: `frontend/src/features/review/ReviewPage.tsx`
- Test: `frontend/src/features/review/ReviewPage.test.tsx`

**Interfaces:**
- Consumes: HTTP-контракт Task 7; `api<T>` из `@/api/client`.
- Produces:
  - `reviewApi.queue(lang: string, lessonId?: string): Promise<ReviewQueueResponse>`; `reviewApi.answer(reviewItemId: string, answer: 'correct' | 'wrong'): Promise<ReviewAnswerResponse>`
  - Типы `ReviewQueueItem`, `ReviewDaily`, `ReviewQueueResponse`, `ReviewAnswerResponse`
  - `learnReviewRoute` (path `review`, search `{ lessonId?: string }`)
  - `<ReviewPage lang={string} lessonId={string | undefined} />` — состояния: загрузка, ошибка, пустая очередь, limit_reached, активная сессия (карточки — Task 9).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// frontend/src/features/review/ReviewPage.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', () => ({
  reviewApi: { queue: vi.fn(), answer: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { ReviewPage } from './ReviewPage'

function renderPage(lessonId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReviewPage lang="pt" lessonId={lessonId} />
    </QueryClientProvider>,
  )
}

const DAILY = { limit: 20, done_today: 0, limit_reached: false }
const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: null,
  context_sentence: null,
}

describe('ReviewPage queue states', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when queue is empty', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderPage()
    expect(await screen.findByText('Всё повторено')).toBeTruthy()
  })

  it('shows limit reached state', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({
      items: [],
      daily: { limit: 20, done_today: 20, limit_reached: true },
    })
    renderPage()
    expect(await screen.findByText('Дневной лимит достигнут')).toBeTruthy()
  })

  it('shows error state on queue failure', async () => {
    vi.mocked(reviewApi.queue).mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Не удалось загрузить очередь')).toBeTruthy()
  })

  it('renders first card and progress counter when queue has items', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    renderPage()
    expect(await screen.findByText('cada')).toBeTruthy()
    expect(screen.getByText('1 / 1')).toBeTruthy()
  })

  it('passes lessonId to queue and shows lesson subtitle', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    renderPage('L1')
    expect(await screen.findByText('Слова урока')).toBeTruthy()
    expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1')
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd frontend && pnpm exec vitest run src/features/review/ReviewPage.test.tsx`
Expected: FAIL — `Cannot find module './ReviewPage'`

- [ ] **Step 3: Реализация — api/review.ts**

```ts
// frontend/src/api/review.ts
import { api } from './client'

export interface ReviewQueueItem {
  review_item_id: string
  item_kind: 'token' | 'phrase'
  item_id: string
  text: string
  confidence: number
  translation: string | null
  notes: string | null
  context_sentence: string | null
}

export interface ReviewDaily {
  limit: number
  done_today: number
  limit_reached: boolean
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[]
  daily: ReviewDaily
}

export interface ReviewAnswerResponse {
  new_confidence: number | null
  new_status: 'tracked' | 'known'
  due_at: string
  done_today: number
}

export const reviewApi = {
  queue: (lang: string, lessonId?: string) => {
    const q = new URLSearchParams({ lang })
    if (lessonId) q.set('lesson_id', lessonId)
    return api<ReviewQueueResponse>(`/api/review/queue?${q.toString()}`)
  },
  answer: (reviewItemId: string, answer: 'correct' | 'wrong') =>
    api<ReviewAnswerResponse>('/api/review/answer', {
      method: 'POST',
      body: JSON.stringify({ review_item_id: reviewItemId, answer }),
    }),
}
```

- [ ] **Step 4: Реализация — ReviewPage (без карточки: заглушка текста item)**

```tsx
// frontend/src/features/review/ReviewPage.tsx
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { reviewApi, type ReviewQueueItem } from '@/api/review'

interface Props {
  lang: string
  lessonId: string | undefined
}

interface SessionState {
  items: ReviewQueueItem[]
  idx: number
  correct: number
  wrong: number
}

export function ReviewPage({ lang, lessonId }: Props) {
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['review-queue', lang, lessonId ?? null],
    queryFn: () => reviewApi.queue(lang, lessonId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  // Сессия — локальный снапшот очереди: рефетчи посреди сессии её не трогают.
  const [session, setSession] = useState<SessionState | null>(null)

  useEffect(() => {
    if (data && session === null && data.items.length > 0) {
      setSession({ items: data.items, idx: 0, correct: 0, wrong: 0 })
    }
  }, [data, session])

  const restart = () => {
    setSession(null)
    // Подсветка/списки могли устареть после ответов — сбрасываем перед новой очередью.
    void queryClient.invalidateQueries({ queryKey: ['reader-statuses'] })
    void queryClient.invalidateQueries({ queryKey: ['vocab-list'] })
    void refetch()
  }

  if (isPending) {
    return <Shell lessonId={lessonId}>Загрузка…</Shell>
  }
  if (isError) {
    return (
      <Shell lessonId={lessonId}>
        <p className="text-destructive">Не удалось загрузить очередь</p>
        <button type="button" className="mt-2 underline" onClick={() => void refetch()}>
          Повторить
        </button>
      </Shell>
    )
  }
  if (session === null) {
    if (data.daily.limit_reached) {
      return (
        <Shell lessonId={lessonId}>
          <p className="text-lg font-medium">Дневной лимит достигнут</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Сегодня: {data.daily.done_today} / {data.daily.limit}. Возвращайтесь завтра!
          </p>
        </Shell>
      )
    }
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Всё повторено</p>
        <p className="mt-1 text-sm text-muted-foreground">Нет карточек к повторению.</p>
      </Shell>
    )
  }

  const current = session.items[session.idx]
  if (!current) {
    // Финальный экран — дополняется в Task 9 (кнопка «Повторить ошибки»).
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Сессия завершена</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Верно: {session.correct} · Ошибки: {session.wrong}
        </p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          {lessonId ? 'Пройти ещё раз' : 'Повторить ошибки'}
        </button>
      </Shell>
    )
  }

  return (
    <Shell lessonId={lessonId}>
      <p className="mb-4 text-sm text-muted-foreground">
        {session.idx + 1} / {session.items.length}
      </p>
      {/* Task 9 заменяет этот блок на <ReviewCard …> */}
      <p className="text-2xl">{current.text}</p>
    </Shell>
  )
}

function Shell({ lessonId, children }: { lessonId: string | undefined; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-1 text-xl font-semibold">Повторение</h1>
      {lessonId && <p className="mb-4 text-sm text-muted-foreground">Слова урока</p>}
      {children}
    </div>
  )
}
```

- [ ] **Step 5: Реализация — роут и routeTree**

```tsx
// frontend/src/routes/learn.$lang.review.tsx
import { createRoute, useParams, useSearch } from '@tanstack/react-router'

import { ReviewPage } from '@/features/review/ReviewPage'

import { learnLangRoute } from './learn.$lang'

export const learnReviewRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'review',
  validateSearch: (search: Record<string, unknown>): { lessonId?: string } =>
    typeof search.lessonId === 'string' && search.lessonId ? { lessonId: search.lessonId } : {},
  component: function ReviewView() {
    const params = useParams({ from: '/learn/$lang/review' })
    const { lessonId } = useSearch({ from: '/learn/$lang/review' })
    return <ReviewPage lang={params.lang} lessonId={lessonId} />
  },
})
```

В `frontend/src/routeTree.ts`: добавить `import { learnReviewRoute } from './routes/learn.$lang.review'` и включить в children:

```ts
  learnLangRoute.addChildren([
    learnLibraryRoute,
    learnLessonRoute,
    learnVocabularyRoute,
    learnReviewRoute,
  ]),
```

- [ ] **Step 6: Прогнать тесты и типы**

Run: `cd frontend && pnpm exec vitest run src/features/review/ReviewPage.test.tsx && pnpm exec tsc -b`
Expected: 5 PASS, tsc чисто

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/api/review.ts frontend/src/routes/learn.\$lang.review.tsx frontend/src/routeTree.ts frontend/src/features/review
git commit -m "feat(review-ui): /learn/:lang/review route, queue fetch, empty/limit/error states"
```

---

### Task 9: ReviewCard + флоу сессии (flip, ответы, хоткеи, финальный экран)

**Files:**
- Create: `frontend/src/features/review/ReviewCard.tsx`
- Modify: `frontend/src/features/review/ReviewPage.tsx` (заменить заглушку на карточку + обработчик ответа)
- Test: `frontend/src/features/review/ReviewCard.test.tsx`
- Test: Modify `frontend/src/features/review/ReviewPage.test.tsx` (добавить describe сессии)

**Interfaces:**
- Consumes: `reviewApi.answer` (Task 8), типы Task 8.
- Produces: `<ReviewCard item={ReviewQueueItem} flipped={boolean} answering={boolean} error={string | null} onFlip={() => void} onAnswer={(a: 'correct' | 'wrong') => void} />`.

- [ ] **Step 1: Написать падающие тесты ReviewCard**

```tsx
// frontend/src/features/review/ReviewCard.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReviewCard } from './ReviewCard'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: 'заметка',
  context_sentence: 'Cada dia é único.',
}

function renderCard(over: Partial<Parameters<typeof ReviewCard>[0]> = {}) {
  const props = {
    item: ITEM, flipped: false, answering: false, error: null,
    onFlip: vi.fn(), onAnswer: vi.fn(),
    ...over,
  }
  render(<ReviewCard {...props} />)
  return props
}

describe('ReviewCard', () => {
  it('front shows word and context, no translation', () => {
    renderCard()
    expect(screen.getByText('cada')).toBeTruthy()
    expect(screen.getByText('Cada dia é único.')).toBeTruthy()
    expect(screen.queryByText('каждый')).toBeNull()
    expect(screen.getByRole('button', { name: 'Показать перевод' })).toBeTruthy()
  })

  it('flip button calls onFlip', () => {
    const p = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    expect(p.onFlip).toHaveBeenCalled()
  })

  it('back shows translation, notes and answer buttons', () => {
    const p = renderCard({ flipped: true })
    expect(screen.getByText('каждый')).toBeTruthy()
    expect(screen.getByText('заметка')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '✗ Ошибка' }))
    expect(p.onAnswer).toHaveBeenCalledWith('wrong')
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(p.onAnswer).toHaveBeenCalledWith('correct')
  })

  it('back without translation shows dash', () => {
    renderCard({ flipped: true, item: { ...ITEM, translation: null, notes: null } })
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('answer buttons disabled while answering, error shown', () => {
    const p = renderCard({ flipped: true, answering: true, error: 'Не удалось сохранить ответ' })
    expect(screen.getByText('Не удалось сохранить ответ')).toBeTruthy()
    const btn = screen.getByRole('button', { name: '✓ Знаю' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(p.onAnswer).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `cd frontend && pnpm exec vitest run src/features/review/ReviewCard.test.tsx`
Expected: FAIL — `Cannot find module './ReviewCard'`

- [ ] **Step 3: Реализация ReviewCard**

```tsx
// frontend/src/features/review/ReviewCard.tsx
import type { ReviewQueueItem } from '@/api/review'

interface Props {
  item: ReviewQueueItem
  flipped: boolean
  answering: boolean
  error: string | null
  onFlip: () => void
  onAnswer: (answer: 'correct' | 'wrong') => void
}

export function ReviewCard({ item, flipped, answering, error, onFlip, onAnswer }: Props) {
  return (
    <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
      <p className="text-center text-2xl font-medium">{item.text}</p>
      {!flipped && item.context_sentence && (
        <p className="mt-3 text-center text-sm text-muted-foreground">{item.context_sentence}</p>
      )}
      {!flipped ? (
        <button
          type="button"
          onClick={onFlip}
          className="mt-6 w-full rounded-md border border-border py-3 text-sm hover:bg-accent"
        >
          Показать перевод
        </button>
      ) : (
        <>
          <hr className="my-4 border-border" />
          <p className="text-center text-xl">{item.translation ?? '—'}</p>
          {item.notes && (
            <p className="mt-2 text-center text-sm text-muted-foreground">{item.notes}</p>
          )}
          {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={answering}
              onClick={() => onAnswer('wrong')}
              className="rounded-md border border-border py-4 text-base hover:bg-accent disabled:opacity-50"
            >
              ✗ Ошибка
            </button>
            <button
              type="button"
              disabled={answering}
              onClick={() => onAnswer('correct')}
              className="rounded-md border border-border py-4 text-base hover:bg-accent disabled:opacity-50"
            >
              ✓ Знаю
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Написать падающие тесты флоу сессии (дополнить ReviewPage.test.tsx)**

Добавить в `frontend/src/features/review/ReviewPage.test.tsx` (импорты `fireEvent`, `waitFor` из `@testing-library/react` дополнить):

```tsx
const ITEM2 = { ...ITEM, review_item_id: 'R2', item_id: 'I2', text: 'mundo', translation: 'мир' }

describe('ReviewPage session flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip -> correct answer -> next card -> final screen', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM, ITEM2], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 'correct'))
    expect(await screen.findByText('mundo')).toBeTruthy()
    expect(screen.getByText('2 / 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✗ Ошибка' }))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(screen.getByText('Верно: 1 · Ошибки: 1')).toBeTruthy()
  })

  it('keyboard: Space flips, 2 answers correct', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    await screen.findByText('cada')
    fireEvent.keyDown(window, { key: ' ' })
    expect(await screen.findByRole('button', { name: '✓ Знаю' })).toBeTruthy()
    fireEvent.keyDown(window, { key: '2' })
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 'correct'))
  })

  it('failed answer keeps card and shows retryable error', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(await screen.findByText('Не удалось сохранить ответ')).toBeTruthy()
    expect(screen.getByText('cada')).toBeTruthy() // карточка осталась
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' })) // retry
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
  })
})
```

Run: `cd frontend && pnpm exec vitest run src/features/review/ReviewPage.test.tsx`
Expected: новые тесты FAIL (карточки в ReviewPage ещё нет)

- [ ] **Step 5: Реализация — интегрировать карточку в ReviewPage**

В `ReviewPage.tsx`: добавить импорты `useMutation`, `ReviewCard`, состояние `flipped`/`answerError`, обработчик и хоткеи; заменить блок `<p className="text-2xl">{current.text}</p>`:

```tsx
// добавить в импорты:
import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ReviewCard } from './ReviewCard'

// внутри ReviewPage, после useState session:
const [flipped, setFlipped] = useState(false)
const [answerError, setAnswerError] = useState<string | null>(null)

const answerMutation = useMutation({
  mutationFn: ({ id, a }: { id: string; a: 'correct' | 'wrong' }) => reviewApi.answer(id, a),
  onSuccess: (_res, { a }) => {
    setAnswerError(null)
    setFlipped(false)
    setSession((s) => {
      if (s === null) return s
      const next = {
        ...s,
        idx: s.idx + 1,
        correct: s.correct + (a === 'correct' ? 1 : 0),
        wrong: s.wrong + (a === 'wrong' ? 1 : 0),
      }
      if (next.idx >= next.items.length) {
        // Сессия завершена: подсветка reader и списки словаря должны
        // подтянуть новые confidence/status (spec §6).
        void queryClient.invalidateQueries({ queryKey: ['reader-statuses'] })
        void queryClient.invalidateQueries({ queryKey: ['vocab-list'] })
      }
      return next
    })
  },
  onError: () => setAnswerError('Не удалось сохранить ответ'),
})

const current = session?.items[session.idx]

const handleAnswer = useCallback(
  (a: 'correct' | 'wrong') => {
    if (!current || answerMutation.isPending) return
    answerMutation.mutate({ id: current.review_item_id, a })
  },
  [current, answerMutation],
)

// хоткеи: Space — flip, 1 — ошибка, 2 — знаю (после переворота)
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (!current) return
    if (e.key === ' ') {
      e.preventDefault()
      setFlipped(true)
    } else if (flipped && e.key === '1') {
      handleAnswer('wrong')
    } else if (flipped && e.key === '2') {
      handleAnswer('correct')
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [current, flipped, handleAnswer])
```

Рендер активной сессии:

```tsx
  return (
    <Shell lessonId={lessonId}>
      <p className="mb-4 text-sm text-muted-foreground">
        {session.idx + 1} / {session.items.length}
      </p>
      <ReviewCard
        item={current}
        flipped={flipped}
        answering={answerMutation.isPending}
        error={answerError}
        onFlip={() => setFlipped(true)}
        onAnswer={handleAnswer}
      />
    </Shell>
  )
```

Примечание: объявление `const current = session.items[session.idx]` из Task 8 переносится выше (до хуков), проверка «финальный экран» (`!current`) остаётся после хуков — правила hooks требуют вызова всех хуков до ранних return. Реализатор: перестрой порядок так, чтобы ни один хук не вызывался условно (все `useState`/`useMutation`/`useEffect`/`useCallback` — до первого `return`).

- [ ] **Step 6: Прогнать все тесты фичи + типы**

Run: `cd frontend && pnpm exec vitest run src/features/review && pnpm exec tsc -b`
Expected: все PASS, tsc чисто

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/review
git commit -m "feat(review-ui): ReviewCard flip/answer flow, hotkeys, session summary"
```

---

### Task 10: Mini-review из reader + инвалидация + финальный регресс

**Files:**
- Modify: `frontend/src/features/reader/BottomToolbar.tsx` (кнопка «Повторить лексику», строки 37-56)
- Modify: `frontend/src/features/reader/ReaderPage.tsx` (передать `onReview`, блок `<BottomToolbar …>` ~строка 482)
- Test: Modify `frontend/src/features/reader/ReaderPage.test.tsx` (новый тест)

**Interfaces:**
- Consumes: роут `/learn/$lang/review` (Task 8); `useNavigate` уже есть в ReaderPage (строка 39).
- Produces: `BottomToolbar` принимает новый опциональный проп `onReview?: () => void`; кнопка активна, когда проп передан.

- [ ] **Step 1: Написать падающий тест**

В `frontend/src/features/reader/ReaderPage.test.tsx` — найти существующий describe с рендером ReaderPage (в файле уже есть настройка router/query-моков — использовать её helper) и добавить тест:

```tsx
it('кнопка «Повторить лексику» ведёт на review с lessonId', async () => {
  renderReaderPage() // существующий helper этого файла
  const btn = await screen.findByRole('button', { name: /Повторить лексику/ })
  expect((btn as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(btn)
  // как в файле проверяется навигация (mock useNavigate / router state) —
  // ассерт на переход к /learn/$lang/review с search { lessonId }
})
```

Примечание реализатору: открой `ReaderPage.test.tsx`, посмотри как там мокается навигация (`useNavigate` или реальный router) и напиши ассерт в том же стиле. Если ReaderPage тестируется через реальный router-провайдер — проверь `router.state.location.pathname === '/learn/pt/review'` и `search.lessonId`.

Run: `cd frontend && pnpm exec vitest run src/features/reader/ReaderPage.test.tsx`
Expected: новый тест FAIL (кнопка disabled)

- [ ] **Step 2: Реализация**

`BottomToolbar.tsx` — расширить Props и кнопку:

```tsx
interface Props {
  mode: ViewMode
  onToggleMode: () => void
  /** Сжать сетку действий на ширину открытой боковой панели WordCard. */
  panelOpen?: boolean
  /** Переход к lesson-scoped review (FLQ-7). Кнопка активна, если передан. */
  onReview?: () => void
}

export function BottomToolbar({ mode, onToggleMode, panelOpen, onReview }: Props) {
```

и заменить строку 52:

```tsx
        <Action
          icon="✓"
          label="Повторить лексику"
          onClick={onReview}
          disabled={!onReview}
          title={onReview ? undefined : 'Скоро (FLQ-7)'}
        />
```

`ReaderPage.tsx` — в вызов `<BottomToolbar … />` (~строка 482) добавить проп:

```tsx
      <BottomToolbar
        mode={mode}
        onToggleMode={() => setMode(mode === 'page' ? 'sentence' : 'page')}
        panelOpen={selectedWord !== null}
        onReview={() =>
          void navigate({
            to: '/learn/$lang/review',
            params: { lang },
            search: { lessonId },
          })
        }
      />
```

(`lang` и `lessonId` — существующие переменные ReaderPage; проверь их имена в начале компонента.)

- [ ] **Step 3: Прогнать тесты**

Run: `cd frontend && pnpm exec vitest run src/features/reader/ReaderPage.test.tsx`
Expected: PASS

- [ ] **Step 4: Полный регресс обоих стеков**

Run: `cd frontend && pnpm exec vitest run && pnpm exec tsc -b && pnpm run lint`
Run: `cd backend && uv run pytest && uv run pyright && uv run ruff check .`
Expected: всё PASS/чисто.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/reader/BottomToolbar.tsx frontend/src/features/reader/ReaderPage.tsx frontend/src/features/reader/ReaderPage.test.tsx
git commit -m "feat(review-ui): lesson mini-review entry from reader bottom toolbar"
```

---

## Верификация acceptance criteria FLQ-7 (после Task 10)

| AC | Покрытие |
|---|---|
| #1 review_items active только для tracked; auto-deactivate при known/ignored | Task 3-4 тесты lifecycle + vocab sync |
| #2 SM-2 правильно обновляет confidence и due_at | Task 2 (интервалы/EF) + Task 6 (confidence ±1, floor/cap) |
| #3 POST /api/review/answer — append-only event | Task 6 `test_events_are_append_only_across_answers`, Task 7 API |
| #4 Daily limit; при exceeded — 'limit reached' | Task 5 `test_limit_reached_empties_main_queue` + Task 8 UI-тест |
| #5 /review работает на desktop и mobile | Task 8-9: одна колонка, max-w-xl, крупные кнопки; проверить руками в браузере (см. ниже) |
| #6 Mini-review с фильтром по lesson_id из reader | Task 5 lesson-тесты + Task 10 навигация |

Финальный шаг: живая проверка через `/verify`-скилл или вручную (`uv run flinq serve` + `pnpm dev`): создать tracked-слово в reader, пройти сессию на `/learn/pt/review`, убедиться в смене confidence и подсветки; проверить мобильную ширину в devtools. После этого — чек-лист backlog task finalization (acceptance criteria, final summary, Definition of Done).
