# FLQ-21 — Повторение лексики урока по провенансу: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Повторение из ридера должно повторять слова и фразы, добавленные пользователем **в этом уроке**, а не всё tracked-пересечение словаря с текстом урока.

**Architecture:** В `token_items` и `phrase_items` появляются `created_from_lesson_id` (ключ скоупа, FK на `lessons` с `ON DELETE SET NULL`) и `created_from_segment_id` (контекстное предложение). Провенанс записывается в write-путях vocabulary (`create_item`, `patch_item`, `bulk_mark_known`), ридер шлёт `lesson_id`/`seg_id`. Очередь и счётчики review фильтруются по `created_from_lesson_id`; `lesson_id` становится ортогонален `mode`, поэтому экран выбора режима работает и в скоупе урока.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic + pytest/testcontainers (backend); React 19 + TanStack Router/Query + vitest (frontend).

**Спека:** `docs/superpowers/specs/2026-07-25-lesson-scoped-review-provenance-design.md`
**Задача:** `backlog/tasks/flq-21 - Повторение-лексики-урока-по-провенансу-слова-добавленные-в-уроке.md`

## Global Constraints

- Бэкфилла провенанса нет: у существующих записей `created_from_lesson_id` остаётся `NULL`, и в повторении урока они не участвуют.
- Первый урок выигрывает: непустой `created_from_lesson_id` никогда не перезаписывается.
- Комментарии и пользовательские строки — по-русски, как в окружающем коде.
- Коммиты — точными путями (`git add <paths>`), **без** трейлера `Co-Authored-By`: `backend/uv.lock` лежит staged-но-незакоммиченным и иначе попадёт в коммит.
- Бэкенд-проверки: `cd backend && uv run pytest <path> -v`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`. Тесты поднимают реальный Postgres через testcontainers — первый запуск дольше.
- Фронтенд-проверки: `cd frontend && pnpm vitest run <path>`, `pnpm tsc --noEmit`, `pnpm lint`.
- Тестовые футганы репозитория: локальный `.env` включает `GLOSANO_LLM_ENABLED=true` — тесты, зависящие от `ai_enabled`, обязаны `monkeypatch.setattr(get_settings(), "llm_enabled", False)`; тесты с фиксированным `NOW` обязаны явно выставлять `due_at` (иначе после полудня UTC ловят флейк).
- Не форматировать файлы вне задачи: `ruff format` без пути правит соседние модули — прогонять с явным путём.

---

### Task 1: Колонки провенанса и контекст из сегмента

**Files:**
- Modify: `backend/src/glosano/modules/vocabulary/models.py:33-62` (TokenItem), `:66-95` (PhraseItem)
- Create: `backend/migrations/versions/0014_vocab_lesson_provenance.py`
- Modify: `backend/src/glosano/modules/review/service.py:195-225` (`_build_queue_items`)
- Test: `backend/tests/modules/review/test_review_queue.py`

**Interfaces:**
- Produces: `TokenItem.created_from_lesson_id`, `TokenItem.created_from_segment_id`, `PhraseItem.created_from_lesson_id`, `PhraseItem.created_from_segment_id` (все `uuid.UUID | None`). `TokenItem.created_from_occurrence_id` перестаёт существовать.

- [ ] **Step 1: Написать падающий тест на контекст из сегмента**

В конец `backend/tests/modules/review/test_review_queue.py`:

```python
async def test_queue_context_sentence_comes_from_segment():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        seg_id = (
            await s.execute(select(LessonSegment.id).where(LessonSegment.lesson_id == lesson.id))
        ).scalar_one()
        item.created_from_lesson_id = lesson.id
        item.created_from_segment_id = seg_id
        await _set_due(s, item.id, NOW - timedelta(hours=1))
        await s.commit()
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert [i.context_sentence for i in items] == ["cada mundo."]
```

- [ ] **Step 2: Прогнать тест, убедиться, что падает**

Run: `cd backend && uv run pytest tests/modules/review/test_review_queue.py::test_queue_context_sentence_comes_from_segment -v`
Expected: FAIL — `AttributeError: 'TokenItem' object has no attribute 'created_from_lesson_id'`

- [ ] **Step 3: Добавить поля в модели**

В `TokenItem` заменить строку `created_from_occurrence_id: ...` на:

```python
    created_from_lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="SET NULL")
    )
    created_from_segment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
```

Те же две строки добавить в `PhraseItem` (после `added_by`).

В `__table_args__` обеих моделей добавить индекс (для `PhraseItem` — имя `ix_phrase_items_user_lesson`):

```python
        Index(
            "ix_token_items_user_lesson",
            "user_id",
            "created_from_lesson_id",
            postgresql_where=text("created_from_lesson_id IS NOT NULL"),
        ),
```

`ForeignKey`, `Index`, `text` уже импортированы в файле.

- [ ] **Step 4: Написать миграцию**

`backend/migrations/versions/0014_vocab_lesson_provenance.py`:

```python
"""vocab lesson provenance: created_from_lesson_id / created_from_segment_id

Revision ID: 0014_vocab_lesson_provenance
Revises: 0013_review_quality
Create Date: 2026-07-25 00:00:00.000000

Скоуп повторения урока = слова и фразы, добавленные в этом уроке.
created_from_occurrence_id удаляется: колонка не заполнялась ни одним
write-путём (0 непустых значений), её роль занимает created_from_segment_id.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_vocab_lesson_provenance"
down_revision: str | Sequence[str] | None = "0013_review_quality"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("token_items", "phrase_items")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("created_from_lesson_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("created_from_segment_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table}_created_from_lesson",
            table,
            "lessons",
            ["created_from_lesson_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            f"ix_{table}_user_lesson",
            table,
            ["user_id", "created_from_lesson_id"],
            postgresql_where=sa.text("created_from_lesson_id IS NOT NULL"),
        )
    op.drop_column("token_items", "created_from_occurrence_id")


def downgrade() -> None:
    op.add_column(
        "token_items",
        sa.Column("created_from_occurrence_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    for table in _TABLES:
        op.drop_index(f"ix_{table}_user_lesson", table_name=table)
        op.drop_constraint(f"fk_{table}_created_from_lesson", table, type_="foreignkey")
        op.drop_column(table, "created_from_segment_id")
        op.drop_column(table, "created_from_lesson_id")
```

- [ ] **Step 5: Перевести контекст очереди на сегмент**

В `backend/src/glosano/modules/review/service.py` заменить блок «Контекст токенов» на:

```python
    # Контекст: created_from_segment_id -> lesson_segments.text (слова и фразы)
    seg_by_key: dict[tuple[str, uuid.UUID], uuid.UUID] = {
        (ri.item_kind, item.id): item.created_from_segment_id
        for ri, item in rows
        if item.created_from_segment_id is not None
    }
    contexts: dict[uuid.UUID, str] = {}
    if seg_by_key:
        ctx_rows = await session.execute(
            select(LessonSegment.id, LessonSegment.text).where(
                LessonSegment.id.in_(set(seg_by_key.values()))
            )
        )
        for seg_id, seg_text in ctx_rows.all():
            contexts[seg_id] = seg_text
```

И в цикле сборки `QueueItem` заменить `occ_id = occ_by_key.get(key)` на `seg_id = seg_by_key.get(key)`, а `context_sentence=contexts.get(occ_id) if occ_id else None` — на `context_sentence=contexts.get(seg_id) if seg_id else None`.

- [ ] **Step 6: Применить миграцию и прогнать тест**

Run: `cd backend && uv run alembic upgrade head && uv run pytest tests/modules/review/test_review_queue.py -v`
Expected: PASS, все тесты файла зелёные (старый тест `test_lesson_queue_returns_all_tracked_ignoring_due_and_limit` пока продолжает работать: join по вхождениям ещё на месте).

- [ ] **Step 7: Прогнать регрессию по бэкенду**

Run: `cd backend && uv run pytest -q && uv run ruff check . && uv run pyright`
Expected: всё зелёное. Если pyright ругается на `item.created_from_segment_id` для union-типа — проверить, что поле добавлено в обе модели.

- [ ] **Step 8: Коммит**

```bash
git add backend/src/glosano/modules/vocabulary/models.py backend/src/glosano/modules/review/service.py backend/migrations/versions/0014_vocab_lesson_provenance.py backend/tests/modules/review/test_review_queue.py
git commit -m "feat(vocab): lesson/segment provenance columns, review context from segment"
```

---

### Task 2: Провенанс в `create_item` (POST /api/vocabulary/items)

**Files:**
- Modify: `backend/src/glosano/modules/vocabulary/service.py:36-54` (исключения), `:124-262` (`create_item`)
- Modify: `backend/src/glosano/modules/vocabulary/schemas.py:37-49` (`CreateItemRequest`)
- Modify: `backend/src/glosano/api/vocabulary.py:92-113`
- Test: `backend/tests/modules/test_vocabulary_lesson_provenance.py` (создать), `backend/tests/api/test_vocabulary.py`

**Interfaces:**
- Consumes: колонки из Task 1.
- Produces: `service.LessonNotFound`, `service.InvalidProvenance`; `create_item(..., lesson_id: uuid.UUID | None = None, segment_id: uuid.UUID | None = None)`; хелперы `_validate_provenance(session, *, user_id, lesson_id, segment_id)` и `_apply_provenance(item, *, lesson_id, segment_id, is_new, status)`.

- [ ] **Step 1: Написать падающие тесты сервиса**

Создать `backend/tests/modules/test_vocabulary_lesson_provenance.py`:

```python
"""Провенанс урока в write-путях vocabulary (FLQ-21)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.vocabulary import service
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


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
        for model in (
            ReviewEvent,
            ReviewItem,
            LessonTokenOccurrence,
            LessonSegment,
            Lesson,
            PhraseItem,
            TokenItem,
        ):
            await s.execute(delete(model))


async def _lesson(s: AsyncSession, user_id: uuid.UUID) -> tuple[Lesson, LessonSegment]:
    lesson = Lesson(owner_user_id=user_id, language_code="pt", title="L", raw_text="cada dia")
    s.add(lesson)
    await s.flush()
    seg = LessonSegment(
        lesson_id=lesson.id,
        ordinal=0,
        text="cada dia.",
        start_char_offset=0,
        end_char_offset=9,
    )
    s.add(seg)
    await s.flush()
    return lesson, seg


async def test_create_item_records_lesson_and_segment():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert item.created_from_lesson_id == lesson.id
        assert item.created_from_segment_id == seg.id


async def test_create_phrase_records_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="cada dia",
            status="tracked",
            confidence=1,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert item.created_from_lesson_id == lesson.id


async def test_create_item_rejects_foreign_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson, _ = await _lesson(s, other_id)
        with pytest.raises(service.LessonNotFound):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text="cada",
                status="tracked",
                confidence=1,
                lesson_id=lesson.id,
            )


async def test_create_item_rejects_segment_from_other_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson_a, _ = await _lesson(s, user_id)
        _, seg_b = await _lesson(s, user_id)
        with pytest.raises(service.InvalidProvenance):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text="cada",
                status="tracked",
                confidence=1,
                lesson_id=lesson_a.id,
                segment_id=seg_b.id,
            )


async def test_create_item_rejects_segment_without_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        _, seg = await _lesson(s, user_id)
        with pytest.raises(service.InvalidProvenance):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text="cada",
                status="tracked",
                confidence=1,
                segment_id=seg.id,
            )
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_lesson_provenance.py -v`
Expected: FAIL — `TypeError: create_item() got an unexpected keyword argument 'lesson_id'`

- [ ] **Step 3: Добавить исключения и хелперы в сервис**

В `backend/src/glosano/modules/vocabulary/service.py` после `InvalidPhrase`:

```python
class LessonNotFound(Exception):  # noqa: N818 -- matches sibling exception naming
    """Урок провенанса не существует или не принадлежит пользователю."""


class InvalidProvenance(Exception):  # noqa: N818 -- matches sibling exception naming
    """segment_id не принадлежит lesson_id или передан без него."""
```

Рядом с `_promote_to_user`:

```python
async def _validate_provenance(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    lesson_id: uuid.UUID | None,
    segment_id: uuid.UUID | None,
) -> None:
    if lesson_id is None:
        if segment_id is not None:
            raise InvalidProvenance("segment_id requires lesson_id")
        return
    lesson = await session.get(Lesson, lesson_id)
    if lesson is None or lesson.owner_user_id != user_id:
        raise LessonNotFound(str(lesson_id))
    if segment_id is not None:
        segment = await session.get(LessonSegment, segment_id)
        if segment is None or segment.lesson_id != lesson_id:
            raise InvalidProvenance(str(segment_id))


def _apply_provenance(
    item: VocabItem,
    *,
    lesson_id: uuid.UUID | None,
    segment_id: uuid.UUID | None,
    is_new: bool,
    status: str,
) -> None:
    """Первый урок выигрывает: непустой провенанс не перезаписывается.

    У существующей записи провенанс проставляется только при переводе в
    tracked — слово, отмеченное known в другом месте, не должно приписываться
    уроку только потому, что его в нём открыли.
    """
    if lesson_id is None or item.created_from_lesson_id is not None:
        return
    if not is_new and status != "tracked":
        return
    item.created_from_lesson_id = lesson_id
    item.created_from_segment_id = segment_id
```

Импорт моделей урока (рядом с существующими импортами модуля):

```python
from glosano.modules.lesson_library.models import Lesson, LessonSegment
```

- [ ] **Step 4: Прокинуть провенанс через `create_item`**

Добавить в сигнатуру `create_item` после `confidence`:

```python
    lesson_id: uuid.UUID | None = None,
    segment_id: uuid.UUID | None = None,
```

Сразу после `_check_kind(kind)`:

```python
    await _validate_provenance(
        session, user_id=user_id, lesson_id=lesson_id, segment_id=segment_id
    )
```

И вызвать `_apply_provenance` во **всех шести** ветках `create_item`, каждый раз перед `sync_review_item`:

- ветка существующей фразы (`existing_phrase is not None`) и её двойник в `except IntegrityError` — `_apply_provenance(existing_phrase, lesson_id=lesson_id, segment_id=segment_id, is_new=False, status=status)`;
- новая фраза (сразу после `session.add(phrase)`) — `is_new=True`;
- ветка существующего токена (`existing is not None`) и её двойник в `except IntegrityError` — `is_new=False`;
- новый токен (после `session.add(item)`) — `is_new=True`.

- [ ] **Step 5: Прогнать тесты сервиса**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_lesson_provenance.py -v`
Expected: PASS (5 тестов)

- [ ] **Step 6: Написать падающий тест API**

В `backend/tests/api/test_vocabulary.py` (хелперы `_client`/`_register` уже есть в файле):

```python
async def test_create_item_with_unknown_lesson_returns_404():
    async with await _client() as c:
        csrf = await _register(c)
        r = await c.post(
            "/api/vocabulary/items",
            headers={"X-CSRF-Token": csrf},
            json={
                "kind": "token",
                "language_code": "pt",
                "text": "cada",
                "status": "tracked",
                "confidence": 1,
                "lesson_id": str(uuid.uuid4()),
            },
        )
        assert r.status_code == 404


async def test_create_item_with_segment_without_lesson_returns_422():
    async with await _client() as c:
        csrf = await _register(c)
        r = await c.post(
            "/api/vocabulary/items",
            headers={"X-CSRF-Token": csrf},
            json={
                "kind": "token",
                "language_code": "pt",
                "text": "cada",
                "status": "tracked",
                "confidence": 1,
                "segment_id": str(uuid.uuid4()),
            },
        )
        assert r.status_code == 422
```

Случай «сегмент из другого урока» покрыт тестом сервиса (Step 1) — на уровне API он повторяет тот же путь валидации.

- [ ] **Step 7: Прокинуть поля через схему и роут**

`schemas.py`, в `CreateItemRequest` перед валидатором:

```python
    lesson_id: uuid.UUID | None = None
    segment_id: uuid.UUID | None = None
```

(в файле должен быть `import uuid`; если нет — добавить).

`api/vocabulary.py`, в вызове `service.create_item` добавить `lesson_id=body.lesson_id, segment_id=body.segment_id`, и расширить обработку исключений:

```python
    except service.LessonNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "lesson not found") from None
    except service.InvalidProvenance:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "segment does not belong to lesson"
        ) from None
```

- [ ] **Step 8: Прогнать тесты и линтеры**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_lesson_provenance.py tests/api/test_vocabulary.py -v && uv run ruff check . && uv run pyright`
Expected: PASS

- [ ] **Step 9: Коммит**

```bash
git add backend/src/glosano/modules/vocabulary/service.py backend/src/glosano/modules/vocabulary/schemas.py backend/src/glosano/api/vocabulary.py backend/tests/modules/test_vocabulary_lesson_provenance.py backend/tests/api/test_vocabulary.py
git commit -m "feat(vocab): record lesson provenance on item create"
```

---

### Task 3: Провенанс в `patch_item` (PATCH /api/vocabulary/items/{kind}/{id})

**Files:**
- Modify: `backend/src/glosano/modules/vocabulary/service.py:264-287` (`patch_item`)
- Modify: `backend/src/glosano/modules/vocabulary/schemas.py:51-60` (`PatchItemRequest`)
- Modify: `backend/src/glosano/api/vocabulary.py:116-136`
- Test: `backend/tests/modules/test_vocabulary_lesson_provenance.py`

**Interfaces:**
- Consumes: `_validate_provenance`, `_apply_provenance` из Task 2.
- Produces: `patch_item(..., lesson_id: uuid.UUID | None = None, segment_id: uuid.UUID | None = None)`.

- [ ] **Step 1: Написать падающие тесты**

В `backend/tests/modules/test_vocabulary_lesson_provenance.py`:

```python
async def test_patch_to_tracked_fills_empty_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="known",
            confidence=None,
        )
        assert item.created_from_lesson_id is None
        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="tracked",
            confidence=1,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert patched.created_from_lesson_id == lesson.id
        assert patched.created_from_segment_id == seg.id


async def test_patch_does_not_overwrite_existing_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson_a, seg_a = await _lesson(s, user_id)
        lesson_b, seg_b = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
            lesson_id=lesson_a.id,
            segment_id=seg_a.id,
        )
        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="tracked",
            confidence=3,
            lesson_id=lesson_b.id,
            segment_id=seg_b.id,
        )
        assert patched.created_from_lesson_id == lesson_a.id
        assert patched.created_from_segment_id == seg_a.id


async def test_patch_to_known_does_not_set_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="ignored",
            confidence=None,
        )
        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="known",
            confidence=None,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert patched.created_from_lesson_id is None
```

- [ ] **Step 2: Прогнать, убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_lesson_provenance.py -k patch -v`
Expected: FAIL — `TypeError: patch_item() got an unexpected keyword argument 'lesson_id'`

- [ ] **Step 3: Реализовать**

В `patch_item` добавить параметры `lesson_id`/`segment_id` (те же дефолты) и вставить после `_check_kind(kind)` / получения `item`:

```python
    await _validate_provenance(
        session, user_id=user_id, lesson_id=lesson_id, segment_id=segment_id
    )
    item = await _owned_item(session, user_id=user_id, kind=kind, item_id=item_id)
    item.status = status
    item.confidence = confidence
    _apply_provenance(
        item, lesson_id=lesson_id, segment_id=segment_id, is_new=False, status=status
    )
```

В `schemas.PatchItemRequest` добавить те же два поля, что в `CreateItemRequest`. В `api/vocabulary.py` передать их в `service.patch_item` и добавить те же два `except`-блока, что в Task 2 (404 для `LessonNotFound`, 422 для `InvalidProvenance`), сохранив существующий `except service.ItemNotFound`.

- [ ] **Step 4: Прогнать тесты и линтеры**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_lesson_provenance.py -v && uv run ruff check . && uv run pyright`
Expected: PASS (8 тестов)

- [ ] **Step 5: Коммит**

```bash
git add backend/src/glosano/modules/vocabulary/service.py backend/src/glosano/modules/vocabulary/schemas.py backend/src/glosano/api/vocabulary.py backend/tests/modules/test_vocabulary_lesson_provenance.py
git commit -m "feat(vocab): record lesson provenance on item patch"
```

---

### Task 4: Провенанс в `bulk_mark_known`

**Files:**
- Modify: `backend/src/glosano/modules/reader_state/bulk.py:48-68`
- Test: `backend/tests/modules/test_vocabulary_provenance.py`

**Interfaces:**
- Consumes: колонки из Task 1.

- [ ] **Step 1: Написать падающий тест**

В `backend/tests/modules/test_vocabulary_provenance.py` (файл уже покрывает `added_by`, хелперы `_make_user`, `_lesson_with_words` там есть):

```python
async def test_bulk_known_records_lesson_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson = await _lesson_with_words(s, user_id, ["cada", "porta"])
        await bulk.bulk_mark_known(s, user_id=user_id, lesson=lesson, from_ordinal=0, to_ordinal=1)
        items = (await s.execute(select(TokenItem).where(TokenItem.user_id == user_id))).scalars()
        assert {i.created_from_lesson_id for i in items} == {lesson.id}
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_provenance.py::test_bulk_known_records_lesson_provenance -v`
Expected: FAIL — `assert {None} == {lesson.id}`

- [ ] **Step 3: Реализовать**

В словарь значений `pg_insert(TokenItem).values([...])` добавить ключ:

```python
                        "created_from_lesson_id": lesson.id,
```

`created_from_segment_id` не проставляем: bulk-действие относится к диапазону страницы, а не к одному предложению.

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/test_vocabulary_provenance.py tests/api/test_reader_bulk.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add backend/src/glosano/modules/reader_state/bulk.py backend/tests/modules/test_vocabulary_provenance.py
git commit -m "feat(reader): record lesson provenance for bulk-known items"
```

---

### Task 5: Очередь урока — фильтр по провенансу

**Files:**
- Modify: `backend/src/glosano/modules/review/service.py:243-270` (lesson-ветка `get_queue`)
- Test: `backend/tests/modules/review/test_review_queue.py:168-185`

**Interfaces:**
- Produces: lesson-режим `get_queue` возвращает пары обоих видов, отобранные по `model.created_from_lesson_id == lesson_id`.

- [ ] **Step 1: Переписать тесты lesson-режима**

Заменить `test_lesson_queue_returns_all_tracked_ignoring_due_and_limit` на:

```python
async def _attach(s: AsyncSession, item: TokenItem | PhraseItem, lesson: Lesson) -> None:
    item.created_from_lesson_id = lesson.id
    await s.commit()


async def test_lesson_queue_returns_items_added_in_lesson_ignoring_due():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, item, lesson)
        await _set_due(s, item.id, NOW + timedelta(days=3))  # не due — всё равно попадает
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]
        assert not daily.limit_reached


async def test_lesson_queue_excludes_word_added_in_another_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await _tracked_token(s, user_id, "cada")
        foreign = await _tracked_token(s, user_id, "mundo")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        other = await _lesson_with_occurrence(s, user_id, "mundo")
        await _attach(s, mine, lesson)
        await _attach(s, foreign, other)
        # "mundo" встречается в тексте первого урока ("cada mundo"), но добавлено в другом
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]


async def test_lesson_queue_includes_phrase_added_in_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        phrase = await vocab.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="cada mundo",
            status="tracked",
            confidence=1,
        )
        assert isinstance(phrase, PhraseItem)
        await _attach(s, phrase, lesson)
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada mundo"]


async def test_lesson_queue_excludes_items_without_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        assert items == []
```

`test_lesson_queue_foreign_lesson_raises` остаётся без изменений.

- [ ] **Step 2: Прогнать, убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_queue.py -k lesson -v`
Expected: FAIL — `test_lesson_queue_excludes_word_added_in_another_lesson` и `..._without_provenance` возвращают лишние элементы, `..._includes_phrase...` — пустой список.

- [ ] **Step 3: Переписать lesson-ветку `get_queue`**

Заменить тело `if lesson_id is not None:` на:

```python
    if lesson_id is not None:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFound(str(lesson_id))
        pairs: list[tuple[ReviewItem, TokenItem | PhraseItem]] = []
        for kind, model in VOCAB_MODEL_BY_KIND.items():
            stmt = (
                select(ReviewItem, model)
                .join(model, ReviewItem.item_id == model.id)
                .where(
                    ReviewItem.user_id == user_id,
                    ReviewItem.item_kind == kind,
                    ReviewItem.is_active.is_(True),
                    model.status == "tracked",
                    model.created_from_lesson_id == lesson_id,
                )
            )
            pairs.extend((ri, it) for ri, it in (await session.execute(stmt)).all())
        # due первыми, внутри групп — по due_at
        pairs.sort(key=lambda p: (p[0].due_at > now, p[0].due_at))
        # мягкий лимит: lesson-режим не блокируется
        daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily
```

Язык теперь не фильтруется отдельно: провенанс уже привязан к уроку, а урок — к языку. Удалить из импортов файла `LessonTokenOccurrence`, если он больше нигде не используется (`grep -n LessonTokenOccurrence backend/src/glosano/modules/review/service.py`).

- [ ] **Step 4: Прогнать тесты**

Run: `cd backend && uv run pytest tests/modules/review/ -v && uv run ruff check . && uv run pyright`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add backend/src/glosano/modules/review/service.py backend/tests/modules/review/test_review_queue.py
git commit -m "feat(review): scope lesson queue by vocabulary provenance"
```

---

### Task 6: `lesson_id` × `mode` и счётчики урока

**Files:**
- Modify: `backend/src/glosano/modules/review/service.py` (`get_queue` — валидация урока и `_mode_stmt`; `get_counts`)
- Modify: `backend/src/glosano/api/review.py:40-56` (queue), `:99-107` (counts)
- Test: `backend/tests/modules/review/test_review_queue.py`, `backend/tests/api/test_review.py`

**Interfaces:**
- Produces: `get_counts(session, *, user_id, language_code, lesson_id: uuid.UUID | None = None, now=None)`; `GET /api/review/counts?lang=&lesson_id=`.

- [ ] **Step 1: Написать падающие тесты**

```python
async def test_new_mode_respects_lesson_scope():
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await _tracked_token(s, user_id, "cada")
        await _tracked_token(s, user_id, "mundo")  # без провенанса
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, mine, lesson)
        items, _ = await get_queue(
            s, user_id=user_id, language_code="pt", mode="new", lesson_id=lesson.id, now=NOW
        )
        assert [i.text for i in items] == ["cada"]


async def test_counts_respect_lesson_scope():
    async with session_scope() as s:
        user_id = await _make_user(s)
        mine = await _tracked_token(s, user_id, "cada")
        await _tracked_token(s, user_id, "mundo")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _attach(s, mine, lesson)
        await _set_due(s, mine.id, NOW - timedelta(hours=1))
        scoped = await get_counts(
            s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW
        )
        overall = await get_counts(s, user_id=user_id, language_code="pt", now=NOW)
        assert scoped.due == 1 and scoped.new == 1
        assert overall.new == 2


async def test_counts_foreign_lesson_raises():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, other_id, "cada")
        with pytest.raises(LessonNotFound):
            await get_counts(s, user_id=user_id, language_code="pt", lesson_id=lesson.id, now=NOW)
```

- [ ] **Step 2: Прогнать, убедиться, что падают**

Run: `cd backend && uv run pytest tests/modules/review/test_review_queue.py -k "lesson_scope or foreign_lesson" -v`
Expected: FAIL — `TypeError: get_counts() got an unexpected keyword argument 'lesson_id'`

- [ ] **Step 3: Вынести проверку урока и добавить фильтр в `_mode_stmt`**

В `get_queue` поднять проверку владения уроком выше диспетчеризации режимов:

```python
    now = now or datetime.now(UTC)
    daily = await _daily_info(session, user_id=user_id, now=now)

    if lesson_id is not None:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFound(str(lesson_id))
```

и убрать повторную проверку из lesson-ветки (`lesson` там больше не нужен). Условие `if lesson_id is not None:` для due-очереди остаётся ниже, но уже без `session.get`.

В `_mode_stmt` добавить скоуп:

```python
    def _mode_stmt(kind: str, model: type[TokenItem] | type[PhraseItem]):
        stmt = (
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
        if lesson_id is not None:
            stmt = stmt.where(model.created_from_lesson_id == lesson_id)
        return stmt
```

В `get_counts` добавить параметр `lesson_id: uuid.UUID | None = None`, ту же проверку владения уроком в начале и в `_count` — `*( [model.created_from_lesson_id == lesson_id] if lesson_id is not None else [] )` внутри `where`.

- [ ] **Step 4: Прокинуть параметр в API**

В `backend/src/glosano/api/review.py` в эндпоинт `counts` добавить `lesson_id: uuid.UUID | None = None`, передать в `service.get_counts` и обернуть вызов тем же `try/except service.LessonNotFound → 404`, что в `queue`.

- [ ] **Step 5: Написать тест API**

В `backend/tests/api/test_review.py` (хелперы `_client`/`_register` уже есть в файле):

```python
async def test_counts_with_unknown_lesson_returns_404():
    async with await _client() as c:
        await _register(c)
        r = await c.get(
            "/api/review/counts", params={"lang": "pt", "lesson_id": str(uuid.uuid4())}
        )
        assert r.status_code == 404
```

- [ ] **Step 6: Прогнать тесты и линтеры**

Run: `cd backend && uv run pytest tests/modules/review/ tests/api/test_review.py -v && uv run ruff check . && uv run pyright`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add backend/src/glosano/modules/review/service.py backend/src/glosano/api/review.py backend/tests/modules/review/test_review_queue.py backend/tests/api/test_review.py
git commit -m "feat(review): lesson scope for new/practice modes and counts"
```

---

### Task 7: Ридер отправляет провенанс

**Files:**
- Modify: `frontend/src/api/vocabulary.ts:86-92`
- Modify: `frontend/src/features/reader/useWordCard.ts:25-56`
- Modify: `frontend/src/features/reader/WordCard.tsx:14-37`
- Modify: `frontend/src/features/reader/ReaderPage.tsx:175-184` (мемо), `:494-502` (проп)
- Test: `frontend/src/features/reader/WordCard.test.tsx`, `frontend/src/features/reader/ReaderPage.test.tsx`

**Interfaces:**
- Consumes: API из Task 2/3.
- Produces: `useWordCardMutations({ ..., lessonId, segId })`; `WordCard` получает проп `segId: string | null`.

- [ ] **Step 1: Написать падающий тест**

В `frontend/src/features/reader/WordCard.test.tsx` (по образцу существующей проверки вызова `createItem`):

```tsx
it('передаёт lesson_id и segment_id при добавлении слова', async () => {
  vi.mocked(vocabularyApi.createItem).mockResolvedValue({ item_id: 'I1', status: 'tracked', confidence: 1 })
  renderCard({ lessonId: 'L1', segId: 'S1' })
  await userEvent.click(await screen.findByRole('button', { name: /Учить/ }))
  await waitFor(() => {
    expect(vocabularyApi.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ lesson_id: 'L1', segment_id: 'S1' }),
    )
  })
})
```

Имя кнопки и хелпер `renderCard` взять из соседних тестов файла — не выдумывать новые.

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `cd frontend && pnpm vitest run src/features/reader/WordCard.test.tsx -t "lesson_id"`
Expected: FAIL — вызов без `lesson_id`/`segment_id`

- [ ] **Step 3: Расширить API-клиент**

В `frontend/src/api/vocabulary.ts`:

```ts
  createItem: (body: {
    kind: ItemKind; language_code: string; text: string
    status: WriteStatus; confidence: number | null
    lesson_id?: string; segment_id?: string
  }) => api<ItemState>('/api/vocabulary/items', { method: 'POST', body: JSON.stringify(body) }),
  patchItem: (
    kind: ItemKind,
    id: string,
    body: {
      status: WriteStatus; confidence: number | null
      lesson_id?: string; segment_id?: string
    },
  ) =>
    api<ItemState>(`/api/vocabulary/items/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
```

- [ ] **Step 4: Передать провенанс из карточки**

В `useWordCard.ts` добавить в `opts` поле `segId: string | null` и в `setStatus.mutationFn`:

```ts
      v.itemId === null
        ? vocabularyApi.createItem({
            kind: opts.kind, language_code: opts.lang, text: opts.surfaceText,
            status: v.status, confidence: v.confidence,
            lesson_id: opts.lessonId ?? undefined, segment_id: opts.segId ?? undefined,
          })
        : vocabularyApi.patchItem(opts.kind, v.itemId, {
            status: v.status, confidence: v.confidence,
            lesson_id: opts.lessonId ?? undefined, segment_id: opts.segId ?? undefined,
          }),
```

В `WordCard.tsx` добавить проп `segId: string | null` в `Props` и в деструктуризацию, и передать в `useWordCardMutations({ ..., lessonId, segId })`.

- [ ] **Step 5: Вычислить `segId` в ридере**

В `ReaderPage.tsx` рядом с `selectedSentenceText`:

```tsx
  const selectedSegId = useMemo(() => {
    if (!selectedWord) return null
    const sentence = flatSentences.find((s) =>
      s.tokens.some((tok) => isWord(tok) && tok.i === selectedWord.i),
    )
    return sentence?.seg_id ?? null
  }, [selectedWord, flatSentences])
```

Поиск по ординалу работает и для фразы: `SelectedItem.i` для фразы — ординал её первого слова. Передать `segId={selectedSegId}` в `<WordCard …>`.

- [ ] **Step 6: Тест ридера на фразу**

В `frontend/src/features/reader/ReaderPage.test.tsx` — тест, что при добавлении **фразы** `createItem` получает `lesson_id` и `segment_id` того предложения, в котором фраза выделена (использовать существующий сценарий выделения фразы в этом файле).

- [ ] **Step 7: Прогнать тесты и типы**

Run: `cd frontend && pnpm vitest run src/features/reader/ && pnpm tsc --noEmit && pnpm lint`
Expected: PASS

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/api/vocabulary.ts frontend/src/features/reader/useWordCard.ts frontend/src/features/reader/WordCard.tsx frontend/src/features/reader/ReaderPage.tsx frontend/src/features/reader/WordCard.test.tsx frontend/src/features/reader/ReaderPage.test.tsx
git commit -m "feat(reader): send lesson and segment provenance when adding vocabulary"
```

---

### Task 8: Экран выбора режима в скоупе урока

**Files:**
- Modify: `frontend/src/api/review.ts:82` (`counts`)
- Modify: `frontend/src/features/review/ModeSelect.tsx`
- Modify: `frontend/src/features/review/ReviewPage.tsx:19-27`
- Modify: `frontend/src/features/review/NewWordsSession.tsx:9-10`, `QuizSession.tsx:17-18`, `TranslationSession.tsx:13-20`
- Test: `frontend/src/features/review/ModeSelect.test.tsx`, `ReviewPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/review/counts?lesson_id=` из Task 6.
- Produces: `ModeSelect({ lang, lessonId })`, `NewWordsSession({ lang, lessonId })`, `QuizSession({ lang, kind, lessonId })`, `TranslationSession({ lang, lessonId })` — во всех `lessonId?: string`.

- [ ] **Step 1: Написать падающие тесты**

`ModeSelect.test.tsx`:

```tsx
it('в скоупе урока запрашивает счётчики урока и сохраняет lessonId при переходе', async () => {
  vi.mocked(reviewApi.counts).mockResolvedValue({ due: 2, new: 1, practice: 0, ai_enabled: true })
  render(<ModeSelect lang="pt" lessonId="L1" />, { wrapper })
  await waitFor(() => expect(reviewApi.counts).toHaveBeenCalledWith('pt', 'L1'))
  await userEvent.click(await screen.findByRole('button', { name: /Карточки/ }))
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ search: { mode: 'cards', lessonId: 'L1' } }),
  )
})
```

`ReviewPage.test.tsx` — заменить ожидание «lessonId сразу открывает карточки» на:

```tsx
it('с lessonId без mode показывает выбор режима в скоупе урока', async () => {
  renderPage({ lessonId: 'L1' })
  expect(await screen.findByText('Слова урока')).toBeInTheDocument()
})

it('с lessonId и mode=cards грузит очередь урока', async () => {
  renderPage({ lessonId: 'L1', mode: 'cards' })
  await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1', undefined))
})
```

- [ ] **Step 2: Прогнать, убедиться, что падают**

Run: `cd frontend && pnpm vitest run src/features/review/ModeSelect.test.tsx src/features/review/ReviewPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Реализовать**

`api/review.ts`:

```ts
  counts: (lang: string, lessonId?: string) => {
    const q = new URLSearchParams({ lang })
    if (lessonId) q.set('lesson_id', lessonId)
    return api<ReviewCounts>(`/api/review/counts?${q.toString()}`)
  },
```

`ModeSelect.tsx`:

```tsx
export function ModeSelect({ lang, lessonId }: { lang: string; lessonId?: string }) {
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['review-counts', lang, lessonId ?? null],
    queryFn: () => reviewApi.counts(lang, lessonId),
  })
```

заголовок:

```tsx
      <h1 className="mb-1 text-center text-xl font-semibold">Повторение</h1>
      {lessonId && <p className="mb-6 text-center text-sm text-muted-foreground">Слова урока</p>}
```

(без `lessonId` оставить прежний отступ `mb-6` у заголовка), и переход:

```tsx
                  search: { mode: m.mode, ...(lessonId ? { lessonId } : {}) },
```

`ReviewPage.tsx`:

```tsx
export function ReviewPage({ lang, lessonId, mode }: Props) {
  if (!mode) return <ModeSelect lang={lang} lessonId={lessonId} />
  if (mode === 'cards') return <CardsSession lang={lang} lessonId={lessonId} />
  if (mode === 'new') return <NewWordsSession lang={lang} lessonId={lessonId} />
  if (mode === 'cloze') return <QuizSession lang={lang} kind="cloze" lessonId={lessonId} />
  if (mode === 'reverse') return <QuizSession lang={lang} kind="reverse" lessonId={lessonId} />
  return <TranslationSession lang={lang} lessonId={lessonId} />
}
```

В `NewWordsSession`/`QuizSession` добавить проп `lessonId?: string`, передать в `useReviewSession(lang, { serverMode: …, lessonId })` и подставлять подзаголовок «Слова урока» рядом с существующим (например, `` `${SUBTITLES[kind]} · Слова урока` ``, когда `lessonId` задан).

В `TranslationSession` — проп `lessonId?: string`, ключ запроса `['review-queue', lang, 'practice', lessonId ?? null]` и вызов `reviewApi.queue(lang, lessonId, 'practice')`.

- [ ] **Step 4: Прогнать тесты и типы**

Run: `cd frontend && pnpm vitest run src/features/review/ && pnpm tsc --noEmit && pnpm lint`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/api/review.ts frontend/src/features/review/
git commit -m "feat(review-ui): lesson-scoped mode select and sessions"
```

---

### Task 9: Пустой экран урока и финальная верификация

**Files:**
- Modify: `frontend/src/features/review/sessionUi.tsx:138-189` (`SessionStates`)
- Modify: `frontend/src/features/review/ReviewPage.tsx`, `NewWordsSession.tsx`, `QuizSession.tsx` (передать `lang` в `SessionStates`)
- Test: `frontend/src/features/review/ReviewPage.test.tsx`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: `SessionStates(s, subtitle, { lessonId?, showWriting?, lang? })`.

- [ ] **Step 1: Написать падающий тест**

```tsx
it('пустая очередь урока предлагает повторить весь словарь', async () => {
  vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: { limit: 20, done_today: 0, limit_reached: false } })
  renderPage({ lessonId: 'L1', mode: 'cards' })
  expect(await screen.findByText('В этом уроке пока нет слов')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Повторить весь словарь/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `cd frontend && pnpm vitest run src/features/review/ReviewPage.test.tsx -t "весь словарь"`
Expected: FAIL — на экране «Всё повторено»

- [ ] **Step 3: Реализовать**

В `sessionUi.tsx` расширить `opts` до `{ lessonId?: string; showWriting?: boolean; lang?: string }` и заменить ветку `empty`:

```tsx
  if (s.status === 'empty') {
    if (opts?.lessonId) {
      return (
        <SessionShell subtitle={subtitle}>
          <p className="text-lg font-medium">В этом уроке пока нет слов</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Добавьте слова во время чтения — они появятся здесь.
          </p>
          {opts.lang && (
            <Link
              to="/learn/$lang/review"
              params={{ lang: opts.lang }}
              search={{}}
              className="mt-3 inline-block underline"
            >
              Повторить весь словарь
            </Link>
          )}
        </SessionShell>
      )
    }
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">Всё повторено</p>
        <p className="mt-1 text-sm text-muted-foreground">Нет карточек к повторению.</p>
      </SessionShell>
    )
  }
```

`import { Link } from '@tanstack/react-router'` добавить в файл. Во всех вызовах `SessionStates(...)` (ReviewPage, NewWordsSession, QuizSession) передать `lang`.

- [ ] **Step 4: Полная регрессия**

Run:
```bash
cd backend && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright
cd ../frontend && pnpm vitest run && pnpm tsc --noEmit && pnpm lint
```
Expected: всё зелёное. Ожидаемое число тестов не меньше, чем до задачи (backend 318+, frontend 207+).

- [ ] **Step 5: Живая проверка по `.claude/skills/verify/SKILL.md`**

```bash
cd backend && uv run alembic upgrade head
cd ../frontend && pnpm build
cd ../backend && GLOSANO_STATIC_DIR=$PWD/../frontend/dist uv run uvicorn glosano.main:app --port 8001
```

Сценарий в браузере: открыть урок → добавить слово и фразу → «Повторить лексику» → убедиться, что экран выбора режима показывает «Слова урока» и счётчики равны добавленному, карточка показывает контекстное предложение, а слово из другого урока в очереди не появляется. Затем открыть урок, где ничего не добавлено, — должен быть пустой экран со ссылкой на весь словарь.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/review/
git commit -m "feat(review-ui): lesson empty state with link to full review"
```

---

## Self-Review

- **Покрытие спеки:** §3 данные → Task 1; §4 захват (create/patch/bulk/ридер) → Tasks 2, 3, 4, 7; §5 очередь и счётчики → Tasks 5, 6; §6 экран → Tasks 8, 9; §7 тесты — распределены по задачам; §8 вне скоупа — ничего не реализуем.
- **Согласованность имён:** `created_from_lesson_id` / `created_from_segment_id` (бэкенд), `lesson_id` / `segment_id` (API и тело запросов), `lessonId` / `segId` (фронтенд) — используются одинаково во всех задачах.
- **Порядок:** Task 1 обязателен первым (колонки); Tasks 2–4 независимы между собой; Task 5 зависит от 1; Task 6 — от 5; Task 7 — от 2–3; Task 8 — от 6; Task 9 — от 8.
