# UI spec — страница `Библиотека` (`/learn/:lang/library`)

- Статус: Draft v1
- Дата: 2026-05-01
- Макет-референс: Figma — [Glosano — Library](https://www.figma.com/design/1iDFsUGSEku7QI87AkIBbb/Glosano-%E2%80%94-Library?node-id=1-2), node `1:2` («Library — Desktop 1440»). Локальный экспорт: `docs/ui/library.png`.
- Связано с: ADR-0006 (tech stack), `docs/specs/2026-04-11-mvp-product-alignment-design.md` §3, §10 (форматы импорта, языки), `docs/architecture/2026-04-11-mvp-domain-model.md` §6 (Lesson library)

## 1. Назначение

Главная точка входа после логина. Отвечает за:

- быстрый возврат к недавним урокам (resume);
- обзор всех собственных и shared-уроков;
- запуск импорта нового урока;
- поиск и фильтрацию по библиотеке.

Это «hub» learner-сценария: всё чтение начинается здесь.

## 2. Маршрут и доступ

- Путь: `/learn/:lang/library`, где `:lang ∈ {en, ru, pt}` (decision log §10.1).
- Корневой `/library` или `/` авторизованного пользователя → редирект на `/learn/:lang/library`, где `:lang` берётся из `user_settings.last_learning_language_code` (нужно поле — см. §16).
- Доступ: `learner` (auth обязателен).
- **Query-параметров нет** (FLQ-36): вкладки `?tab=…` удалены вместе с вкладкой «Уроки».
- **Не URL, а client-state:** только search query (`libraryStore.search`). Подгрузка истории по дням — состояние `useInfiniteQuery`. Refresh ресетит до default'ов — это сознательно.

## 3. Layout (Figma desktop 1440)

```
┌─ TopBar — 64px ──────────────────────────────────────────────────────────┐
│ Glosano    Библиотека    Словарь                  [👤 АШ ▾]                │
└──────────────────────────────────────────────────────────────────────────┘
─── divider ───────────────────────────────────────────────────────────────
┌─ FilterRow — 78px ───────────────────────────────────────────────────────┐
│ [🔍 Поиск в Библиотеке]    Начальный ●━━━━━━━━ Продвинутый    [+ Импорт]│
└──────────────────────────────────────────────────────────────────────────┘
┌─ ContinueSection ────────────────────────────────────────────────────────┐
│ Продолжить изучение                                                      │
│ ‹ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ›                    │
│   │ cap14 │ │ cap15 │ │ cap16 │ │ cap17 │ │ cap18 │                      │
│   └───────┘ └───────┘ └───────┘ └───────┘ └───────┘                      │
└──────────────────────────────────────────────────────────────────────────┘
┌─ HistorySection ─────────────────────────────────────────────────────────┐
│ История                                                                  │
│ Сегодня · 26 сентября                                                    │
│ ‹ ┌───────┐ ┌───────┐ ›                                                  │
│ Четверг · 24 сентября                                                    │
│ ‹ ┌───────┐ ┌───────┐ ┌───────┐ … ещё N ›                                │
│                        [Показать ещё]                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

Размеры из Figma: card 220×250, gap 16px, cover 220×140, meta 110px.
Раскладка из двух секций вместо вкладок — FLQ-36
(`docs/superpowers/specs/FLQ-36-library-history-design.md`).

## 4. TopBar (global app shell)

| Элемент Figma | MVP | Комментарий |
|---|---|---|
| Logo `Glosano` (40,16) | ✅ | Кликабельный → `/learn/:lang/library` (текущий язык) |
| **Language picker** (новый) | ✅ | Чип `🇵🇹 Português ▾` рядом с логотипом. Меняет первый сегмент path: `/learn/pt/...` → `/learn/ru/...`. Список — изучаемые языки пользователя из `user_settings`. |
| `Tab/Library (active)` (169,17) | ✅ | Underline `2px`. Ведёт на `/learn/:lang/library` |
| `Слова` tab (283,17) | ✅ | Ведёт на `/learn/:lang/vocabulary` |
| `StreakChip` (🔥 1) | ❌ | Streak вырезан из MVP (decision log §9). Удалить из вёрстки |
| `CoinsChip` (170/100) | ❌ | LingQ-овская монетизация. Self-hosted продукту не нужно. Удалить |
| `AITokensChip` (4339) | ❌ | То же. Если в Phase 2 появятся per-user AI quotas — вернуть как админскую информацию, не gamification |
| `AvatarChip` (АШ + badge `3`) | ⚠️ | Аватар оставляем, badge уведомлений — out of MVP. Dropdown ведёт в Settings/Logout |

> **Решение по top bar:** в MVP остаются Logo, language picker, два таба (Библиотека, Словарь) и Avatar dropdown. Чипы streak/coins/AI tokens из вёрстки убираются. Это — global app shell для всех экранов, не локально на library.

## 5. Tabs верхнего уровня

В Figma на верхнем уровне два таба: `Библиотека` и `Слова`. В MVP global navigation:

- `Библиотека` → `/learn/:lang/library`
- `Словарь` → `/learn/:lang/vocabulary`
- `Повторение` → `/learn/:lang/review`
- `Статистика` → `/learn/:lang/stats`

`:lang` всегда подставляется из текущего активного языка (см. §4 language picker). Все эти разделы scoped по изучаемому языку.

Реализация — отдельный компонент `<AppTopBar>`, не часть страницы Library. Эта спека только фиксирует элементы, видимые в макете.

## 6. FilterRow

### 6.1 Search input

- Размер 420×42 (Figma `1:5`).
- Placeholder: «Поиск в Библиотеке».
- Поле выполняет поиск по `lessons.title` и `lesson_sources.author`. ILIKE с trigram-индексом.
- Debounce 300мс. Запрос — client-state (Zustand store или local state), не URL-параметр.

### 6.2 Import button

- Размер 198×37, primary green.
- Текст: «+ Импортировать урок».
- Поведение: открывает modal импорта с табами форматов:
  - **Текст** (paste textarea + опциональный title).
  - **Файл** (drag-and-drop + file picker, accept `.txt,.md`).
- В Figma также присутствует card «Импорт с YouTube» — см. §8.

### 6.3 Level slider — скрыт в MVP

Slider «Начальный ↔ Продвинутый» (Figma `3:6`) **из вёрстки убирается**. Поля `lessons.difficulty_level` в domain model нет. Возвращаем в Phase 2 вместе с автоматическим estimator'ом (по словарной частотности).

## 7. Секции «Продолжить изучение» и «История» (FLQ-36)

Вкладки (SubTabsRow из Figma, `Посмотреть все ›`) удалены: экран — две секции
одна под другой.

| Секция | Что показывает |
|---|---|
| `Продолжить изучение` | Начатые и не завершённые материалы: `reader_positions.last_activity_at IS NOT NULL AND completed_at IS NULL`, сортировка `last_activity_at desc`. Carousel с навигацией ‹ ›. Пустой список — секция не рендерится. |
| `История` | Все доступные материалы (own `private` + `shared`) по дням добавления (`lessons.created_at` в часовом поясе пользователя), дни по убыванию. Каждый день — заголовок («Сегодня · 26 сентября», «Вчера · …», «Четверг · 24 сентября») и своя горизонтальная carousel; если в дне больше 100 материалов — неинтерактивная плашка «ещё N». Внизу — сторож `IntersectionObserver` для подгрузки следующих дней и кнопка «Показать ещё». |

«Начат» = была осмысленная работа (сдвиг позиции, bulk-known, завершение,
слово/фраза из урока). Открыть материал или сменить режим чтения — не начать его.

## 8. CardsRow — карточки

### 8.1 Card/Lesson (Figma `7:13`..`7:49`)

Размер 220×250. Структура:

```
┌── Cover 220×140 ──────────┐
│                           │
│     [серия / тема]        │ ← цветная заливка серии
│     CAPÍTULO N            │
│                           │
└───────────────────────────┘
┌── Meta 220×110 ───────────┐
│ Capítulo 14 — Um Mapa     │ ← title, до 2 строк
│ das Índias                │
│                           │
│ ━━━━━━━━━━━━━━━━━━━━━━━   │ ← progress bar 196×4
│ 0% • Новые слова          │ ← coverage %
└───────────────────────────┘
```

**Cover:**
- В макете сейчас захардкоженный шаблон «60 DIAS / PORTUGUÊS / CAPÍTULO N» на жёлтом фоне.
- В MVP cover — **автогенерированный плейсхолдер** на основе `lessons.language_code` + `lessons.title` (палитра по hash от title). Пользовательский upload и `cover_url` — Phase 2.
- Серия / коллекция (`60 DIAS`) — это часть курса (`Course`/`Collection`). В MVP курсы/коллекции **отложены** (см. §13). Cover-плейсхолдер должен корректно работать без них.

**Meta:**
- `Title` — `lessons.title`, max 2 строки + ellipsis.
- `Progress bar` — доля прочитанного: `reader_positions.current_token_ordinal / MAX(lesson_token_occurrences.ordinal_in_lesson)`. Не coverage: показывает, сколько текста пройдено, а не насколько знакома лексика. Решение и обоснование — `docs/superpowers/specs/2026-07-25-library-reading-progress-design.md` §2.
- Подпись под баром — `{read_percent}% · {word_count} слов · {new_words_remaining} новых`. `new_words_remaining` — уникальные слова без `TokenItem`, встречающиеся **после** текущей позиции чтения.
- Статус (FLQ-36): «✓ Материал завершён» при `completed_at`; иначе «Не начат», если нет `last_activity_at` и прочитано 0%. В «Продолжить изучение» карточка (`variant="continue"`) дополнительно подписана «Последнее занятие: сегодня / вчера / 24 сент.».
- Заголовок карточки — `h4`: он вложен в заголовок дня (`h3`) секции «История».

Click на card → `/learn/:lang/lessons/$lessonId` (открывает reader, resume по `reader_positions`).

**Управление материалом (FLQ-26):** в правом верхнем углу карточки собственного
материала — кнопка «⋯», отдельная от ссылки в reader. Меню содержит
«Редактировать» и «Удалить». Для чужого общего материала меню не показывается.

«Удалить» открывает предупреждение с названием материала и кнопками «Да» / «Отмена».
Фокус сначала на «Отмена». После подтверждения и успешного ответа карточка исчезает.
Ошибка оставляет карточку и окно на месте, позволяет повторить запрос.

«Редактировать» открывает отдельную страницу `/learn/:lang/lessons/:lessonId/edit`,
без модального окна. Форма заполнена текущими названием и текстом. «Сохранить»
применяет изменения и возвращает в библиотеку; «Отмена» возвращает без сохранения.
Пустые поля и название длиннее 200 символов не принимаются. Ошибка сохранения не
стирает введённый текст. Пока запрос выполняется, повторное действие заблокировано.
Изменение текста сбрасывает позицию чтения, сохраняя словарь, SRS и накопленную
статистику (ADR-0013); предупреждение показано под текстом. Все строки доступны на RU/EN.

### 8.2 Card/YouTube (Figma `7:6`)

В макете отдельная карточка с иконкой YouTube и текстом «Вставьте ссылку на видео, чтобы создать урок с субтитрами».

> **Решение обновлено ADR-0016:** YouTube с готовыми субтитрами входит в MVP. Импорт доступен через вкладку YouTube в «+ Импортировать урок» в FilterRow; отдельная промо-карточка в CardsRow не требуется. Общий импорт URL/медиа остаётся вне MVP.

Если позже захочется promo-card для других форматов — это отдельная конструкция «coming soon», не функциональная.

### 8.3 NavPrev / NavNext (Figma `7:3`, `7:62`)

Стрелки горизонтального carousel'а. Появляются только когда есть items за viewport. Keyboard: `←`/`→` при focus в строке.

## 9. CardsFooter

Удалён вместе с вкладками (FLQ-36): «Посмотреть все ›» больше некуда вести —
все материалы и так видны в «Истории».

## 10. Полный список материалов

Отдельного grid-вида `?tab=lessons` нет (FLQ-36): полный список — это
«История» по дням с бесконечной подгрузкой (§7).

- Card компонент тот же.
- Фильтр «мои / общие» в UI не показывается (вне скоупа FLQ-36); `visibility` и `page` из client-state удалены.
- Порядок: дни по убыванию, внутри дня `created_at desc`.
- Язык НЕ в фильтрах — он уже в path (`/learn/:lang/...`). Бэкенд автоматически фильтрует по `lessons.language_code = :lang`.

## 11. Состояния

### 11.1 Loading
Carousel: 5 skeleton-карточек. Grid: skeleton-сетка.

### 11.2 Empty (новый пользователь)
В области CardsRow:
- Иллюстрация (опционально).
- Заголовок: «У вас пока нет уроков».
- Подзаголовок: «Импортируйте свой первый текст».
- CTA: повтор кнопки «+ Импортировать урок».
- Пустое состояние показывается, только когда пусты и «Продолжить изучение», и «История», а поиска нет.

### 11.3 Empty (поиск даёт 0)
Есть поиск, но пусто и в «Продолжить изучение», и в «Истории» — «Ничего не найдено».

### 11.4 Lesson processing
Card с `lessons.status = processing` — показывает spinner поверх cover'а и блокирует click (или ведёт на reader, который показывает full-screen processing state — см. `reader.md` §12.2).

### 11.5 Lesson failed
Card с red border + tooltip с error message + контекстное меню «Retry / Удалить».

## 12. Mobile layout (<md)

- TopBar схлопывается: logo + hamburger + avatar.
- FilterRow: search полноширинный, кнопка «Импорт» = floating action button (FAB).
- Заголовки секций и дней умещаются в одну строку.
- Carousel: 1 card visible с peek соседних.
- Grid: 1–2 колонки.

## 13. Связь с backend

API-вызовы делаются с `lang` из path (`/learn/:lang/library`). Бэкенд получает `lang` как query или header, фильтрует автоматически.

- `GET /api/lessons/continue?lang=:lang&q=...&limit=20` — «Продолжить изучение»: `{items: LessonSummary[]}`, `limit` 1..50.
- `GET /api/lessons/history?lang=:lang&q=...&tz=Europe/Moscow&before=2026-09-19&days=7` — «История» по дням: `{days: [{date, total, items}], next_before}`. `tz` — IANA-пояс из `Intl.DateTimeFormat().resolvedOptions().timeZone` (по умолчанию `UTC`, неизвестный Postgres пояс → 422); `before` — дата, исключительно (без него — с сегодняшнего дня); `days` 1..31 (по умолчанию 7); до 100 материалов на день, `total` — сколько всего. Следующая страница запрашивается с `before = next_before`; `null` — дней больше нет.
- `LessonSummary` содержит `last_activity_at` текущего пользователя (`null` — материал не начат).
- `POST /api/lessons` — создание урока из текста (lang в body).
- `POST /api/lessons/import-file` — multipart upload `.txt`/`.md`.
- `GET /api/lessons/$id/edit` — исходный текст и название, только владельцу.
- `PATCH /api/lessons/$id` — `{title, raw_text}`, атомарное сохранение; 409 при обработке импорта.
- `DELETE /api/lessons/$id` — удаление владельцем, 204 после успеха. Словарь и SRS сохраняются.
- Список возвращает `can_manage`; чужие или отсутствующие материалы дают 404 в операциях управления.
- Backend module owner: `Lesson Library` (architecture overview §7.2).

## 14. Закрытые решения и оставшиеся open questions

**Закрыто:**
- `lessons.level` поля нет, slider скрыт, авто-оценка — Phase 2.
- Cover — авто-плейсхолдер из (`title` hash + `language_code`); пользовательский upload — Phase 2.
- `Course`/`Collection` — отложены, плоский список.
- «Интерактивные уроки» tab — скрыт.
- Sort — `created_at desc`, toggle вернётся в Phase 2.
- Bulk-операции — отложены.
- **`new_words_count` в card meta** — закрыто: считается on-the-fly, в уникальных словах, только по остатку текста после позиции чтения. Денормализация в `lesson_progress` отвергнута — признак «новое слово» принадлежит паре (user, language) и инвалидировался бы веером по всем урокам языка.

**Остаётся открытым:**

## 15. Не входит в MVP

- Общий URL/PDF/EPUB/audio/video импорт; исключение — YouTube URL с готовыми субтитрами по ADR-0016.
- Интерактивные уроки (cloze в lesson, dictation, embed exercises).
- Streak / coins / AI token gamification chips.
- Notification badge на avatar.
- Курсы и коллекции (group lessons).
- Shared library marketplace между инсталляциями (decision log §13 non-goals).
- Уровень сложности урока (если откроется в Phase 2).
- Recommendations / next-lesson suggestions (§7.11 спеки — Phase 2+).

## 16. Domain model implications

URL-схема `/learn/:lang/...` требует одной правки domain model:

- **`user_settings.last_learning_language_code TEXT NULL`** — для редиректа `/` → `/learn/:lang/library` после логина. При первом логине новичка заполняется из onboarding (см. `onboarding.md`); далее обновляется при каждой смене языка через TopBar picker.

Альтернатива — выводить из MAX(`last_opened_at`) по `reader_positions`, но это доп. JOIN на каждый redirect и не работает для нового пользователя без открытых уроков.

## 17. Mapping Figma → код

Для последующей реализации:

| Figma frame | React-компонент | Файл |
|---|---|---|
| `TopBar` (1:3) | `<AppTopBar>` | `frontend/src/components/AppTopBar.tsx` (shared) |
| `FilterRow` (3:2) | `<LibraryFilterRow>` | `frontend/src/features/library/FilterRow.tsx` |
| `SubTabsRow` (4:2) | — (удалён в FLQ-36) | — |
| — | `<ContinueSection>` | `frontend/src/features/library/ContinueSection.tsx` |
| — | `<HistorySection>`, `<DaySection>` | `frontend/src/features/library/HistorySection.tsx`, `DaySection.tsx` |
| `CardsRow` (7:2) | `<LessonCarousel>` | `frontend/src/features/library/LessonCarousel.tsx` |
| `Card/Lesson` (7:13) | `<LessonCard>` | `frontend/src/features/library/LessonCard.tsx` |
| `Cover` (7:14) | `<LessonCover>` | `frontend/src/features/library/LessonCover.tsx` |
| `Progress` (7:21) | `<LessonProgressBar>` | shared component |

Чипы StreakChip / CoinsChip / AITokensChip из верстки **не реализуем** в MVP (см. §4, §8.2). YouTube-материалы включены в MVP по ADR-0016 и используют обычную карточку библиотеки.

### Подтверждённое завершение (FLQ-27)

Карточка показывает «Материал завершён» только при наличии персонального
`completed_at`. Процент позиции 100% сам по себе не считается подтверждением.
После завершения в ридере процент карточки равен 100%, в том числе у материала
без слов; после отмены снова применяется обычная формула позиции.

### YouTube-материалы (FLQ-28, ADR-0016)

В импорте есть вкладка YouTube со ссылкой и текущим изучаемым языком. Название
и автор получаются автоматически; приоритет у авторских субтитров, затем
автоматических на том же языке. Импорт одного видео создаёт приватный материал.
Окно можно закрыть во время обработки; библиотека показывает processing.
Ошибки различают недоступное видео/субтитры, отсутствие языка, блокировку YouTube,
сеть и превышение лимитов. Повтор восстанавливаемой ошибки использует тот же
материал. Повтор отправки после потери ответа использует тот же request_id.

Редактор видео показывает отдельные текстовые фрагменты с неизменными таймкодами.
Порядок и границы нельзя менять. Сохранение проверяет версию; изменение текста
сбрасывает позицию/завершение, сохраняя словарь, SRS и накопленные метрики.
