# Тренажёр изучения слов (AI-упражнения поверх SRS): дизайн

- Дата: 2026-07-20
- Прообраз: личный CLI-тренажёр пользователя (`LearningBot/anki_cli_new.py`) — режимы learn/quiz/reverse-quiz/translation-practice + письменное упражнение
- Основания: FLQ-7 (SRS-движок, `/review`), FLQ-3 (AI-гейтвей), ADR-0005 (статусная модель; настоящей спекой **амендируется**), spec §7.9 (cloze, mixing режимов, AI-упражнения)
- Статус: одобрен пользователем (сессия 2026-07-20)

## 1. Резюме решений

| Вопрос | Решение |
|---|---|
| Скоуп 1-го инкремента | Все 4 режима CLI + письменное упражнение по ошибкам |
| Оценивание | **Полная самооценка 0..5** (SuperMemo-качество) во всех SRS-режимах, включая существующие flip-карточки (✗/✓ уходит). Квиз-правильность — только обратная связь |
| Размещение | Расширение `/learn/$lang/review`: экран выбора режима перед сессией; mini-review (`?lessonId=`) остаётся карточками без выбора |
| AI-генерация | На лету перед каждой карточкой (без кэша/предгенерации в MVP) |
| Архитектура генерации | Backend-эндпоинт поверх гейтвея FLQ-3 (провайдер, kill-switch, audit); квиз-payload включает правильность — проверка на клиенте (финальная оценка всё равно самостоятельная) |

## 2. Режимы

| Режим | `mode` | Источник | Механика | SRS |
|---|---|---|---|---|
| Карточки | `cards` (default) | due-очередь | flip как в FLQ-7, но GradeBar 0..5 | да |
| Новые слова | `new` | активные review_items с `last_reviewed_at IS NULL`, новые первыми | слово → AI-пример (`example`) → раскрытие: перевод, начальная форма, перевод предложения → GradeBar | да |
| Квиз: пропуск | `cloze` | due-очередь | перевод предложения + предложение с пропуском + 4 варианта слова → верно/неверно → GradeBar | да |
| Квиз: перевод | `reverse` | due-очередь | слово + AI-пример → 4 варианта перевода (AI-дистракторы) → верно/неверно → GradeBar | да |
| Практика перевода | `translation` | tracked с `confidence >= 4`, случайные N (лимит сессии 5) | RU-предложение → пользователь печатает перевод → AI-разбор + правильный вариант → «Дальше» | **нет** (не пишет события, вне лимита) |

Дневной лимит (мягкий, FLQ-7) действует на SRS-режимы; практика перевода — вне его. Mini-review — режим `cards` c `lesson_id`.

## 3. Оценивание (амендмент ADR-0005)

GradeBar 0..5 с подписями: 5 Идеально · 4 С заминкой · 3 С трудом · 2 Ошибка, легко вспомнил · 1 Ошибка, вспомнил · 0 Полный провал. Хоткеи 0-5.

- **SM-2 (полная шкала)**, `sm2.py::apply_answer(state, *, quality, now)`:
  - q≥3: `repetitions += 1`; интервал 1 / 6 / `round(interval × EF)`; `EF += 0.1 − (5−q)·(0.08 + (5−q)·0.02)` (q5 +0.1, q4 0, q3 −0.14), floor 1.3;
  - q<3: `repetitions = 0`, `interval = 0`, `due = now`; EF по той же формуле (q2 −0.32, q1 −0.54, q0 −0.8), floor 1.3.
- **Confidence**: q≤2 → −1 (floor 0); q=3 → без изменений; q≥4 → +1 (cap 5).
- **Graduation**: q≥4 при `confidence = 5` → `known`, review_item деактивируется.
- ADR-0005 амендируется: строка переходов «tracked→tracked (confidence ±1)» уточняется маппингом качества (этот документ — источник правил).

## 4. Данные (миграция 0013)

`review_events` + колонка `quality SMALLINT NULL` (CHECK `quality BETWEEN 0 AND 5`). Новые события пишут quality и производный `answer_value` (`'correct'` при q≥3, иначе `'wrong'`). Старые строки — `quality NULL`. Новых таблиц нет.

## 5. Генерация упражнений (`modules/review/exercises.py`)

Переиспользует `ai_translation`: `OpenAICompatibleProvider`, `AIDisabled` (kill-switch `GLOSANO_LLM_ENABLED`), audit `AIRequest` (сырой текст не в логи — ADR-0003). Промпты — обобщённые версии CLI-промптов: языки из настроек (изучаемый / `preferred_translation_language_code`), контекст — текст item, личный перевод, заметки. Ответ — JSON в промпте; парсинг `extract_json` (первая `{` … последняя `}`), при непарсибельном ответе один ретрай, затем ошибка.

Виды (`kind`):

| kind | Вход | Выход (payload) |
|---|---|---|
| `example` | item | `{sentence, sentence_translation, base_form, base_form_translation}` |
| `cloze` | item | `{sentence_with_gap, sentence_translation, options: [{text, is_correct}×4]}` |
| `reverse` | item | `{sentence, options: [{text, is_correct}×4]}` |
| `translation_task` | item | `{sentence_translation}` (предложение на языке перевода) |
| `writing` | `review_item_ids[]` (ошибки сессии) | `{text}` — упражнение с пропусками + ответы, plain text (аналог `get_writing_exercise`) |

Плюс `translation_feedback(review_item_id, sentence_translation, user_text)` → `{feedback}` (разбор неточностей, оценка «плохо/нормально/хорошо/отлично», как `get_feedback_for_user_translation`).

## 6. API

- `GET /api/review/queue?lang=..&mode=due|new|practice[&lesson_id=..]` — due = текущее поведение (default); new = `last_reviewed_at IS NULL`, новые первыми, срез `min(20, остаток дневного лимита)`; practice = `confidence >= 4`, случайные ≤5, вне лимита.
- `GET /api/review/counts?lang=..` → `{due, new, practice, ai_enabled}` — для экрана выбора режима.
- `POST /api/review/exercise` `{review_item_id, kind}` (для `writing`: `{kind, review_item_ids}`) → payload из §5. 503 при выключенном AI; 404 чужой item; 502 при невосстановимой ошибке генерации.
- `POST /api/review/exercise/feedback` `{review_item_id, sentence_translation, user_text}` → `{feedback}`.
- `POST /api/review/answer` `{review_item_id, quality: 0..5}` — **заменяет** бинарный body (фронт и бек меняются атомарно; внешних потребителей нет).

## 7. Frontend (`features/review/`)

- **Экран выбора режима** (`/review` без `lessonId`): 5 плиток со счётчиками из `/counts`; AI-режимы (new/cloze/reverse/translation) disabled при `ai_enabled: false`. Режим — search-параметр `?mode=`.
- **GradeBar** — общий компонент 0..5 (подписи §3, хоткеи 0-5); заменяет ✗/✓ в существующем ReviewCard.
- **NewWordCard / ClozeCard / ReverseCard / TranslationPractice** — по §2; загрузка упражнения при показе карточки («Готовим упражнение…»), ошибка генерации → «Повторить» / «Пропустить» (пропуск не пишет событие).
- **Финальный экран SRS-режимов**: статистика + список слов сессии с q<4 («Повторите ещё раз») + для квизов кнопка «Письменное упражнение по ошибкам» (`kind='writing'`, отображается как текст).
- Инвалидации/stateless-сессии/фрешнесс-гейт — как в FLQ-7.

## 8. Тестирование

- Backend: unit SM-2 по всем q (EF-дельты, floor, reset); answer (confidence-маппинг, graduation q≥4/c5, событие с quality + производным answer_value); queue modes + counts; exercise/feedback с моком провайдера (JSON-парсинг, ретрай, AIDisabled → 503, ownership); migration-chain 0013.
- Frontend: GradeBar; экран выбора (счётчики, ai-off); каждый card-компонент; флоу сессий по режимам; ошибки генерации; миграция существующих flip-тестов на GradeBar.

## 9. Вне скоупа (осознанно)

- Кэш/префетч/предгенерация упражнений (решение «на лету»; кэш — очевидный follow-up при дорогих токенах).
- AI-разбор при ошибке в квизе (`get_explanation`) — Phase 2.
- TTS/аудио-режимы; mixing режимов в одной сессии; FSRS.
- Anti-cheat серверная проверка квизов (self-hosted, самооценка — финальный судья).
