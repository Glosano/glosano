---
id: FLQ-24
title: 'Reader: закрепляемая панель словаря урока'
status: Done
assignee:
  - Mark
created_date: '2026-09-10 11:13'
updated_date: '2026-09-10 14:18'
labels: []
dependencies: []
references:
  - 'https://www.figma.com/design/1iDFsUGSEku7QI87AkIBbb/Glosano?node-id=92-2'
  - 'https://www.figma.com/design/1iDFsUGSEku7QI87AkIBbb/Glosano?node-id=93-2'
  - 'https://www.figma.com/design/1iDFsUGSEku7QI87AkIBbb/Glosano?node-id=94-2'
documentation:
  - docs/superpowers/specs/FLQ-24-reader-vocabulary-panel-design.md
  - docs/superpowers/plans/FLQ-24-reader-vocabulary-panel-plan.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Добавить в reader правую панель, которая по кнопке остаётся открытой и переключается между карточкой выбранного слова и списками лексики всего урока. Согласованы вкладки: «Добавленные» — впервые взятые в изучение из этого урока слова и фразы с текущим статусом/уровнем; «Новые» — ещё необработанные слова со статусом new; «Все» — уникальная лексика материала с текущими статусами. Клик по свободному месту при включённой панели возвращает список; при выключенной сохраняется временная карточка. Спека и план подготовлены до реализации; пользователь одобрил исполнение через subagent-driven-development.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопка включает и скрывает панель; карточка выбранного слова и список используют одну область, клик вне карточки возвращает список при включённой панели.
- [x] #2 Добавленные ограничены словами и фразами, впервые взятыми в изучение в этом уроке; текущий статус и уровень отображаются корректно.
- [x] #3 Новые содержат уникальные необработанные слова всего урока; добавление, знаю и игнорирование обновляют вкладку только после успешного сохранения.
- [x] #4 Все содержит уникальные слова материала и сохранённые фразы с актуальными статусами, без смешения языков и пользовательских словарей.
- [x] #5 Изменение уровня из списка, действия в карточке, bulk-known и undo согласованно обновляют список и подсветку reader.
- [x] #6 Панель доступна с клавиатуры и на узком экране; сбои загрузки и сохранения не скрывают текст урока и не показывают ложный успех.
- [x] #7 Спека и план с именами FLQ-id подготовлены до реализации; при реализации добавлены проверки фильтров, переходов и регрессий reader.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Одобренный план: docs/superpowers/plans/FLQ-24-reader-vocabulary-panel-plan.md. Спецификация: docs/superpowers/specs/FLQ-24-reader-vocabulary-panel-design.md. Последовательность: 1) read-only snapshot API на существующих таблицах, изоляция пользователей/языков, shared provenance, backend-тесты; 2) клиентские типы, фильтры и инвалидация Query cache; 3) общий desktop/sheet контейнер со встроенной WordCard, preference закрепления и единый dismiss; 4) вкладки, строки, быстрые действия, восстановление фокуса и интеграция bulk-known/undo. Координатор Mark; каждый этап выполняет новый subagent с RED/GREEN, адресными проверками, атомарным коммитом и отдельным task review. Финальная проверка: backend/frontend tests, lint/types/build, визуальный и клавиатурный smoke на desktop/mobile, AI-disabled и shared account isolation, общее ревью. Ветка codex/flq-24-reader-vocabulary-panel; существующие пользовательские изменения не включать в коммиты задачи.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-10: Пользователь попросил сначала спеку, затем план. Созданы оба документа; статус задачи остаётся To Do, продуктовый код не менялся. Figma 92:2, 93:2, 94:2 просмотрены, design context получен. В план включены текущие ограничения provenance и контекста после переимпорта; шкала ручного picker остаётся 1..4 с отображением фактических 0..5.

Пользователь одобрил реализацию и явно выбрал subagent-driven-development. Начата ветка codex/flq-24-reader-vocabulary-panel; этапы выполняются последовательно отдельными implementer-агентами, с task review и финальным ревью. Существующие незакоммиченные правки сохранены. План из документа одобрен к исполнению.

Backend реализован коммитом 40ab6d8; 37 тестов проходят, ruff clean, pyright 0 ошибок (2 старых предупреждения). Независимое task review выполняется. Docker API smoke подтвердил 21 запись, уровни 0/5, known/ignored, фразу и null context для отсутствующего вхождения.

Baseline frontend: 128 тестов прошли; сборка исходно падает на двух неполных LessonDetail fixtures в ReaderPage.test.tsx и bulkFlow.test.tsx. Их корректировка включена в этап интеграции ридера. В браузере подтверждён конфликт двух Escape-handlers, уже покрываемый согласованным единым dismiss.

Этапы 1 и 2 завершены и прошли независимое spec/code-quality review: 40ab6d8 (backend) и 8a7729d (frontend data). По backend финальный scope: 62 теста passed, ruff check clean, pyright 0 ошибок; общая проверка форматирования сообщает о 8 ранее существовавших файлах вне задачи. Этап 2: 23 теста passed, адресные lint/format clean.

Начат этап 3 — контейнер панели, embedded WordCard, preference, контекст и клавиатура. Дополнительно подтверждена предусмотренная планом проблема Vite proxy: default resolveConfig использует ignored vite.config.js с /api, исходный vite.config.ts не содержит /api. В этапе 3 добавляется один mapping в TS source, чтобы чистый запуск не зависел от старого generated-файла.

Task 3 реализован в ad90eca: единая desktop/mobile shell, embedded WordCard, nullable context, hotkeys и source /api proxy; 59 targeted + 7 bulk tests, production build PASS. Ревью выявило temp-card → pin переход, исправление выполняется original implementer. Browser: desktop pin/card/Escape и mobile card320/390 PASS; реальный list-slot и его мобильная высота остаются Task4. Существующие tracked изменения сохранены byte-for-byte.

Все четыре этапа реализации прошли scoped review. Коммиты: 40ab6d8, 8a7729d, ad90eca + 4fc35c2, e1ceeb1; форматирование 018fe09. Общий frontend: 40 файлов / 281 тест passed, production build passed, ESLint 0 ошибок / 2 старых предупреждения, Prettier всех изменённых frontend-файлов passed. Backend: 62 теста passed. Browser desktop/portrait: вкладки, действия, focus, bulk/undo, перевод, shared/logout проверены. Общее ревью выявило 4 обязательных исправления: SVG click dismiss, landscape clipping, вывод Wiktionary attribution и явная маркировка AI. Выполняется один общий fix wave; задача остаётся In Progress до повторной проверки.

Финальное исправление c6d6481 проверено отдельным reviewer: все 4 finding ADDRESSED, new breakage None, out-of-scope observations None. После финального кода: 55 focused и 284 full frontend tests passed, build/lint/Prettier passed. Дополнительно вручную проверены 844×390, 700×320, 1024×390 и реальные вложенные SVG controls. Словарная атрибуция/AI-disabled подтверждены непустыми fixtures; live AI маркировка проверена в браузере. Все AC закрыты.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
В reader добавлена закрепляемая панель с вкладками «Добавленные», «Новые» и «Все». Карточка и список используют одну область; быстрые действия, изменение уровня и перевода, bulk-known и undo обновляют персональный snapshot и подсветку. Snapshot учитывает весь урок, фразы, источник первого добавления и отсутствующий контекст; данные изолированы по пользователю и языку. Панель работает с клавиатуры и на узких/низких экранах, карточка явно маркирует AI-подсказки и показывает атрибуцию словаря.

Реализация выполнена через subagent-driven-development: четыре этапа с независимым ревью, одно общее ревью и одна общая волна исправлений c6d6481. Scoped re-review подтвердило устранение всех четырёх замечаний без новых проблем. Проверки: 284 frontend-теста, 62 backend-теста по согласованному scope, production frontend build; lint/types без ошибок, форматирование изменённых файлов проходит. Ручные проверки desktop/mobile/landscape, клавиатуры, bulk/undo и двух QA-аккаунтов выполнены.

Ветка codex/flq-24-reader-vocabulary-panel сохранена локально. Пользовательские незакоммиченные изменения сохранены побайтово. Dev Compose работает; отдельный чистый запуск production Compose не проверялся. Прежние предупреждения и форматирование восьми посторонних backend-файлов описаны в плане. Унаследованная проблема немедленного /me после login не изменялась.
<!-- SECTION:FINAL_SUMMARY:END -->
