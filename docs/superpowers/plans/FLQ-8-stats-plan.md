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
