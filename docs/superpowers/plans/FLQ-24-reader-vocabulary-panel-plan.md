# FLQ-24 — Reader Vocabulary Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Добавить закрепляемую правую панель словаря урока с карточкой слова и вкладками «Добавленные», «Новые», «Все».

**Architecture:** Backend возвращает персональный snapshot лексики урока из существующих таблиц. TanStack Query хранит snapshot и инвалидирует его после изменений словаря, bulk-known и undo. Один контейнер панели переключает список и встроенную существующую WordCard; Zustand хранит только предпочтение закрепления.

**Tech Stack:** Python 3.13+, FastAPI, SQLAlchemy async, Pydantic v2, PostgreSQL, pytest/testcontainers; React 19+, TypeScript strict, TanStack Query, Zustand, Tailwind v4, Radix, lucide-react, Vitest/Testing Library.

**Spec:** [FLQ-24-reader-vocabulary-panel-design.md](../specs/FLQ-24-reader-vocabulary-panel-design.md).

**Статус:** реализовано и проверено через subagent-driven-development; FLQ-24 — Done. Ветка `codex/flq-24-reader-vocabulary-panel`.

## Global Constraints

- Python 3.13+, FastAPI, Pydantic v2, SQLAlchemy 2.x async, PostgreSQL; зависимости через uv.
- React 19+, TypeScript strict, TanStack Query, Zustand, Tailwind CSS v4, Radix, lucide-react; зависимости через pnpm.
- Новые зависимости и миграции не добавляются.
- Token и Phrase остаются самостоятельными единицами; нормализация и правила SRS не меняются.
- Статусы: new / tracked / known / ignored; confidence 0..5, ручной picker 1..4, новое изучаемое слово стартует с 1.
- AI необязателен; список не вызывает AI или словарь, карточка сохраняет маркировку AI и обязательную атрибуцию Wiktionary.
- Интеграционные backend-тесты используют настоящий PostgreSQL через testcontainers, без SQLite и моков БД.
- Рабочий язык документов — русский; код, идентификаторы и сообщения коммитов — английский.
- Не затрагивать существующие пользовательские изменения в рабочем дереве, не менять запущенную БД ради подготовки документов.

---

## 1. Подготовка к исполнению

- [x] Прочитать спеку полностью, актуальные AGENTS.md и FLQ-24 через Backlog MCP. После одобрения реализации записать план/ссылку в задачу, назначить исполнителя, перевести в In Progress. Подготовка документов сама по себе не завершает задачу.
- [x] Выполнить `git status --short`, `git diff --stat`, проверить ветку. В дереве уже есть пользовательские правки backend, CI, Compose и документации. Не выполнять общий `git add .`, reset, stash или смену checkout с потерей этих правок. Изоляцию при необходимости подготовить по using-git-worktrees с актуальным рабочим состоянием, не только HEAD.
- [x] Проверить инструменты: `uv --version`, `corepack pnpm --version`, `docker info`. Backend-команды ниже выполняются из `backend/`, frontend-команды — из `frontend/`. `backend/.env`/корневой `.env` не печатать. Backend-тесты сами создают отдельные контейнеры.
- [x] Перед реализацией сверить три Figma node из спеки через figma-design-to-code. Не переносить абсолютные координаты строк или временные asset URL в приложение. Текущие lucide-иконки Check/Plus/Trash2 совпадают с назначением макета; glyph проверяется визуально. Существующие circles/background реализуются CSS.
- [x] Выполнить базовые тематические тесты, чтобы отделить старые ошибки от новых: `uv run pytest tests/api/test_reader_statuses.py tests/api/test_reader_bulk.py tests/modules/test_vocabulary_lesson_provenance.py -q`; `corepack pnpm exec vitest run src/features/reader src/components/ConfidencePicker.test.tsx`. Записать результат. Нельзя менять тесты на зелёные без проверки причин.

Этапы ниже выполняются последовательно: 1 → 2 → 3 → 4. Каждый имеет собственный RED/GREEN-цикл и атомарный коммит; финальная проверка охватывает связанный сценарий.

## 2. Карта файлов и обязанностей

| Файл | Ответственность |
|---|---|
| `backend/src/flinq/modules/reader_state/vocabulary.py` (новый) | Snapshot и поиск первого текущего вхождения сохранённых фраз. |
| `backend/src/flinq/modules/reader_state/schemas.py` | DTO списка и контекста. |
| `backend/src/flinq/api/reader.py` | Новый GET, текущие правила доступа и ready. |
| `backend/src/flinq/modules/vocabulary/service.py` | Только согласование разрешённого shared-источника в `_validate_provenance`; правила записи не менять. |
| `backend/tests/api/test_reader_vocabulary.py` (новый) | Реальные HTTP/БД сценарии списка. |
| `backend/tests/modules/reader_state/test_vocabulary.py` (новый) | Сервис, phrase matching, отсутствие записей/внешних вызовов и пакетное чтение. |
| `backend/tests/modules/test_vocabulary_lesson_provenance.py` | Регрессии источника, shared/private и сегмента. |
| `frontend/src/api/reader.ts` | Типы snapshot и клиент GET. |
| `frontend/src/lib/invalidateVocabularyViews.ts` (новый) | Единая инвалидация производных персональных представлений. |
| `frontend/src/features/reader/useReaderQueries.ts` | Query snapshot, обновление после bulk-known/undo. |
| `frontend/src/features/reader/useWordCard.ts` | Обновление snapshot после записи из карточки/строки. |
| `frontend/src/features/vocabulary/useVocabularyQuery.ts` | Инвалидация после изменения вне reader. |
| `frontend/src/features/review/useReviewSession.ts`, `TranslationSession.tsx` | Инвалидация snapshot после успешного изменения статуса/уровня на ревью, без изменения алгоритма. |
| `frontend/src/features/reader/lessonVocabulary.ts` (новый) | Чистые фильтры, сортировка, ключ строки и преобразование в SelectedItem. |
| `frontend/src/features/reader/LessonVocabularyPanel.tsx` (новый) | Контейнер desktop/sheet, вкладка и позиции списка, список ↔ карточка. |
| `frontend/src/features/reader/LessonVocabularyList.tsx` (новый) | Три вкладки, скролл, состояния загрузки/ошибки/пустоты. |
| `frontend/src/features/reader/LessonVocabularyRow.tsx` (новый) | Статус, перевод, быстрые действия и picker. |
| `frontend/src/features/reader/readerStore.ts`, `ReaderTopBar.tsx` | Настройка закрепления и отдельная кнопка PanelRight. |
| `frontend/src/features/reader/WordCard.tsx` | Встраиваемый layout без собственного backdrop/Escape. |
| `frontend/src/features/reader/ReaderPage.tsx`, `selectedItem.ts` | Выбор, nullable контекст, размеры, закрытие и синхронизация с reader. |
| `frontend/src/features/reader/BottomToolbar.tsx`, `useReaderHotkeys.ts` | Общая ширина и запрет reader shortcuts внутри панели/порталов. |
| `frontend/src/styles/globals.css` | Общая переменная ширины и недостающие локальные tokens панели. |

Для каждого нового frontend-модуля — colocated `*.test.ts(x)`; интеграция дополнительно в существующих `ReaderPage.test.tsx`, `WordCard.test.tsx`, `bulkFlow.test.tsx`, `useReaderQueries.test.tsx`. Новые React-обёртки ui/popover и ui/tabs не обязательны: `Popover`, `Tabs`, `Dialog` уже экспортируются установленным `radix-ui`; следовать стилю существующих wrappers при необходимости.

## Task 1: Персональный snapshot лексики материала

**Files:** backend-файлы из карты; новый endpoint находится рядом с `lesson_token_statuses_route`. Не менять `bulk.py`, SRS или схему данных.

**Interfaces:**

- Consumes: `build_lesson_content(session, lesson) -> LessonContentResponse`; `_load_lesson(session, lesson_id, user_id)`; `TokenItem`, `PhraseItem`, `PersonalTranslation`.
- Produces: `build_lesson_vocabulary(session: AsyncSession, *, lesson: Lesson, user_id: UUID, target: str) -> LessonVocabularyResponse`.
- Produces: `find_phrase_context(content: LessonContentResponse, phrase_text: str) -> LessonVocabularyContext | None` — чистый поиск **уже нормализованной** последовательности в одном предложении.
- DTO `LessonVocabularyContext`, `LessonVocabularyItem`, `LessonVocabularyResponse` повторяют имена и nullable-поля из §7 спеки; Python UUID сериализуется строкой. HTTP `GET /api/lessons/{lesson_id}/vocabulary?target=ru`.

- [x] **Step 1: Добавить минимальный RED API-тест.** В новом `tests/api/test_reader_vocabulary.py` переиспользовать реальные fixtures из `_reader_helpers.py`:

```python
import uuid

from httpx import AsyncClient
import pytest

from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson


async def test_new_words_are_unique_across_the_whole_lesson(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(
        client, csrf, monkeypatch, text="Casa casa. Rua.", language_code="pt"
    )
    response = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    assert response.status_code == 200
    rows = {row["text"]: row for row in response.json()["items"]}
    assert len(response.json()["items"]) == 2
    assert set(rows) == {"casa", "rua"}
    assert rows["casa"]["status"] == "new"
    assert rows["casa"]["item_id"] is None
    assert rows["casa"]["added_here"] is False
    assert rows["rua"]["context"]["sentence_text"] == "Rua."
```

- [x] **Step 2: Запустить RED.** `uv run pytest tests/api/test_reader_vocabulary.py::test_new_words_are_unique_across_the_whole_lesson -q`. Ожидается отсутствующий endpoint, не ошибка Docker/import. При инфраструктурной ошибке сначала восстановить реальную тестовую среду.

- [x] **Step 3: Добавить DTO, сервис и маршрут.** Контракт маршрута:

```python
from typing import Literal

@router.get("/lessons/{lesson_id}/vocabulary", response_model=LessonVocabularyResponse)
async def lesson_vocabulary(
    lesson_id: uuid.UUID,
    target: Literal["en", "ru", "pt"],
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LessonVocabularyResponse:
    user_id = _require_user(request)
    lesson = await _load_lesson(session, lesson_id, user_id)
    return await build_lesson_vocabulary(
        session, lesson=lesson, user_id=user_id, target=target
    )
```

В `schemas.py` использовать Literal для kind/status, `int | None` для confidence с границами 0..5 и `token_ordinal` с `ge=0`. `primary_translation` — существующий `PrimaryTranslationOut` vocabulary schemas. Items содержат отдельные normalized `text` и surface `display_text`.

Алгоритм сервиса:

1. Получить `content` через существующий builder; пройти его sentences/WordToken по порядку, `setdefault(token.n, first_context)` сохраняет первое вхождение; пунктуация не создаёт строку.
2. Одним запросом получить TokenItem текущего пользователя/языка, где normalized text принадлежит набору урока **или** `created_from_lesson_id == lesson.id`. Фильтр принадлежности на больших наборах — PostgreSQL array, а не тысячи отдельных bind-параметров:

```python
from sqlalchemy import Text, any_, bindparam, or_, select
from sqlalchemy.dialects.postgresql import ARRAY

lesson_words = bindparam("lesson_words", value=list(first_context), type_=ARRAY(Text))
stmt = select(TokenItem).where(
    TokenItem.user_id == user_id,
    TokenItem.language_code == lesson.language_code,
    or_(
        TokenItem.token_text == any_(lesson_words),
        TokenItem.created_from_lesson_id == lesson.id,
    ),
)
```

3. Получить PhraseItem текущего пользователя/языка, индексировать по первому нормализованному слову. Для каждого предложения проверять последовательности word-токенов, не переходить его границу; выбрать первый контекст, не отбрасывать пересекающиеся фразы. Сохранённые здесь фразы включать и без совпадения. `find_phrase_context` должен использовать тот же matcher, что пакетный проход, чтобы тесты проверяли production-правило.
4. Объединить по `(kind, text)` текущие токены, совпавшие фразы и все provenance-items. У отсутствующего TokenItem построить вычисляемый `new`. Для фразы использовать `display_text` записи; `context` — только из текущего материала.
5. Получить основные переводы пакетно с ограничениями `(owner_user_id, item_kind, item_id, target_language_code, is_primary)`; сопоставить словарём `(kind, id)`. Для большого набора id — также array/ANY. Ничего не создавать и не коммитить в read-сервисе.

- [x] **Step 4: Добавить RED на происхождение и переходы, затем реализовать маппинг.** В том же test client создать item через существующий API:

```python
created = await client.post(
    "/api/vocabulary/items",
    json={
        "kind": "token", "language_code": "pt", "text": "casa",
        "status": "tracked", "confidence": 1, "lesson_id": str(lesson_id),
    },
    headers={"X-CSRF-Token": csrf},
)
assert created.status_code == 201
item_id = created.json()["item_id"]
changed = await client.patch(
    f"/api/vocabulary/items/token/{item_id}",
    json={"status": "known", "confidence": None},
    headers={"X-CSRF-Token": csrf},
)
assert changed.status_code == 200
snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
casa = next(row for row in snapshot.json()["items"] if row["text"] == "casa")
assert casa["added_here"] is True
assert casa["status"] == "known"
```

Этот фрагмент добавляется в отдельный тест с регистрацией и уроком как в Step 1. Дополнить параметризованными сценариями `tracked/0`, `tracked/5`, `ignored`, token/phrase; первичный перевод ru против en, отсутствие перевода, источник другого урока, источник NULL и bulk-known. Проверить осиротевший контекст после повторной обработки урока: provenance остаётся, context null, запись не исчезает. Уникальные email создаются через uuid; использовать существующие cleanup fixtures для глобальных таблиц при необходимости.

- [x] **Step 5: Добавить RED на доступ, затем исправить только проверку shared-источника.** GET: anonymous 401, чужой private 403, missing 404, processing 409, target xx 422; shared → данные текущего пользователя, а не владельца. POST/PATCH в shared с provenance должен работать для текущего пользователя. В `_validate_provenance` заменить условие проверки владения на:

```python
if lesson is None or (lesson.visibility != "shared" and lesson.owner_user_id != user_id):
    raise LessonNotFound(str(lesson_id))
```

Остальные ограничения остаются: private для чужого → 404, чужой item → 404, несовпадающий язык/сегмент → 422, `segment_id` без `lesson_id` → 422. Не менять владельца item, `_apply_provenance`, `_promote_to_user` и `sync_review_item`.

- [x] **Step 6: Проверить объём и отсутствие побочных эффектов.** В сервисном тесте сравнить количество SELECT на snapshot уроков с 10 и 1000 уникальных слов через SQLAlchemy `before_cursor_execute`, не подменяя БД; число запросов должно быть одинаковым. Сравнить до/после количество TokenItem, PhraseItem, PersonalTranslation, ReviewItem. Отдельно запретить внешние AI/dictionary вызовы spies, которые падают при вызове. Фразы: диакритика, внутренний дефис, разделяющая пунктуация, граница предложения, два перекрывающихся совпадения, known/ignored-фразы, другой язык/пользователь.

- [x] **Step 7: GREEN и локальная проверка.** `uv run pytest tests/api/test_reader_vocabulary.py tests/modules/reader_state/test_vocabulary.py tests/modules/test_vocabulary_lesson_provenance.py tests/api/test_reader_bulk.py -q`; затем `uv run ruff check` и `uv run ruff format --check` с этими изменёнными Python-файлами. Все тесты проходят, GET остаётся read-only.
- [x] **Step 8: Атомарный коммит.** Добавить только backend-файлы этого этапа, проверить staged diff и выполнить `git commit -m "feat(FLQ-24): expose lesson vocabulary snapshots"`. Не включать пользовательские правки review/identity.

## Task 2: Типы, фильтры и согласованное обновление данных

**Files:** `frontend/src/api/reader.ts`, новые `lessonVocabulary.ts`/`.test.ts`, `invalidateVocabularyViews.ts`/`.test.ts`, существующие query/mutation hooks из карты, `useReaderQueries.test.tsx` и новый `useWordCard.test.tsx`.

**Interfaces:**

- Consumes: DTO snapshot Task 1; `SelectedItem`; существующие API create/patch/translation/bulk/undo.
- Produces: типы `LessonVocabularyItem`, `LessonVocabularyResponse` строго из §7 спеки и `readerApi.vocabulary(lessonId: string, target: string): Promise<LessonVocabularyResponse>`.
- Produces: `useLessonVocabulary(lessonId: string, target: string, enabled: boolean)` — стандартный `useQuery` с этим response.
- Produces: `VocabularyTab = 'added' | 'new' | 'all'`; `vocabularyRowKey(item): string`; `selectVocabularyItems(items: LessonVocabularyItem[], tab: VocabularyTab, lang: string): LessonVocabularyItem[]`.
- Produces: `invalidateVocabularyViews(qc: QueryClient): Promise<void>` — prefixes, перечисленные ниже. Преобразование в nullable SelectedItem добавляется в Task 3, после изменения типа.

- [x] **Step 1: RED на различие «Добавленные»/«Новые».** Создать `lessonVocabulary.test.ts`:

```typescript
import { expect, it } from 'vitest'
import type { LessonVocabularyItem } from '@/api/reader'
import { selectVocabularyItems } from './lessonVocabulary'

const base: LessonVocabularyItem = {
  kind: 'token', item_id: 'one', text: 'casa', display_text: 'Casa',
  status: 'tracked', confidence: 0, added_here: true,
  primary_translation: null, context: null,
}

it('uses provenance for added and missing state for new', () => {
  const items: LessonVocabularyItem[] = [
    base,
    { ...base, item_id: 'two', text: 'rua', status: 'known', confidence: null },
    { ...base, item_id: null, text: 'praça', status: 'new', confidence: null, added_here: false },
    { ...base, item_id: 'four', text: 'antigo', added_here: false },
  ]
  expect(selectVocabularyItems(items, 'new', 'pt').map((i) => i.text)).toEqual(['praça'])
  expect(selectVocabularyItems(items, 'added', 'pt').map((i) => i.text)).toEqual(['casa', 'rua'])
  expect(selectVocabularyItems(items, 'all', 'pt')).toHaveLength(4)
})
```

`corepack pnpm exec vitest run src/features/reader/lessonVocabulary.test.ts`: сначала ожидается отсутствующий модуль/экспорт. Затем добавить отдельные проверки: ignored с added_here сохраняется, несколько видов не схлопываются, исходный массив не мутируется, сортировка ru/en/pt стабильна.

- [x] **Step 2: Типы и чистая реализация.** Добавить DTO в `api/reader.ts`, импортировать `CardStatus`, `ItemKind` при повторном использовании общих union. Реализовать:

```typescript
export type VocabularyTab = 'added' | 'new' | 'all'

export function vocabularyRowKey(item: LessonVocabularyItem): string {
  return `${item.kind}:${item.text}`
}

export function selectVocabularyItems(
  items: LessonVocabularyItem[], tab: VocabularyTab, lang: string,
): LessonVocabularyItem[] {
  const collator = new Intl.Collator(lang)
  return items.filter((item) =>
    tab === 'added' ? item.added_here : tab === 'new' ? item.status === 'new' : true,
  ).sort((a, b) =>
    collator.compare(a.text, b.text) || a.kind.localeCompare(b.kind) ||
    (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  )
}
```

Добавить в `readerApi` метод:

```typescript
vocabulary: (lessonId: string, target: string) => {
  const params = new URLSearchParams({ target })
  return api<LessonVocabularyResponse>(`/api/lessons/${lessonId}/vocabulary?${params}`)
},
```

Ключ hook — `['reader-vocabulary', lessonId, target]`, queryFn вызывает метод, `enabled` передаётся явно, `staleTime` не Infinity, без placeholderData предыдущего урока.

- [x] **Step 3: RED на инвалидацию реального Query cache.** В `invalidateVocabularyViews.test.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { invalidateVocabularyViews } from './invalidateVocabularyViews'

it('marks all cached lesson vocabularies stale across lessons and targets', async () => {
  const qc = new QueryClient()
  const keys = [
    ['reader-vocabulary', 'lesson-1', 'ru'],
    ['reader-vocabulary', 'lesson-1', 'en'],
    ['reader-vocabulary', 'lesson-2', 'ru'],
  ]
  keys.forEach((key) => qc.setQueryData(key, { items: [] }))
  qc.setQueryData(['reader-content', 'lesson-1'], { paragraphs: [] })
  await invalidateVocabularyViews(qc)
  keys.forEach((key) => expect(qc.getQueryState(key)?.isInvalidated).toBe(true))
  expect(qc.getQueryState(['reader-content', 'lesson-1'])?.isInvalidated).toBe(false)
})
```

Run: `corepack pnpm exec vitest run src/lib/invalidateVocabularyViews.test.ts` → RED. Затем реализовать helper:

```typescript
import type { QueryClient } from '@tanstack/react-query'

export async function invalidateVocabularyViews(qc: QueryClient): Promise<void> {
  const prefixes = [
    'reader-vocabulary', 'reader-statuses', 'word-card', 'phrases',
    'vocab-list', 'lessons', 'review-counts',
  ]
  await Promise.all(prefixes.map((prefix) => qc.invalidateQueries({ queryKey: [prefix] })))
}
```

Не инвалидировать `reader-content`, position или внешний AI cache.

- [x] **Step 4: Подключить инвалидацию к успешным записям.** `useWordCardMutations.invalidate` вызывает helper; `useBulkKnown`/`useUndoBulk` вызывают helper только onSuccess, сохраняя существующие ожидания ключей. `useVocabularyQuery` вызывает helper после bulk/patch. В двух review session-файлах добавить инвалидацию `reader-vocabulary` и `word-card` в уже существующие обработчики успешной записи, не запускать новый review запрос, который сбросит активную сессию.

Все callbacks возвращают Promise завершения обновления, но ошибка фонового refetch отражается состоянием query, а не превращается в ошибку успешной записи. Оптимистическое удаление строки до ответа API не вводить.

- [x] **Step 5: Проверить hook-поведение.** В `useReaderQueries.test.tsx` добавить mock нового метода, активную `useLessonVocabulary` subscription и последовательные snapshots. После mock-успеха bulkKnown возвращать snapshot без `new`, после undo — со словом. Проверять `result.current.data.items`, а не только факт вызова invalidateQueries. На отказ mutation snapshot остаётся прежним. Отдельно: enabled=false не вызывает API; при смене lessonId не отображаются предыдущие данные; реальная QueryClient subscription при переводе через `useWordCardMutations.saveTranslation` обновляет `primary_translation`.

- [x] **Step 6: GREEN.** `corepack pnpm exec vitest run src/features/reader/lessonVocabulary.test.ts src/lib/invalidateVocabularyViews.test.ts src/features/reader/useReaderQueries.test.tsx src/features/reader/useWordCard.test.tsx`; `corepack pnpm build`. При type-check ошибках устранить расхождения имён с DTO Task 1.
- [x] **Step 7: Коммит.** Только файлы этого этапа: `git commit -m "feat(FLQ-24): synchronize lesson vocabulary views"` после проверки staged diff.

## Task 3: Единый контейнер панели и встроенная карточка

**Files:** новый `LessonVocabularyPanel.tsx`/`.test.tsx`; `readerStore.ts`, `ReaderTopBar.tsx`, `WordCard.tsx`/`.test.tsx`, `ReaderPage.tsx`/`.test.tsx`, `selectedItem.ts`, `lessonVocabulary.ts`/`.test.ts`, `BottomToolbar.tsx`, `useReaderHotkeys.ts` и новый `.test.tsx`, `globals.css`.

**Interfaces:**

- Consumes: существующий `WordCard` и `SelectedItem`; preference store; list-slot как ReactNode.
- Produces: `WordCard` с опциональным `embedded?: boolean` (default false); embedded отключает fixed shell, backdrop и собственный Escape, но не логику переводов/статуса.
- Produces: `vocabularyPanelPinned: boolean`, `setVocabularyPanelPinned(value: boolean): void` в store; persist только этого поля и прежнего font.
- Produces: `SelectedItem.i: number | null`, `SelectedItem.segmentId?: string | null`, остальные поля прежние.
- Produces: `toSelectedVocabularyItem(item: LessonVocabularyItem): SelectedItem` в `lessonVocabulary.ts`.
- Produces: `LessonVocabularyPanelProps` ниже. Panel используется и временной карточкой, и постоянным списком; внутри существует только один WordCard.

```typescript
interface LessonVocabularyPanelProps {
  lessonId: string
  pinned: boolean
  selectedWord: SelectedItem | null
  onClearSelection: () => void
  onHide: () => void
  card: ReactNode
  renderList: (state: {
    tab: VocabularyTab
    onTabChange: (tab: VocabularyTab) => void
    scrollTop: number
    onScrollTopChange: (top: number) => void
  }) => ReactNode
}
```

Panel владеет tab и `Record<VocabularyTab, number>` позиций скролла. Сбрасывается через `key={lessonId}`; не размонтируется при временном показе card. При отсутствии pinned и selectedWord возвращает null. ReaderPage передаёт обработчик выбора непосредственно в list-slot; List сохраняет ключ исходной строки для возврата фокуса.

- [x] **Step 1: RED на встроенную карточку.** В существующем `WordCard.test.tsx` использовать имеющийся setup lookup/dictionary/AI; передать `embedded={true}` карточке с теми же обязательными props, что соседний standalone тест. Проверить: текст, TranslationFields и picker видны; `word-card-backdrop` отсутствует; Escape не вызывает `onClose` самостоятельно. Standalone прежние тесты остаются зелёными.
- [x] **Step 2: Вынести только оболочку.** Сохранить все hooks/queries внутри WordCard. Выбирать внешний wrapper и закрывающую кнопку по embedded; встроенная кнопка называется «К списку» при pinned и «Закрыть карточку» при временном режиме (передать `closeLabel?: string`). `onKey` обрабатывает Escape только при `!embedded`; `k/i/1..4` остаются прежними для активной карточки и не работают внутри редакторов или активного popover. Не монтировать скрытую вторую карточку для mobile.
- [x] **Step 3: RED на закрепление.** В `ReaderPage.test.tsx` использовать существующие `baseLesson`, `content`, `renderPage()`; добавить mock `readerApi.vocabulary` с `items: []`, вернуть пустые dict/AI как в текущих тестах. Reset store добавляет `vocabularyPanelPinned:false`. Проверка после реализации list-slot сначала может показывать тестовый заголовок без строк:

```typescript
renderPage()
await screen.findByTestId('page-view-slot')
fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: 'Hello' }))
expect(await screen.findByTestId('word-card')).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: 'К списку' }))
expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
```

Run: `corepack pnpm exec vitest run src/features/reader/ReaderPage.test.tsx src/features/reader/WordCard.test.tsx` → новое поведение падает. Полные проверки реальных вкладок дополняются в Task 4, временный test-slot не входит в production.

- [x] **Step 4: Реализовать preference, кнопку, shell и выбор из списка.** PanelRight в top bar обоих режимов; не менять `sidebarOpen`/PanelLeft. Вычислить `panelVisible = vocabularyPanelPinned || selectedWord !== null`, передать его в toolbar и классы reader. В globals.css `--reader-panel-width: 410px`; резерв справа только на `lg` (`1024px`), ширина + gap 16px, общая переменная для панели/toolbar/стрелки.

```typescript
export function toSelectedVocabularyItem(item: LessonVocabularyItem): SelectedItem {
  return {
    kind: item.kind, t: item.display_text, n: item.text,
    i: item.context?.token_ordinal ?? null,
    segmentId: item.context?.segment_id ?? null,
    sentenceText: item.context?.sentence_text ?? null,
  }
}
```

В ReaderPage сначала использовать явный `segmentId`, если свойство определено (включая null), иначе прежний поиск по i. Для `i=null` не выставлять диапазон выделения; для фразы из списка не вычислять конец по длине текста, использовать существующее совпадение либо оставить диапазон снятым. Выбор строки не вызывает `setPageIndex`, `setSentenceFlatIndex`, `bulkKnown`, position mutation. При переключении урока сбрасывается selectedWord вместе с panel key.

- [x] **Step 5: Desktop и mobile shell.** Использовать один matchMedia breakpoint `(min-width: 1024px)`; на desktop `aside aria-label="Словарь урока"`, на mobile Radix Dialog primitive с `modal`, Title и Content (sheet). Существующий `DialogContent` жёстко задаёт центральный layout/z-50; не переопределять его глобально для других страниц — локальная оболочка из тех же primitives. Применить `--z-modal` и `--z-popover`, внутренний overflow-y, max-height `85dvh`, safe-area. Одна ветка render → одна карточка; при breakpoint resize сохраняются выбор и list state.
- [x] **Step 6: Единственный владелец dismiss.** Panel/ReaderPage обрабатывают Escape из §4 спеки. Radix onEscapeKeyDown останавливает событие после закрытия picker; `useReaderHotkeys` уважает `event.defaultPrevented` и исключает `[data-reader-panel]`, `[data-reader-panel-popover]` для стрелок/букв. Panel ставит эти маркеры и на портальный content. Свободный click слушать на контейнере reader, проверяя interactive targets; не глобальный безусловный `document.click`. Флаг завершённого phrase drag или существующее предотвращение клика защищает выделение от моментального закрытия. У temporary-card на desktop свободный клик также закрывает выбор.
- [x] **Step 7: GREEN и регрессии.** Добавить тесты pinned/off, свободный click, клик по строке/portal не закрывает panel, Escape один слой, фраза после drag остаётся, 0-индекс валиден, nullable контекст не подменяется текущим предложением, pin сохраняется через rehydrate, вкладка/scroll сбрасываются при lesson change. Для mobile matchMedia stub проверить dialog и возврат focus; для Tab/Arrow в panel проверить отсутствие bulk/navigation. Запуск: `corepack pnpm exec vitest run src/features/reader/ReaderPage.test.tsx src/features/reader/WordCard.test.tsx src/features/reader/LessonVocabularyPanel.test.tsx src/features/reader/useReaderHotkeys.test.tsx src/features/reader/lessonVocabulary.test.ts`; затем `corepack pnpm build`.
- [x] **Step 8: Коммит.** `git commit -m "feat(FLQ-24): add a persistent reader panel shell"` после проверки адресного staged diff.

## Task 4: Вкладки, строки и полный reader flow

**Files:** новые `LessonVocabularyList.tsx`/`.test.tsx`, `LessonVocabularyRow.tsx`/`.test.tsx`; `LessonVocabularyPanel.tsx`, `ReaderPage.tsx`/`.test.tsx`, `bulkFlow.test.tsx`. Существующий ConfidencePicker переиспользуется без новой шкалы.

**Interfaces:**

- Consumes: DTO/selector/query Task 2, panel renderList Task 3, `useWordCardMutations` и `toSelectedVocabularyItem`.
- Produces: `LessonVocabularyList` получает `{ lessonId, lang, target, tab, onTabChange, scrollTop, onScrollTopChange, onSelect }`; query вызывается с enabled=true только в смонтированном списке. Если список скрыт карточкой, его DOM сохраняется скрытым/inert для scroll/focus; ошибки/данные могут обновляться, интерактивность отключена.
- Produces: `VocabularyRowAction = 'add' | 'known' | 'ignore' | 'confidence'`; `LessonVocabularyRow` получает `{ item: LessonVocabularyItem, lessonId: string, lang: string, target: string, onOpen: (item: LessonVocabularyItem) => void, onActionStart: (key: string, action: VocabularyRowAction) => void, onActionComplete: (key: string, action: VocabularyRowAction) => void }`. List сохраняет индекс/тип действия через onActionStart до refetch и переносит фокус через onActionComplete после успешного обновления.

- [x] **Step 1: RED на фильтры и действие строки.** Создать component-тест с настоящими List/Row и QueryClient, подменить только API boundary. Реальный snapshot содержит два new, tracked/0 с added_here, tracked из другого урока, known с added_here, ignored и phrase. Проверять через role tab/listitem и `within` отсутствие неподходящих строк. Отдельный row-тест:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { LessonVocabularyItem } from '@/api/reader'

vi.mock('@/api/vocabulary', () => ({ vocabularyApi: { createItem: vi.fn() } }))
import { vocabularyApi } from '@/api/vocabulary'
import { LessonVocabularyRow } from './LessonVocabularyRow'

it('retains a new word and reports a failed write', async () => {
  vi.mocked(vocabularyApi.createItem).mockRejectedValue(new Error('offline'))
  const item: LessonVocabularyItem = {
    kind: 'token', item_id: null, text: 'casa', display_text: 'Casa',
    status: 'new', confidence: null, primary_translation: null, added_here: false,
    context: { segment_id: 'seg-1', token_ordinal: 0, sentence_text: 'Casa casa.' },
  }
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}>
    <LessonVocabularyRow item={item} lessonId="lesson-1" lang="pt" target="ru"
      onOpen={() => undefined} onActionStart={() => undefined}
      onActionComplete={() => undefined} />
  </QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить Casa в изучение' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить'))
  expect(screen.getByRole('button', { name: 'Открыть карточку Casa' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Добавить Casa в изучение' })).toBeEnabled()
})
```

Run: `corepack pnpm exec vitest run src/features/reader/LessonVocabularyList.test.tsx src/features/reader/LessonVocabularyRow.test.tsx` → RED. До минимальной реализации допустим missing module, затем проверить именно отрицательный сценарий с рабочим компонентом.

- [x] **Step 2: Реализовать список.** `useLessonVocabulary(lessonId, target, true)` читает snapshot; selector Task 2 фильтрует rows. Radix Tabs root `value=tab`, bottom List с точными подписями и доступными controls; scroll контейнер отделён от tablist, берёт сохранённый scrollTop при возврате. Заголовок «Словарь урока» принадлежит shell, не дублировать. Пустые тексты и ошибки точно из §9 спеки. На refetch сохранять существующие items; distinguish `isPending`, initial error (`!data`) и refetch error (`data` есть).
- [x] **Step 3: Реализовать Row и мутации.** Row вызывает только `useWordCardMutations`, не `useWordLookup`, dictionary или AI. Опции mutation: `text = item.kind === 'phrase' ? item.display_text : item.text`, `surfaceText = item.display_text`, lessonId и `segId=item.context?.segment_id ?? null`. Для new add/known/ignore:

```typescript
await mutations.setStatus.mutateAsync({
  itemId: item.item_id,
  status: 'tracked',
  confidence: 1,
})
```

Для «Знаю» — `status:'known', confidence:null`; для «Игнорировать» — `status:'ignored', confidence:null`. Для picker tracked — выбранная пара из ConfidencePicker. Перехватить rejection, сохранить последнее действие для кнопки «Повторить», не переключать tab/card. После успеха вызвать onActionComplete; UI данные берёт из обновлённого snapshot. Не считать отсутствие перевода ошибкой добавления.

Статусы known/ignored показываются как индикаторы, не прямые кнопки взаимного перехода. Цифры tracked 0/5 показываются буквально. Только tracked circle открывает `<Popover.Root>` из radix-ui; Content помечен `data-reader-panel-popover`, слой выше modal. Pending блокирует все buttons данной строки, включая повторное открытие picker, с `aria-busy`; closed/new readonly текст остаётся понятным.

- [x] **Step 4: Реализовать фокус и перенос строк.** Новый список использует стабильный `vocabularyRowKey`; перед mutation хранит индекс и имя действия. После success/refetch, если строки больше нет, фокусирует соответствующую кнопку следующей, затем предыдущей строки, затем active tab. При изменении перевода/уровня не перемещает focus на чужую строку. При открытии карточки хранит исходный row key; возврат восстанавливает его либо active tab. CSS: круг 28px внутри удобной области нажатия, перенос длинного текста, минимум строки 56/64px, border под text-column, fixed bottom tabs. «Нет в текущем тексте» отображается при context=null, перевод — из primary_translation либо «Без перевода».
- [x] **Step 5: Подключить реальный list-slot.** ReaderPage передаёт в Panel renderList с lessonId, lang, текущим target (тот же, что WordCard; не менять существующий выбор языка перевода). `onSelect` вызывает toSelectedVocabularyItem и только меняет выбор/подсветку. Panel сохраняет list-slot при card view в hidden/inert контейнере, чтобы данные и scroll жили; вкладки недоступны клавиатуре, пока видна карточка. Temporary режим без закрепления список не монтирует и snapshot не запрашивает.
- [x] **Step 6: RED/GREEN интеграции.** В `ReaderPage.test.tsx` и `bulkFlow.test.tsx` добавить последовательные snapshots на реальном QueryClient; проверять UI по роли вкладки и строк, не spy вызова компонентов:

| Сценарий | Ожидаемый результат |
|---|---|
| New «+» success | Исчезает из «Новых», появляется в «Добавленных», все вхождения в тексте tracked/1. |
| New «Знаю»/«Игнорировать» | Исчезает из «Новых», остаётся во «Всех», не появляется в «Добавленных». |
| Picker tracked 2 → 3 | Обновляет цифру в списке и карточке; повторное открытие не показывает 2. |
| Изменение перевода в карточке → список | Показывает новый primary, сохраняет tab и scroll. |
| Next page и next sentence | Исчезают только new-тексты, затронутые существующим bulk диапазоном, включая их повторы; unseen слова остаются. |
| Undo после ручного re-track одного слова | Остальные возвращаются в «Новые», вручную сохранённое остаётся tracked/Added. |
| Bulk/save error | Старые строки остаются; error локален; повтор работает. |
| Save success, GET refresh error | Сообщение «Не удалось обновить список», а не «Не удалось сохранить». |
| Выбор строки с другой страницы | Карточка использует её sentence/segment; страница и position не меняются. |
| Новый lessonId при pending response | Старый response не рисуется в новой панели; выбор, tab и scroll сброшены. |
| Новый lesson после сохранения слова в старом | Snapshot актуален, источник первого урока сохранён. |

Mock API проверяет wire payload: create/patch получают lesson/segment; create отправляет surface text токена или фразы через существующий mutation hook, а нормализованный ключ токена используется для lookup; UI assertions проверяют результат. AI-disabled реализовать existing `ApiError(503, 'ai_disabled')` fixture, как в WordCard-тестах; список не инициирует translate/lookup, а карточка сохраняет словарную атрибуцию.

- [x] **Step 7: GREEN и commit.** Запустить все reader и ConfidencePicker/Vocabulary tests: `corepack pnpm exec vitest run src/features/reader src/components/ConfidencePicker.test.tsx src/features/vocabulary`; `corepack pnpm build`. После проверки staged diff: `git commit -m "feat(FLQ-24): add lesson vocabulary tabs and actions"`.

## 3. Финальная проверка связанного изменения

- [x] Backend: `uv run pytest tests/api/test_reader_vocabulary.py tests/api/test_reader_bulk.py tests/api/test_reader_content.py tests/api/test_reader_statuses.py tests/api/test_vocabulary.py tests/api/test_vocabulary_phrase.py tests/modules/reader_state tests/modules/test_vocabulary_lesson_provenance.py -q`. Затем `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`. Старые сбои описать отдельно, не маскировать и не менять несвязанные файлы.
- [x] Frontend: `corepack pnpm exec vitest run`, `corepack pnpm build`, `corepack pnpm lint`. Сборка включает strict TypeScript. Линтер/форматирование только изменённых файлов исправлять адресно; не запускать массовый format всего дерева.
- [x] Убедиться, что рабочий frontend проксирует `/api` к backend. Текущий `vite.config.ts` явно перечисляет старые prefixes, но не `/api`; перед ручной проверкой сопоставить HTTP ответ и реально запущенный Vite. При воспроизводимом отсутствии proxy добавить один `/api` target к существующему API_TARGET в том же интеграционном изменении, проверить `/api/lessons/{id}/vocabulary` возвращает JSON API, а не index.html. Не считать HTTP 200 HTML доказательством работы API.
- [x] В тестовом аккаунте и отдельном материале выполнить smoke-сценарий на desktop `1440×1000`, `1024×768`, mobile `390×844` и узком `320×700`: показать panel → New → add → Added → picker → карточка → свободный клик → All → next → undo → hide → временная карточка. Не менять личный словарь пользователя для проверки. Добавить словоформы с диакритикой, фразу, long text и один shared-урок от другого тестового пользователя.
- [x] Визуально сравнить с Figma 92:2/93:2/94:2: ширина 410, круги 28, текст 16/13, разделители, перенос длинного текста, тень/радиус, закреплённая нижняя tabbar. Проверить, что панель не перекрывает стрелку и toolbar, а переключение список/card не меняет ширину текста.
- [x] Клавиатура: Tab до переключателя, Enter открыть, Arrow/Home/End во вкладках, picker, Escape один слой; ни одна клавиша внутри панели не вызывает next page. Прокрутка на длинном списке, возврат фокуса после мутации, portrait/landscape без двойной WordCard и без блокировки body после закрытия.
- [x] Проверить logout: существующий `AvatarMenu.logout` вызывает `queryClient.clear()`, новый namespace тоже исчезает; вход вторым аккаунтом не показывает данные первого. Не сохранять snapshot в localStorage.
- [x] Записать проверки и фактические отклонения в FLQ-24 через MCP; отметить критерии только после соответствующей проверки. Полная задача не Done, если API/UI/проверки ещё не выполнены. Обновить спеку только для принятых уточнений, не переписывать accepted ADR.


## 4. Покрытие требований спеки

| Критерии §10 | Этап и доказательство |
|---|---|
| 1–2: закрепление, список/card, переход урока | Task 3 state/ReaderPage tests; Task 4 восстановление tab/scroll. |
| 3–4: состав, уникальность, provenance | Task 1 API/service tests + Task 2 selectors. |
| 5: whole-lesson new и успешные действия | Task 1 fresh snapshot; Task 4 component flow. |
| 6: уровни 0..5 и синхронизация | Task 2 cache subscription; Task 4 picker/card flow. |
| 7: bulk-known и undo | Task 1 backend regressions; Task 2/4 UI snapshots после bulk/undo. |
| 8: контекст другой страницы/переимпорта | Task 1 phrase/provenance tests; Task 3 nullable SelectedItem; Task 4 no-navigation test. |
| 9: AI optional, attribution, нет N+1 | Task 1 query count/read-only; Task 4 WordCard/list tests. |
| 10: private/shared и персональные данные | Task 1 HTTP/provenance/translation isolation; финальный logout smoke. |
| 11: клавиатура/фокус | Task 3 hotkeys + Task 4 focus tests; ручная проверка keyboard. |
| 12: адаптивность/ошибки/длинные строки | Task 3 sheet + Task 4 error states; визуальная проверка четырёх viewport. |

## 5. Handoff

После ревью спеки и плана реализацию можно вести в этой сессии через `superpowers:executing-plans` либо по отдельным этапам через `superpowers:subagent-driven-development`. Выбор способа исполнения не меняет контракты и последовательность. До команды на реализацию выполнять только уточнение этих документов.

## 6. Решения при исполнении

- Работа идёт в отдельной ветке `codex/flq-24-reader-vocabulary-panel` в существующем checkout: сохраняются пользовательские изменения и Docker bind mounts. Изоляция на уровне ветки, а не отдельной файловой копии; одновременно код меняет один исполнитель.
- В feature-коммиты попадают только созданные для задачи файлы и изменения. Остальной tracked diff сверяется с исходным снимком побайтово.
- При обновлении reader-тестов исправлены два исходно неполных `LessonDetail` fixture: добавлены корректные `read_percent` и `new_words_remaining`, чтобы production build мог служить проверкой типов. Изменение касается тестовых данных.
- В исходный `vite.config.ts` добавлен предусмотренный планом `/api` proxy. Проверка Vite показала, что ранее его наличие обеспечивал ignored generated `vite.config.js`; исправление делает source-конфигурацию самостоятельной. Остальные proxy prefixes сохранены.

- Уточнена формулировка wire payload: существующий create API получает surface text слова/фразы; backend нормализует его перед поиском и сохранением. Нормализованный ключ остаётся ключом lookup. Это соответствует §5 спеки и сохраняет общий mutation path карточки и списка.

- Финальное ревью обнаружило унаследованное отсутствие видимой атрибуции словаря. В рамках обязательного критерия §10.9 карточка теперь выводит переданные API источник, лицензию и ссылку рядом с видимыми словарными подсказками. Цена уточнения — дополнительная короткая строка; провайдер и API не меняются.
- Для AI-подсказок добавлены явная надпись `AI-generated` и доступное имя кнопки добавления. Одного прежнего символа ✦ недостаточно для требования маркировки. Цена — короткая подпись и небольшое увеличение высоты карточки, без изменения AI-провайдера.

## 7. Результаты исполнения

Реализация выполнена последовательными implementer-агентами с отдельным ревью каждого этапа. Коммиты: `40ab6d8`, `8a7729d`, `ad90eca`, `4fc35c2`, `e1ceeb1`; форматирование — `018fe09`. Общее ревью выявило четыре P2: обработку кликов по SVG, обрезание вкладок на низком экране, отсутствие видимой словарной атрибуции и явной AI-маркировки. Все четыре исправлены одной волной в `c6d6481`.

| Проверка | Результат |
|---|---|
| Backend: согласованный API/service scope | 62 passed; настоящий PostgreSQL через testcontainers. |
| Backend: ruff / pyright | ruff check passed; pyright 0 ошибок, 56 существовавших предупреждений. |
| Frontend: полный Vitest после финальных исправлений | 40 файлов, 284 passed. |
| Frontend: адресные регрессии финального исправления | 3 файла, 55 passed; перед исправлением зафиксированы ожидаемые RED. |
| Production build / ESLint / форматирование | Build passed; ESLint 0 ошибок и 2 прежних предупреждения; Prettier изменённых frontend-файлов passed. |
| Desktop и mobile | Проверены 1440×1000, 1024×768, 390×844, 320×700; дополнительно 844×390, 700×320 и 1024×390 для доступности вкладок. |
| Сценарии UI | Pin/card/list/hide; фактические уровни 0/5; фразы и context=null; быстрые действия; правка перевода; bulk-known/undo; фокус, Escape, клавиатура; клики по вложенным SVG. |
| Персональные данные | Два отдельных QA-аккаунта, shared-урок, logout/login и сохранение разных личных переводов проверены. |
| AI и словарь | Успешные live AI-подсказки имеют явную маркировку. Атрибуция и работа при AI-disabled подтверждены непустыми словарными fixtures; live lookup QA-слов не дал словарных подсказок. |

Границы проверки: dev Docker Compose работает, frontend production build проверен; отдельный запуск чистого production Compose в этой задаче не выполнялся. Общий backend format-check сообщает о восьми прежних файлах вне изменения; все шесть изменённых backend-файлов отформатированы корректно. Существующие предупреждения React act/query mocks и размера Vite chunk не исправлялись. При подготовке QA до реализации наблюдалась отдельная проблема входа: успешный POST login сопровождался немедленным 401 от /me; последующий переход на URL приложения работал с установленной сессией. Она не относится к панели и осталась вне изменения.

Пользовательские изменения сохранены: оставшийся tracked diff после продуктовых коммитов побайтово совпадает с исходным снимком. Проверки выполнялись на отдельных QA-данных, личный словарь пользователя не менялся. Ветка сохраняется локально; интеграция в main и публикация не выполнялись.

Итоговое scoped re-review диапазона `018fe09..c6d6481`: все четыре замечания устранены; новых проблем и наблюдений вне области исправления нет. Все критерии FLQ-24 отмечены через Backlog MCP, задача переведена в Done.
