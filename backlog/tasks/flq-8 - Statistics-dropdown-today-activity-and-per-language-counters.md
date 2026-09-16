---
id: FLQ-8
title: 'Statistics dropdown: today activity and per-language counters'
status: Done
assignee:
  - Mark
created_date: '2026-05-03 18:35'
updated_date: '2026-09-10 15:48'
labels:
  - frontend
  - backend
dependencies:
  - FLQ-1
  - FLQ-5
  - FLQ-6
references:
  - 'https://www.figma.com/design/1iDFsUGSEku7QI87AkIBbb/Glosano?node-id=83-2'
documentation:
  - docs/architecture/2026-04-11-mvp-domain-model.md
  - docs/superpowers/specs/2026-07-25-library-reading-progress-design.md
  - docs/ui/stats.md
  - docs/superpowers/plans/FLQ-8-stats-plan.md
  - docs/superpowers/specs/FLQ-8-stats-design.md
  - docs/adr/ADR-0010-statistics-reading-accounting.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Реализовать выпадающую сводку по Figma 83:2. Решение пользователя 2026-09-10: полную страницу статистики пока не делаем; «Новые слова» — добавленные сегодня. Монеты, прослушивание, streak и time-spent исключены. Согласованный UI: docs/ui/stats.md. API GET /api/stats/overview?lang=...; текущие tracked/known/ignored из словаря, сегодняшние добавления/повторения из SRS, дневной учёт прочитанных вхождений при Next. Историческое чтение до установки не восстанавливаем. Полная страница, recent lessons, цели и выбор периода отложены. Прогресс карточек библиотеки остаётся в FLQ-22; lesson_progress не создаётся.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Дизайн выпадающей сводки зафиксирован в docs/ui/stats.md, без монет, прослушивания, streak, time-spent и перехода на полную страницу
- [x] #2 daily_user_stats unique (user_id, date), с отдельным языковым разрезом и защитой учёта чтения от повторных запросов
- [x] #3 В шапке работает сводка: известные/изучаемые записи, прочитано сегодня, новые слова сегодня, SRS graduation и доступные повторения
- [x] #4 Все показатели изолированы по пользователю и языку; ignored не входит в known; новые слова считаются по первому добавлению в SRS сегодня
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# FLQ-8 Statistics Dropdown Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent backend and frontend tasks, followed by combined review.

**Goal:** Implement the approved statistics dropdown with real per-language counts and today's new words.
**Architecture:** FastAPI overview reads current vocabulary and existing SRS history. Reader write-time accounting stores daily deduplicated reading activity. React Query feeds a Radix popover in AppTopBar.
**Tech Stack:** Python, SQLAlchemy/Postgres, Alembic, React, TypeScript, Radix, Tailwind, Vitest.
**Spec:** docs/ui/stats.md

## Global Constraints

- Only the dropdown; no full stats page, coins, listening, streak or fabricated goals.
- Today means UTC, as in existing review code; label it in UI.
- Preserve all pre-existing uncommitted changes, including review service and migration 0015.
- Work on codex/flq-8-statistics in current checkout to retain those dependencies; no commit/merge/push in this task.
- No new runtime dependencies; PostgreSQL/Redis integration tests use existing testcontainers.

## Task 1 — Backend (delegated)

Files: new modules/statistics/{models,schemas,service}.py, api/stats.py, migration 0016;
modify main.py, migrations/env.py, reader_state/bulk.py and test model registration.
Tests: backend/tests/modules/statistics and backend/tests/api/test_stats.py.

- [x] Record storage semantics in a new ADR before migration.
- [x] Write and run failing tests for auth, language/user isolation, day boundaries,
  current status counts, first SRS creation today, unique SRS graduations today,
  deduplication of overlapping reader ranges and undo preserving reading activity.
- [x] Implement GET /api/stats/overview?lang=en|ru|pt with response:
  `language_code: str`, `date: YYYY-MM-DD`, `timezone: "UTC"`,
  `known_items_count`, `tracked_items_count`, `ignored_items_count`,
  `tokens_read_today`, `new_items_today`, `learned_items_today`,
  `reviews_completed_today`, `due_reviews` (all nonnegative integers),
  `reading_tracking_started_at: ISO timestamp`.
- [x] Keep daily_user_stats unique(user_id,date), with a separate relational language
  breakdown. Deduplicate read occurrences by user/date/lesson/ordinal before atomic
  write-time increments in the same transaction as bulk-known. Do not count punctuation.
- [x] Existing vocabulary counts are computed from indexed source tables to avoid stale
  snapshots; today's new count uses each item's earliest ReviewItem.created_at;
  graduation uses distinct item identity in today's ReviewEvents.
- [x] Run targeted Postgres integration tests, migration upgrade/downgrade on disposable
  database, ruff and pyright on changed files. Report exact commands and limitations.

## Task 2 — Frontend (root)

Files: api/stats.ts, features/statistics/StatisticsDropdown.tsx and tests,
components/AppTopBar.tsx, lib/invalidateVocabularyViews.ts, review mutation invalidation,
local exported Figma ring assets in frontend/public/assets/statistics/. No new route.

- [x] Write failing tests for opening, today's metric labels, language switching,
  loading/error/retry, zero counts, keyboard close and absence of excluded controls.
- [x] Use the API contract from Task 1, query key ['stats', lang, UTC date].
- [x] Build the responsive 400px Radix popover with the exact exported ring glyph;
  use existing matching X/Chevron icons and theme tokens.
- [x] Add stats invalidation to existing vocabulary/review flows; refetch on open and
  day rollover. Do not allow errors or previous-language data to masquerade as zeros.
- [x] Run focused tests, typecheck/build/lint and inspect desktop/mobile in browser.

## Task 3 — Review and finalize (root + independent reviewer)

- [x] Review whole change for approved scope, correctness and regressions, fix findings.
- [x] Verify frontend checks and backend checks with actual results.
- [x] Update Backlog AC/notes and this plan to reflect evidence. No full-page claims.

## Rulings

- 2026-09-10: User explicitly narrowed FLQ-8 to dropdown and today's additions;
  original full-page/recent-lessons AC replaced, not implemented.
- Current indexed vocabulary counts are authoritative; daily aggregation is necessary
  for reading events only in this increment. This avoids maintaining duplicate mutable
  status counts across vocabulary and reader write paths.
- Read de-duplication is per occurrence per UTC day: stable under retry and overlaps,
  while deliberate reading on a different day counts again.

## Completion evidence

- Backend: 24 targeted tests passed, including real migration round-trip; pyright
  0 errors/warnings and ruff clean. See backend/tests/modules/statistics and API tests.
- Frontend: 292 tests passed (41 files). Command from frontend:
  `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run`.
  Node 24 native Web Storage must be disabled for existing jsdom/Zustand tests;
  no project configuration or dependencies changed for that environment issue.
- `node node_modules/typescript/bin/tsc -b` and Vite production build passed;
  Vite emits its existing >500 kB main bundle warning. Changed-file ESLint passes.
- Browser checks at 320/375/640/768/1280 px pass for panel fit, no document overflow,
  exact SVG loading and Escape focus return. Browser data was a test fixture.
- Independent review found no high/medium issues. Header changes received final
  browser checks after review.
- No commits, merge, push or deployment. Pre-existing dirty files retained.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-10: Пользователь взял FLQ-8 и предоставил Figma 83:2 + CSS. Явно исключил монеты и прослушивание; термин LingQ заменяем на «Новые слова». Изучен get_design_context. Создан docs/ui/stats.md со структурой сводки и страницы; пока проект для согласования, AC не отмечены. Задан вопрос о сводке + странице и трактовке «Новые слова» как впервые добавленных в изучение за период. Реализация не начата. Текущий reader не хранит историю чтения; review daily_goal_reviews общий для языков. В рабочем дереве есть многочисленные предшествующие изменения, включая review/service.py и миграцию 0015; сохранять их.

Пользователь согласовал только dropdown и новые слова сегодня. Предыдущее предложение о странице/периодах заменено. Реализация продолжается в codex/flq-8-statistics, все ранее изменённые файлы сохраняются.

Финальная проверка: 24 backend-теста прошли (Postgres/Redis, включая real migration round-trip), 292 frontend-теста прошли. Для Node24/jsdom запуск с NODE_OPTIONS=--no-experimental-webstorage. TypeScript/build/changed-file ESLint/Prettier, backend pyright/ruff прошли. Browser QA 320/375/640/768/1280: панель в пределах viewport, SVG загрузились, фокус возвращается. Визуальные данные — тестовый fixture. Независимое ревью без high/medium замечаний. Vite предупреждает о >500kB bundle, testcontainers — deprecated Redis wait; не связаны с логикой статистики. Рабочая БД не менялась, для запуска требуется upgrade миграции 0016. Коммит/merge/push не выполнялись.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
В шапке приложения добавлена выпадающая статистика по согласованному Figma-референсу. «Новые слова» показывает первое добавление в SRS сегодня, с изоляцией пользователя и языка; сводка содержит текущее знание/изучение, сегодняшнее чтение и SRS graduation, доступные повторения. Монеты, аудио, streak, цели и полная страница исключены по согласованному объёму. API читает реальные данные; миграция 0016 добавляет дневной учёт чтения с дедупликацией пересекающихся и повторных запросов. Undo сохраняет факт чтения. Проверено 24 backend + 292 frontend теста, миграции, typecheck/build/linters, desktop/mobile и keyboard. Для запуска нужна миграция 0016; историческое чтение до её установки не восстанавливается.
<!-- SECTION:FINAL_SUMMARY:END -->
