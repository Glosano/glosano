# FLQ-8a: прогресс чтения в карточке библиотеки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карточка урока в библиотеке показывает реальный процент прочитанного, число слов в тексте и число новых слов на непрочитанном остатке — вместо захардкоженного `0%`.

**Architecture:** Обе величины считаются на лету одним агрегатом на страницу списка `GET /api/lessons`: `lesson_token_occurrences` соединяется с `reader_positions` (позиция) и `token_items` (что уже в словаре). Новых таблиц и миграций нет — признак «новое слово» принадлежит паре (user, language), а не уроку, поэтому хранимый счётчик пришлось бы инвалидировать веером по всем урокам языка при каждом изменении статуса.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 (async) / Postgres 16 / pytest + testcontainers; React 19 / TanStack Query / Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-25-library-reading-progress-design.md`

## Global Constraints

- Единица измерения позиции всюду — `lesson_token_occurrences.ordinal_in_lesson`; она же приезжает на фронт как `i` в проводном контракте ридера (`reader_state/content.py:69`). Другой системы координат в этой задаче нет.
- Якорь прогресса — сохранённый `reader_positions.current_token_ordinal` (начало текущей страницы). Оба числа карточки считаются от него же. `toOrdinal` не используется.
- «Новое слово» = отсутствие строки в `token_items` для `(user_id, language_code, token_text)`. Считаются **уникальные** слова, не словоупотребления.
- Никаких миграций, никаких новых таблиц. Если задача упирается в необходимость миграции — остановиться и вернуться к спеке.
- Формула процента обязана совпадать с ридером (`frontend/src/features/reader/ReaderPage.tsx:133-137`), включая вырожденные случаи.
- Коммиты — Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`). Трейлеры `Co-Authored-By` не добавлять. Коммитить точными путями, не `git add -A`: в репозитории есть staged-but-uncommitted `backend/uv.lock`, который иначе утянет в коммит.
- Команды: бэкенд — `cd backend && uv run pytest`, `uv run ruff check .`, `uv run pyright`; фронт — `cd frontend && pnpm test`, `pnpm lint`.

---

### Task 1: Формула процента

Чистая функция без БД. Отдельной задачей, потому что вырожденные случаи (урок без слов, урок из одного слова, позиция за пределами текста) — единственное место, где легко разойтись с ридером, и проверяются они юнит-тестами за миллисекунды.

**Files:**
- Create: `backend/src/flinq/modules/lesson_library/progress.py`
- Test: `backend/tests/modules/lesson_library/test_progress.py`

**Interfaces:**
- Consumes: ничего.
- Produces: `LessonProgress` (frozen dataclass, поля `read_percent: int`, `new_words_remaining: int`); `ZERO_PROGRESS: LessonProgress`; `read_percent(position: int | None, max_ordinal: int | None) -> int`. Task 2 использует все три.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/tests/modules/lesson_library/test_progress.py`:

```python
"""Формула процента прочитанного (FLQ-8a) — зеркало ReaderPage.tsx:133-137."""

from __future__ import annotations

from flinq.modules.lesson_library.progress import ZERO_PROGRESS, read_percent


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


def test_zero_progress_constant_is_all_zeroes() -> None:
    assert ZERO_PROGRESS.read_percent == 0
    assert ZERO_PROGRESS.new_words_remaining == 0
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && uv run pytest tests/modules/lesson_library/test_progress.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'flinq.modules.lesson_library.progress'`

- [ ] **Step 3: Написать минимальную реализацию**

Создать `backend/src/flinq/modules/lesson_library/progress.py`:

```python
"""Прогресс чтения урока для карточки библиотеки (FLQ-8a).

Позиция и остаток новых слов считаются на лету. «Новое слово» — это
отсутствие TokenItem у пары (user, language, token_text), то есть факт,
общий для всех уроков языка: денормализованный счётчик на урок пришлось бы
инвалидировать веером при каждом изменении статуса слова. Обоснование —
docs/superpowers/specs/2026-07-25-library-reading-progress-design.md §3.4.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LessonProgress:
    read_percent: int
    new_words_remaining: int


#: Урок, по которому агрегат не вернул строки (в тексте нет word-like токенов).
ZERO_PROGRESS = LessonProgress(read_percent=0, new_words_remaining=0)


def read_percent(position: int | None, max_ordinal: int | None) -> int:
    """Доля прочитанного, 0..100.

    Зеркало бара ридера (frontend/src/features/reader/ReaderPage.tsx:133-137):
    нет позиции или в уроке нет слов -> 0; урок из одного слова -> 100.
    """
    if position is None or max_ordinal is None:
        return 0
    if max_ordinal == 0:
        return 100
    return max(0, min(100, round(position / max_ordinal * 100)))
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd backend && uv run pytest tests/modules/lesson_library/test_progress.py -v`
Expected: PASS, 9 passed

- [ ] **Step 5: Линт и типы**

Run: `cd backend && uv run ruff check src/flinq/modules/lesson_library/progress.py tests/modules/lesson_library/test_progress.py && uv run pyright src/flinq/modules/lesson_library/progress.py`
Expected: обе команды без ошибок

- [ ] **Step 6: Коммит**

```bash
git add backend/src/flinq/modules/lesson_library/progress.py backend/tests/modules/lesson_library/test_progress.py
git commit -m "feat(library): reading-percent formula mirroring the reader bar" -- backend/src/flinq/modules/lesson_library/progress.py backend/tests/modules/lesson_library/test_progress.py
```

---

### Task 2: Агрегат и выдача в `GET /api/lessons`

Запрос, два новых поля DTO и склейка в роутере. Тестируется через API целиком: seeding уроков, позиций и словаря уже есть в хелперах, дублировать его ради отдельного теста запроса незачем.

**Files:**
- Modify: `backend/src/flinq/modules/lesson_library/progress.py` (дописать запрос к созданному в Task 1)
- Modify: `backend/src/flinq/modules/lesson_library/schemas.py:29-38` (`LessonSummary`)
- Modify: `backend/src/flinq/api/lessons.py:35-61` (`list_lessons`)
- Test: `backend/tests/api/test_lessons_progress.py`

**Interfaces:**
- Consumes: из Task 1 — `LessonProgress`, `ZERO_PROGRESS`, `read_percent`.
- Produces: `progress_for_lessons(session, *, user_id: uuid.UUID, lang: str, lesson_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, LessonProgress]`. Поля ответа `read_percent: int` и `new_words_remaining: int` в `LessonSummary` — их потребляет Task 3.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/tests/api/test_lessons_progress.py`:

```python
"""GET /api/lessons: процент прочитанного и остаток новых слов (FLQ-8a)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from flinq.main import create_app

from ._reader_helpers import register_and_onboard, seed_ready_lesson

# Восемь уникальных слов, без повторов — остаток новых слов совпадает с
# числом слов после позиции, поэтому ожидания в тестах читаются глазами.
TEXT = "um dois tres quatro. cinco seis sete oito."


async def _word_ordinals(c: AsyncClient, lesson_id: uuid.UUID) -> list[int]:
    """ordinal_in_lesson всех word-like токенов урока, по порядку."""
    r = await c.get(f"/api/lessons/{lesson_id}/content")
    assert r.status_code == 200
    return [
        tok["i"]
        for para in r.json()["paragraphs"]
        for sent in para["sentences"]
        for tok in sent["tokens"]
        if "i" in tok
    ]


async def _card(c: AsyncClient, lesson_id: uuid.UUID, lang: str = "pt") -> dict[str, Any]:
    r = await c.get(f"/api/lessons?lang={lang}")
    assert r.status_code == 200
    return next(i for i in r.json()["items"] if i["id"] == str(lesson_id))


async def _put_position(
    c: AsyncClient, csrf: str, lesson_id: uuid.UUID, ordinal: int
) -> None:
    r = await c.put(
        "/api/reader/positions",
        json={
            "lesson_id": str(lesson_id),
            "view_mode": "page",
            "current_segment_id": None,
            "current_token_ordinal": ordinal,
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 204


async def test_unopened_lesson_is_zero_percent_with_every_word_new(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-unopened@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 8


async def test_position_drives_percent_and_shrinks_remaining(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-middle@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)
        ordinals = await _word_ordinals(c, lesson_id)
        assert len(ordinals) == 8

        # Встаём на пятое слово: позади четыре, впереди строго три.
        await _put_position(c, csrf, lesson_id, ordinals[4])

        card = await _card(c, lesson_id)
        assert card["read_percent"] == round(ordinals[4] / ordinals[-1] * 100)
        assert 0 < card["read_percent"] < 100
        assert card["new_words_remaining"] == 3


async def test_finished_lesson_is_hundred_percent_with_nothing_left(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-finished@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)
        ordinals = await _word_ordinals(c, lesson_id)

        await _put_position(c, csrf, lesson_id, ordinals[-1])

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 100
        assert card["new_words_remaining"] == 0


async def test_word_known_from_another_lesson_is_not_new_here(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Статус слова принадлежит паре (user, language), а не уроку."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-crosslesson@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/vocabulary/items",
            json={
                "kind": "token",
                "language_code": "pt",
                "text": "cinco",
                "status": "known",
                "confidence": None,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 201

        card = await _card(c, lesson_id)
        assert card["new_words_remaining"] == 7


async def test_known_word_in_another_language_does_not_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Изоляция по языку: en-слово не гасит одноимённое pt-слово."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-langiso@example.com", lang="pt")
        await c.post(
            "/me/onboarding",
            json={
                "ui_language": "en",
                "learning_languages": ["pt", "en"],
                "translation_language": "en",
            },
            headers={"X-CSRF-Token": csrf},
        )
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/vocabulary/items",
            json={
                "kind": "token",
                "language_code": "en",
                "text": "cinco",
                "status": "known",
                "confidence": None,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 201

        card = await _card(c, lesson_id)
        assert card["new_words_remaining"] == 8


async def test_lesson_without_word_tokens_reports_zeroes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Урок из одной пунктуации: агрегат не вернёт по нему строки."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-nowords@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text="...")

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 0


async def test_position_row_without_ordinal_counts_whole_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Урок открывали, но ординала нет — остаток должен быть всем текстом."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-nullordinal@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.put(
            "/api/reader/positions",
            json={
                "lesson_id": str(lesson_id),
                "view_mode": "page",
                "current_segment_id": None,
                "current_token_ordinal": None,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 204

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 8


async def test_all_words_known_leaves_nothing_new(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Процент по-прежнему по позиции, но новых слов не остаётся."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-allknown@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        for word in ("um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito"):
            r = await c.post(
                "/api/vocabulary/items",
                json={
                    "kind": "token",
                    "language_code": "pt",
                    "text": word,
                    "status": "known",
                    "confidence": None,
                },
                headers={"X-CSRF-Token": csrf},
            )
            assert r.status_code == 201

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0  # урок не открывали
        assert card["new_words_remaining"] == 0


async def test_progress_is_per_user(monkeypatch: pytest.MonkeyPatch) -> None:
    """Чужая позиция по shared-уроку не протекает в мою карточку."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as reader_a:
        csrf_a = await register_and_onboard(reader_a, "progress-user-a@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(
            reader_a, csrf_a, monkeypatch, text=TEXT, visibility="shared"
        )
        ordinals = await _word_ordinals(reader_a, lesson_id)
        await _put_position(reader_a, csrf_a, lesson_id, ordinals[-1])
        assert (await _card(reader_a, lesson_id))["read_percent"] == 100

    async with AsyncClient(transport=transport, base_url="http://test") as reader_b:
        await register_and_onboard(reader_b, "progress-user-b@example.com", lang="pt")
        card = await _card(reader_b, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 8
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd backend && uv run pytest tests/api/test_lessons_progress.py -v`
Expected: FAIL — `KeyError: 'read_percent'` (поля в ответе ещё нет)

- [ ] **Step 3: Дописать запрос в `progress.py`**

Добавить импорты в начало файла (к уже существующим из Task 1):

```python
import uuid
from collections.abc import Sequence

from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.modules.lesson_library.models import LessonTokenOccurrence
from flinq.modules.reader_state.models import ReaderPosition
from flinq.modules.vocabulary.models import TokenItem
```

Добавить функцию в конец файла:

```python
async def progress_for_lessons(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    lang: str,
    lesson_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, LessonProgress]:
    """Прогресс по странице списка уроков — один агрегат на всю страницу.

    Ни один из LEFT JOIN не размножает строки: reader_positions уникален по
    (user_id, lesson_id), token_items — по (user_id, language_code,
    token_text). Поэтому MAX(rp.current_token_ordinal) — это способ протащить
    позицию через GROUP BY, а COUNT(DISTINCT ...) считает ровно то, что
    заявлено. Уроки без word-like токенов в результат не попадают — вызывающий
    подставляет им ZERO_PROGRESS.
    """
    if not lesson_ids:
        return {}

    occ = LessonTokenOccurrence
    stmt = (
        select(
            occ.lesson_id,
            func.max(occ.ordinal_in_lesson),
            func.max(ReaderPosition.current_token_ordinal),
            func.count(distinct(occ.normalized_text)).filter(
                TokenItem.id.is_(None),
                occ.ordinal_in_lesson
                > func.coalesce(ReaderPosition.current_token_ordinal, -1),
            ),
        )
        .select_from(occ)
        .outerjoin(
            ReaderPosition,
            and_(
                ReaderPosition.lesson_id == occ.lesson_id,
                ReaderPosition.user_id == user_id,
            ),
        )
        .outerjoin(
            TokenItem,
            and_(
                TokenItem.user_id == user_id,
                TokenItem.language_code == lang,
                TokenItem.token_text == occ.normalized_text,
            ),
        )
        .where(occ.lesson_id.in_(lesson_ids), occ.is_word_like.is_(True))
        .group_by(occ.lesson_id)
    )

    rows = (await session.execute(stmt)).all()
    return {
        lesson_id: LessonProgress(
            read_percent=read_percent(position, max_ordinal),
            new_words_remaining=new_remaining,
        )
        for lesson_id, max_ordinal, position, new_remaining in rows
    }
```

- [ ] **Step 4: Добавить поля в DTO**

В `backend/src/flinq/modules/lesson_library/schemas.py`, в класс `LessonSummary`, после `created_at`:

```python
    # Считаются на лету в progress.py; у ORM-модели Lesson таких атрибутов нет,
    # поэтому нужны значения по умолчанию — model_validate(lesson) их не найдёт.
    read_percent: int = 0
    new_words_remaining: int = 0
```

- [ ] **Step 5: Склеить в роутере**

В `backend/src/flinq/api/lessons.py` добавить импорт:

```python
from flinq.modules.lesson_library.progress import ZERO_PROGRESS, progress_for_lessons
```

Заменить тело `return LessonListResponse(...)` в `list_lessons` на:

```python
    progress = await progress_for_lessons(
        session, user_id=user_id, lang=lang, lesson_ids=[item.id for item in items]
    )
    return LessonListResponse(
        items=[
            LessonSummary.model_validate(item).model_copy(
                update={
                    "read_percent": progress.get(item.id, ZERO_PROGRESS).read_percent,
                    "new_words_remaining": progress.get(
                        item.id, ZERO_PROGRESS
                    ).new_words_remaining,
                }
            )
            for item in items
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `cd backend && uv run pytest tests/api/test_lessons_progress.py tests/api/test_lessons.py -v`
Expected: PASS — новые 9 тестов и все прежние тесты списка уроков

- [ ] **Step 7: Прогнать весь бэкенд, линт и типы**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run pyright`
Expected: всё зелёное. Если pyright ругается на распаковку строк результата — аннотировать `rows` явным типом, а не подавлять диагностику.

- [ ] **Step 8: Коммит**

```bash
git add backend/src/flinq/modules/lesson_library/progress.py backend/src/flinq/modules/lesson_library/schemas.py backend/src/flinq/api/lessons.py backend/tests/api/test_lessons_progress.py
git commit -m "feat(library): serve reading percent and remaining new words in lesson list" -- backend/src/flinq/modules/lesson_library/progress.py backend/src/flinq/modules/lesson_library/schemas.py backend/src/flinq/api/lessons.py backend/tests/api/test_lessons_progress.py
```

---

### Task 3: Карточка библиотеки

Заменить захардкоженный `0%` на данные из API. Бару добавляется `role="progressbar"` — это и доступность, и способ проверить ширину в тесте, не цепляясь за вёрстку.

**Files:**
- Modify: `frontend/src/api/lessons.ts:6-15` (интерфейс `LessonSummary`)
- Modify: `frontend/src/features/library/LessonCard.tsx:19-26`
- Test: `frontend/src/features/library/LessonCard.test.tsx`

**Interfaces:**
- Consumes: из Task 2 — поля ответа `read_percent: number`, `new_words_remaining: number`.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/src/features/library/LessonCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LessonSummary } from '@/api/lessons'

import { LessonCard } from './LessonCard'

const lesson: LessonSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Capítulo 14 — Um Mapa das Índias',
  language_code: 'pt',
  word_count: 1240,
  visibility: 'private',
  status: 'ready',
  created_at: '2026-07-25T00:00:00Z',
  read_percent: 42,
  new_words_remaining: 87,
}

describe('LessonCard', () => {
  it('fills the progress bar to the read percentage', () => {
    render(<LessonCard lesson={lesson} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar.style.width).toBe('42%')
  })

  it('shows percent read, total words and remaining new words', () => {
    render(<LessonCard lesson={lesson} />)
    expect(screen.getByText('42% · 1240 слов · 87 новых')).toBeInTheDocument()
  })

  it('renders an untouched lesson at zero without collapsing the bar', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 0, new_words_remaining: 1240 }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar.style.width).toBe('0%')
    expect(screen.getByText('0% · 1240 слов · 1240 новых')).toBeInTheDocument()
  })

  it('renders a finished lesson at a hundred percent', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 100, new_words_remaining: 0 }} />)
    expect(screen.getByRole('progressbar').style.width).toBe('100%')
    expect(screen.getByText('100% · 1240 слов · 0 новых')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && pnpm test --run LessonCard`
Expected: FAIL — TypeScript не знает полей `read_percent` / `new_words_remaining`, а `getByRole('progressbar')` ничего не находит

- [ ] **Step 3: Расширить тип ответа**

В `frontend/src/api/lessons.ts`, в интерфейс `LessonSummary`, после `created_at: string`:

```ts
  read_percent: number
  new_words_remaining: number
```

- [ ] **Step 4: Подключить данные в карточке**

В `frontend/src/features/library/LessonCard.tsx` заменить блок `<div className="mt-auto space-y-1">…</div>` на:

```tsx
        <div className="mt-auto space-y-1">
          <div className="h-1 w-full rounded-full bg-secondary">
            <div
              role="progressbar"
              aria-valuenow={lesson.read_percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-full rounded-full bg-primary"
              style={{ width: `${String(lesson.read_percent)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {lesson.read_percent.toString()}% · {lesson.word_count.toString()} слов ·{' '}
            {lesson.new_words_remaining.toString()} новых
          </p>
        </div>
```

`.toString()` на числах — местная конвенция этого файла (так уже написан `word_count`), а не украшение.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd frontend && pnpm test --run LessonCard`
Expected: PASS, 4 passed

- [ ] **Step 6: Прогнать весь фронт и линт**

Run: `cd frontend && pnpm test --run && pnpm lint`
Expected: всё зелёное. Особое внимание — тестам библиотеки и любым фикстурам `LessonSummary` в других тестах: добавленные поля обязательны, и старые фикстуры без них перестанут компилироваться. Дописать в них `read_percent: 0, new_words_remaining: 0`.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/api/lessons.ts frontend/src/features/library/LessonCard.tsx frontend/src/features/library/LessonCard.test.tsx
git commit -m "feat(library): show reading progress and remaining new words on lesson cards" -- frontend/src/api/lessons.ts frontend/src/features/library/LessonCard.tsx frontend/src/features/library/LessonCard.test.tsx
```

---

### Task 4: Синхронизировать спеку библиотеки

`docs/ui/library.md` §8.1 описывает бар как coverage. Пока это не поправлено, документ противоречит коду — ровно тот класс расхождения, из-за которого этот баг и прожил незамеченным.

**Files:**
- Modify: `docs/ui/library.md:140-141`, `docs/ui/library.md:234`

**Interfaces:**
- Consumes: решения §2–§3 спеки дизайна.
- Produces: ничего.

- [ ] **Step 1: Переписать описание Meta**

Заменить в `docs/ui/library.md` две строки (140-141):

```markdown
- `Progress bar` — доля прочитанного: `reader_positions.current_token_ordinal / MAX(lesson_token_occurrences.ordinal_in_lesson)`. Не coverage: показывает, сколько текста пройдено, а не насколько знакома лексика. Решение и обоснование — `docs/superpowers/specs/2026-07-25-library-reading-progress-design.md` §2.
- Подпись под баром — `{read_percent}% · {word_count} слов · {new_words_remaining} новых`. `new_words_remaining` — уникальные слова без `TokenItem`, встречающиеся **после** текущей позиции чтения.
```

- [ ] **Step 2: Закрыть открытый вопрос**

Заменить в §14 строку про `new_words_count` (234) на:

```markdown
- **`new_words_count` в card meta** — закрыто: считается on-the-fly, в уникальных словах, только по остатку текста после позиции чтения. Денормализация в `lesson_progress` отвергнута — признак «новое слово» принадлежит паре (user, language) и инвалидировался бы веером по всем урокам языка.
```

Перенести пункт из «Остаётся открытым» в «Закрыто».

- [ ] **Step 3: Коммит**

```bash
git add docs/ui/library.md
git commit -m "docs(library): progress bar is reading position, not coverage" -- docs/ui/library.md
```

---

## Проверка вживую

После Task 3 — поднять стек и убедиться глазами, что баг закрыт (`/verify` описывает процедуру для этого проекта):

1. `docker compose -f docker-compose.dev.yml up -d`, `cd backend && uv run flinq serve`, `cd frontend && pnpm dev`.
2. Открыть библиотеку: у непрочитанного урока `0% · N слов · M новых`, причём `M > 0`.
3. Открыть урок, пролистать несколько страниц, вернуться в библиотеку — процент вырос, число новых слов упало.
4. Пометить несколько слов известными в одном уроке — в карточке другого урока с теми же словами счётчик новых уменьшился.
