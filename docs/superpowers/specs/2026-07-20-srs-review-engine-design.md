# FLQ-7 — SRS Review engine + /review page: дизайн

- Дата: 2026-07-20
- Задача: `backlog/tasks/flq-7 - SRS-Review-engine-review-page-scheduling-cards-queue.md`
- Основания: ADR-0005 (статусная модель, confidence 0..5), domain model §10 (`docs/architecture/2026-04-11-mvp-domain-model.md`), спека §7.9
- Статус: одобрен пользователем (сессия 2026-07-19/20)

## 1. Резюме решений

| Вопрос | Решение |
|---|---|
| Скоуп mini-review из reader | **Lesson-scoped** (AC #6; sentence-scoped из описания задачи отвергнут — сессии были бы почти пустыми) |
| Содержимое mini-review очереди | **Все tracked-токены урока** независимо от `due_at` (due — первыми); фразы — только в глобальной очереди (MVP-ограничение: связь «фраза→урок» нигде не хранится) |
| Карточка | Лицевая: слово/фраза + бледное контекстное предложение (если доступно). Оборот: личный перевод + заметки. Кнопки `✗ Ошибка` / `✓ Знаю` |
| Дневной лимит | **Мягкий**: `user_settings.daily_goal_reviews` ограничивает только главную очередь (`limit_reached` экран); mini-review не блокируется, но его ответы входят в дневной счётчик; сервер ответы сверх лимита не отвергает |
| Алгоритм | **SM-2 для `due_at`** (state в `algorithm_state_json`, `algorithm_name='sm2'`) + **confidence ±1 по ADR-0005** как отдельная ось. Бинарный ответ мапится в SM-2 quality: верно=4, ошибка=2 |
| Graduation | Ответ «верно» при `confidence = 5` → item в `known`, review_item деактивируется (ADR-0005 «Переходы») |
| Сессия | Stateless: каждый ответ персистится сразу; exit mid-session ничего не теряет по построению |

## 2. Данные (миграция `0012_review`, `down_revision = "0011_phrase_text_check"`)

### 2.1 `review_items` (модуль `modules/review/models.py`)

| Поле | Тип | Примечание |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → users, CASCADE | |
| `item_kind` | VARCHAR(8) | `'token' \| 'phrase'` (паттерн PersonalTranslation) |
| `item_id` | UUID | без FK, ownership проверяется в коде |
| `language_code` | VARCHAR(8) | денормализация: язык item неизменяем, нужен для фильтра очереди без join |
| `is_active` | BOOLEAN | |
| `algorithm_name` | VARCHAR(16) | `'sm2'`; FSRS позже без смены схемы |
| `algorithm_state_json` | JSONB | `{ease_factor: float, interval_days: float, repetitions: int}` |
| `due_at` | TIMESTAMPTZ | |
| `last_reviewed_at` | TIMESTAMPTZ NULL | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Ограничения/индексы:
- partial unique: `(user_id, item_kind, item_id) WHERE is_active` (domain model §10.2);
- индекс `(user_id, language_code, is_active, due_at)` — запрос очереди;
- CHECK `item_kind IN ('token','phrase')`.

### 2.2 `review_events` (append-only)

`id`, `review_item_id` (FK → review_items CASCADE), `user_id`, `answer_value` (`'correct'|'wrong'`), `previous_confidence`, `new_confidence` (SMALLINT), `previous_due_at`, `new_due_at`, `reviewed_at` (default now). Индекс `(user_id, reviewed_at)` — дневной счётчик. Никаких UPDATE/DELETE путей в коде.

### 2.3 Backfill

В миграции 0012: для каждого tracked `token_item`/`phrase_item` создать активный `review_item` (`due_at = now()`, свежий SM-2 state: EF 2.5, interval 0, repetitions 0). После этого инвариант «tracked ⇔ существует активный review_item» поддерживается lifecycle-синком.

## 3. Lifecycle-синк (модуль `modules/review/service.py`)

`sync_review_item(session, *, user_id, item_kind, item_id, language_code, status)`:
- `status == 'tracked'` → создать активный review_item (due=now), либо реактивировать неактивный (сброс SM-2 state, due=now);
- `status in ('known','ignored')` или удаление item → `is_active = False`.

Вызовы из всех write-путей vocabulary (`backend/src/flinq/modules/vocabulary/service.py`):
- `create_item` — новые/upsert token (~186-193, 181-185, 204-208) и phrase (~148-156, 143-145, 170-172) ветки;
- `patch_item` (~224-228) — статус/confidence из карточки и vocabulary;
- `bulk_action` — `set_known`/`set_ignored` (~832-840), `delete` (~841-852).

Ручное изменение confidence через карточку SM-2 state не трогает (оси независимы).

## 4. SM-2 (`modules/review/sm2.py`, чистые функции)

`apply_answer(state, answer, now) -> (new_state, due_at)`:
- **Верно (q=4)**: `repetitions += 1`; интервал: 1-е → 1 день, 2-е → 6 дней, далее `round(interval × EF)`; EF без изменений (формула SM-2 при q=4 даёт дельту 0).
- **Ошибка (q=2)**: `repetitions = 0`, `interval = 0`, `due_at = now`; `EF −= 0.32`, floor 1.3.
- `due_at = now + interval_days`.

Confidence (в `review/service.py`, не в sm2.py): верно → `min(5, c+1)`; ошибка → `max(0, c−1)`. Graduation: верно при `c == 5` → status `known` (через vocabulary-логику), деактивация review_item.

## 5. API (`api/review.py`, регистрация в `main.py`)

### `GET /api/review/queue?lang=xx[&lesson_id=uuid]`

Ответ: `{items: [...], daily: {limit, done_today, limit_reached}}`.

- **Главная очередь** (без `lesson_id`): активные review_items пользователя с `language_code = lang`, `due_at <= now`, join на tracked token/phrase items; сортировка `due_at ASC`; размер среза `min(осталось до дневного лимита, 100)`. При `done_today >= limit` → `items: []`, `limit_reached: true`.
- **Lesson-режим**: tracked-токены урока через join `LessonTokenOccurrence.normalized_text = token_items.token_text` (+ проверка владения уроком); сортировка due-первыми, затем по `due_at`; лимитом не срезается, `limit_reached` всегда false. Фразы не входят (MVP).
- Item payload: `review_item_id`, `item_kind`, `item_id`, `text` (token_text / display_text), `confidence`, `translation` (primary личный перевод или null), `notes` (или null), `context_sentence` (токены: `created_from_occurrence_id` → occurrence.segment → segment.text; иначе null).

### `POST /api/review/answer` `{review_item_id, answer: 'correct'|'wrong'}`

Транзакционно: проверка владения → SM-2 → обновление confidence/status vocab item → запись review_event (previous/new значения) → ответ `{new_confidence, new_status, due_at, done_today}`. Ответы сверх лимита не отвергаются. 404 на чужой/неактивный review_item.

Дневной счётчик: `count(review_events WHERE user_id AND reviewed_at >= начало текущих суток UTC)`. Упрощение MVP — таймзона пользователя не хранится; при появлении поля таймзоны заменить границу суток.

## 6. Frontend

- **API**: `src/api/review.ts` → `reviewApi.getQueue(lang, lessonId?)`, `reviewApi.answer(...)` поверх `api<T>()`.
- **Роут**: `routes/learn.$lang.review.tsx`, регистрация в `routeTree.ts` (`learnLangRoute.addChildren`). Search-параметр `?lessonId=` — lesson-режим.
- **`features/review/`**:
  - `ReviewPage` — загрузка очереди один раз при входе, локальный прогон, счётчик «N / M», финальный экран (статистика сессии, «Повторить ошибки» = рефетч), экраны «всё повторено» и `limit_reached` (без обхода в MVP), lesson-режим с подзаголовком «Слова урока».
  - `ReviewCard` — лицевая (текст + бледный контекст, «Показать перевод»), оборот (перевод, заметки, `✗ Ошибка` / `✓ Знаю`). Хоткеи: `Space` — flip; `1` — ошибка, `2` — знаю (активны только после переворота).
  - Ответ = немедленный POST; кнопки заблокированы до ответа сервера; ошибочные карточки не рециклятся внутри сессии (они due — попадут в «Повторить ошибки»/следующую сессию).
  - Graduation в ответе (`new_status: 'known'`) → тост «Слово выучено ✓».
  - По завершении сессии — инвалидация vocabulary/reader query-ключей (подсветка и списки подтянут новые confidence/status).
- **Mini-review**: `BottomToolbar.tsx` — кнопка «Повторить лексику» (стаб на строке ~52) получает `lessonId`, `navigate` на `/learn/$lang/review?lessonId=...`.
- **Мобильный**: одна колонка, карточка на всю ширину, крупные кнопки ответа внизу.

## 7. Обработка ошибок

- Сбой `POST /answer`: карточка остаётся, кнопки разблокируются, retry-тост (паттерн WordCard).
- Сбой загрузки очереди: стандартный error-state страницы.
- Backend: 404 чужой review_item; 422 невалидный `answer`; конфликт unique-active при гонке create — перечитать существующую строку (паттерн race-веток `create_item`).

## 8. Тестирование

- **Backend**: unit SM-2 (интервалы 1/6/×EF, EF floor, reset, маппинг quality); сервис lifecycle-синка по всем переходам ADR-0005 (create/patch/bulk/delete, реактивация known→tracked, unique-active); API queue (сортировка, лимит/срез, lesson-фильтр, limit_reached, context_sentence) и answer (append-only event, confidence ±1 c floor/cap, graduation → known + деактивация, done_today); migration-chain тест для 0012 + backfill. Модели — в side-effect импорты `tests/conftest.py`.
- **Frontend**: ReviewCard (flip, кнопки, хоткеи, блокировка до ответа); ReviewPage (прогон, финальный экран, limit_reached, пустая очередь, lesson-режим); BottomToolbar навигация.

## 9. Вне скоупа (осознанно)

- FSRS, аудио/cloze/reverse-режимы, mixing (spec §7.9 «2026») — Phase 2.
- Фразы в lesson mini-review (нет связи фраза→урок).
- In-session recycle ошибочных карточек; кнопка «продолжить сверх лимита»; таймзоны.
- Sentence-scoped mini-review.
