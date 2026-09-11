---
id: FLQ-9
title: 'Settings UI: profile, preferences, data export/delete'
status: Done
assignee:
  - Mark
created_date: '2026-05-03 18:35'
updated_date: '2026-09-11 11:15'
labels:
  - frontend
  - backend
  - i18n
dependencies: []
documentation:
  - docs/superpowers/specs/FLQ-9-settings-design.md
  - docs/superpowers/plans/FLQ-9-settings-plan.md
  - docs/adr/ADR-0011-ui-language-translation-target.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frontend для существующих backend endpoints (`/me`, `/me/onboarding`, `/me/last-language`, `DELETE /me`).

**Что нужно:**
- Routes: `/settings/profile`, `/settings/preferences`, `/settings/data`.
- Profile: display_name, email (read-only), change password (требует current + new), avatar initials.
- Preferences: ui_language switcher, learning_languages (add/remove via UI), translation_language, daily_goal_minutes, daily_goal_reviews.
- Data: JSON export download, hard-delete account flow (confirm + password re-entry per ADR-0008).
- Avatar dropdown в TopBar → Settings link.

**Зависимости:** —
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все 3 settings page работают
- [x] #2 Change password требует current_password + new_password (новый backend endpoint POST /me/password)
- [x] #3 Add/remove learning_languages обновляет user_learning_languages join-table
- [x] #4 Delete account flow двойной confirm + password
- [x] #5 JSON export скачивает все user data
- [x] #6 Все существующие UI-элементы, ошибки, подсказки и инструкции локализованы EN/RU; переключение без перезагрузки.
- [x] #7 Целевой язык переводов и AI-инструкций совпадает с языком интерфейса; исходный язык материала EN/RU/PT, сохранённые переводы не переписываются.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# FLQ-9 Settings and Localization Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent implementation tasks and combined review. Track steps with checkboxes.

**Goal:** Deliver profile/preferences/data settings and complete EN/RU localization, translating material into the interface language.

**Architecture:** Extend the identity API, add a lightweight shared translation catalog and reactive locale hook, and connect all UI and AI translation consumers to the user's UI language. Existing React Query, Zustand, FastAPI and PostgreSQL remain in place.

**Tech Stack:** Python 3.13, SQLAlchemy, FastAPI, React, TypeScript, Vitest, pytest.

**Spec:** `docs/superpowers/specs/FLQ-9-settings-design.md` (approved user refinement 2026-09-11).

## Global Constraints

- UI languages EN/RU; learning languages EN/RU/PT. Translation target equals UI language.
- All visible interface text, accessible labels, errors, hints and instructions use the selected locale. Never translate user-authored lesson content or overwrite saved personal translations.
- AI feedback/instructions use UI language; pedagogical material remains in the learning language. Per-user cache keys must distinguish target languages.
- Existing AI-disabled behavior, Wiktionary attribution and vocabulary status semantics remain supported.
- No new runtime dependencies. Preserve all pre-existing dirty/untracked files outside this task. Local squash merge into main authorized by the user on 2026-09-11; no push requested.
- Work on `codex/flq-9-settings-i18n` in the current checkout with explicit ownership of files between agents.
- Real PostgreSQL/Redis integration tests; no database mocks. Verify frontend English/Russian rendering and live switching, not only catalog contents.
- Baseline from preceding merge: 395 backend and 292 frontend tests passed; full backend formatting has eight pre-existing failures. Node24 Vitest requires `NODE_OPTIONS=--no-experimental-webstorage`.

## Shared Interfaces

Frontend `@/lib/i18n` exports `UiLanguage = 'en' | 'ru'`, `useI18n(): { language, t }`, `useTranslation(): Translator`, `translate(key, params?, language?)`, `getUiLanguage()`, `setUiLanguage(language)`. Russian source strings are catalog keys, parameters use `{{name}}`. Per-area English catalogs are merged centrally; no DOM text replacement.

`GET /me` adds `preferred_translation_language_code: 'en'|'ru'`, `daily_goal_minutes: number`, `daily_goal_reviews: number`.

`PATCH /me/profile { display_name }` and `PATCH /me/preferences { ui_language, learning_languages, daily_goal_minutes, daily_goal_reviews }` return complete `MeResponse`.

`POST /me/password { current_password, new_password }` returns `{ ok: true }`; other sessions revoked, current retained. `GET /me/export` returns JSON attachment. `DELETE /me { password }` keeps existing contract.

## Task 1 — Backend settings, data and target-language behavior

Owner: backend agent. Files: identity models/schemas/service/repo or focused new service modules, api/me.py, review services/prompts, relevant migration, backend tests. Record the new target-language decision in ADR-0011.

- [x] Add failing API/service tests for profile/preferences, full locale/target synchronization, invalid languages/empty selection/ranges, password checks/session revocation, isolated complete export and account deletion cascades.
- [x] Implement the shared API contracts. Synchronize legacy translation preferences with UI language in a migration; onboarding derives translation target from UI language even for legacy clients.
- [x] Filter review translations by UI language and generate AI feedback/writing instructions accordingly. Verify cache separation and no hardcoded Russian feedback.
- [x] Export explicit user-owned records with version/timestamp, excluding credentials/session tokens and other users. Verify lesson child rows, vocabulary satellites, review history, reader activity, AI metadata and FLQ-8 statistics.
- [x] Exercise deletion after fully loading profile/settings and with owned lesson/statistics rows; preserve other users and dictionary data per ADR-0008.
- [x] Run targeted real DB tests, Ruff and Pyright; report exact results and files changed.

Example contract test:

```python
response = await client.patch('/me/preferences', json={
    'ui_language': 'en', 'learning_languages': ['pt'],
    'daily_goal_minutes': 15, 'daily_goal_reviews': 500,
}, headers={'X-CSRF-Token': csrf})
assert response.status_code == 200
assert response.json()['preferred_translation_language_code'] == 'en'
```

## Task 2 — Reader and vocabulary localization

Owner: reader agent. Files: frontend/src/features/reader/**, features/vocabulary/**, lib/locales/reader.ts. Avoid shared components and root i18n implementation.

- [x] Add English rendering/locale-switch tests around representative reader/vocabulary flows.
- [x] Replace visible strings and aria/title/placeholder/error strings through `useTranslation`; use locale-aware number/plural formatting where needed.
- [x] Replace fixed `ru` target constants with `useI18n().language`; query keys and mutations must use target language and refetch safely when it changes.
- [x] Preserve every saved translation, lesson content, status action, dictionary attribution and keyboard affordance.
- [x] Run owned component tests and changed-file lint; report catalog completeness and remaining integration needs.

## Task 3 — Remaining application localization

Owner: application agent. Files: features/auth/**, onboarding/**, library/**, review/**, statistics/**; routes/learn.$lang.library.tsx, components/ConfidencePicker.tsx, lib/locales/app.ts.

- [x] Localize all visible text, labels, empty/loading/error states, generated-exercise instructions and help text.
- [x] Onboarding exposes one UI language choice and learning languages; derive payload.translation_language from UI language. Preview chosen locale reactively.
- [x] Keep review instruction direction explicit and preserve pedagogical exercise direction; locale-switch invalidates generated exercise payloads.
- [x] Add English rendering tests and run owned tests/lint. Preserve Russian behavior and catalog coverage.

## Task 4 — Shared locale infrastructure and settings pages

Owner: root. Files: lib/i18n.ts, lib/locales/common.ts, settings feature and routes, routeTree.ts, components/AvatarMenu.tsx/AppTopBar.tsx/LanguagePicker.tsx/ProtectedRoute.tsx/ui/**, api/me.ts/client.ts, stores/userStore.ts, main.tsx.

- [x] Test locale resolution (profile > persisted preference > Russian default), interpolation, live switching and English/Russian catalog coverage.
- [x] Implement catalog integration and reactive locale hook. Update document language and persistence; localize server error codes/messages without exposing unhandled validation objects.
- [x] Implement protected settings layout, profile/name/password form, preferences with at least one learning language and UI-derived translation target, personal minute goal and active review limit.
- [x] Implement JSON download and two-step deletion with password, pending/error states, session/cache cleanup after success.
- [x] Connect avatar Settings link and header language fallback on non-learning routes. Update user store and invalidate translated queries on locale changes.
- [x] Test form save/failure, password confirmation, export download, deletion confirmation/cancellation and auth guards.

## Task 5 — Integration and final verification

- [x] Review each task's diff and test report; resolve important findings before completion.
- [x] Scan application source for untranslated Russian/English UI literals and fixed translation targets; inspect all exceptions.
- [x] Run complete backend/frontend tests, typechecks, lint and production build after integration.
- [x] Browser-check profile/preferences/data, English/Russian switch, material→UI translation requests, responsive layout and keyboard flows on test data.
- [x] Record results and AC in Backlog; report limitations honestly. User subsequently authorized committing and merging locally with squash.

## Verification record — 2026-09-11

- Frontend: 331 tests in 47 files passed on the integrated code; TypeScript passed; ESLint had zero errors and the existing VocabularyPage fast-refresh warning. Production build passed (existing large-chunk warning).
- Browser fixture scenarios: profile save, live RU→EN switch, document language, JSON download, deletion cancellation/password reset/success; widths 320/375/768/1280 had no horizontal overflow or page errors.
- Scoped reviews approved reader/vocabulary, remaining application localization and settings. Backend concurrent login/password finding fixed and follow-up review approved. Final cross-scope integration review approved after fixing stale GET /me overwrites; two regression cases passed.
- Backend full Ruff passed; Pyright zero errors. Final PostgreSQL/Redis suite, migration and real-API browser verification are pending: OrbStack reports Running, but Docker API times out even on `_ping`. No shared runtime restart performed without approval.
- Deployment requires Alembic revision 0017; the developer database was not migrated. Personal sentence-cache downgrade behavior is recorded in ADR-0011.

## Runtime verification follow-up — 2026-09-11

- Docker recovered without an agent-initiated OrbStack restart. Full backend suite: 417 passed, 5 dependency deprecation warnings, 34.93s. Separate migration round-trip test also passed.
- User reported HTTP 500 for sentence translation. API traceback confirmed UndefinedColumnError: lesson_segment_translations.user_id; live database was still at 0016_statistics.
- Applied the tested Alembic upgrade to the local Flinq database; current revision is 0017_ui_language_translation (head). Read-only verification for the reported lesson confirmed material pt, profile UI en, preferred target en and the new cache user_id column.
- No feature code changes were needed for this runtime error. A real OpenRouter retry for the private lesson was rejected by automatic approval review because it sends lesson text externally and saves a cache record. It was not retried indirectly; user approval is needed for that optional real-provider confirmation.

## Completion and integration

All implementation scopes and static reviews are complete. Fresh pre-integration checks: backend 417 passed, frontend 331 passed, Ruff passed, Pyright and TypeScript zero errors, ESLint zero errors, production build passed. Existing dependency/typing, fast-refresh and bundle-size warnings remain. Browser UI was checked with API fixtures; backend integration tests used real temporary PostgreSQL/Redis with a test LLM provider. A production-provider retry is optional and was not executed.

User authorized a commit and local squash merge into main. The commit includes only FLQ-9 application code, tests, migration 0017, ADR/design/plan and its Backlog record. Unrelated workspace changes and tool artifacts are excluded.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-11: Начат анализ FLQ-9 после squash FLQ-8 в main (c42c7c2). Проверены api/me.py, identity models/service/repo, AvatarMenu, LanguagePicker, routeTree и ADR-0008. Endpoints изменения профиля/предпочтений, смены пароля и экспорта отсутствуют. Onboarding только добавляет языки; для удаления нужен отдельный settings API. GET /me не возвращает translation language и daily goals. В UI нет общего i18n; daily_goal_minutes хранится, но время не измеряется. Для удаления аккаунта нужно проверить полные каскады, включая статистику FLQ-8, и конфликт между общей формулировкой сохранения shared library и ADR-0008 (владельческие lessons удаляются). Изменения приложения не начаты. Запрошено наличие Figma-макета; готовится конкретное предложение. Существующие dirty/untracked файлы сохранены.

Подготовлено предложение docs/superpowers/specs/FLQ-9-settings-design.md: 3 страницы, отдельные PATCH profile/preferences, POST password, GET export, полный тест удаления. До реализации требуется согласовать глубину EN/RU локализации (весь текущий UI либо настройки+шапка с отдельной задачей на остальное). Вопрос по макету Figma задан. Спецификация пока proposal, код не изменён.

Пользователь 2026-09-11 явно согласовал общую локализацию всех элементов и инструкций и перевод с языка материала на язык интерфейса. Согласованный scope записан в спецификацию и план. Отдельный выбор translation_language убирается; legacy API поле синхронизируется с UI. Реализация в codex/flq-9-settings-i18n. Разделение владельцев: backend; reader/vocabulary; остальные экраны; root — общий i18n, settings и интеграция.

Реализованы три страницы настроек, общий EN/RU каталог, локализованные формы/ошибки/инструкции и material→UI target во всех потребителях; ADR-0011 и migration 0017. Frontend: 329 тестов/47 файлов, TypeScript и production build прошли; ESLint 0 ошибок (существующее fast-refresh предупреждение). Браузерные сценарии с изолированными API fixtures прошли: сохранение, RU→EN, экспорт, отмена/подтверждение удаления, ширины 320/375/768/1280. Backend: Ruff прошёл, Pyright 0 ошибок; 417 тестов собираются. Финальные реальные PostgreSQL/Redis тесты, migration и live API browser заблокированы: OrbStack Running, Docker _ping timeout. Разрешение на перезапуск общей среды запрошено; без него shared runtime не перезапускался. Scoped reviews одобрены после исправления гонки login/password и холодной загрузки settings; финальный integration review продолжается. Задача остаётся In Progress до завершения проверок.

Итоговый cross-scope review одобрен после исправления гонки фонового GET /me: запоздавший ответ больше не возвращает старые настройки после PATCH. Два регрессионных сценария воспроизведены red и проходят после исправления. Финальный frontend: 331 тест/47 файлов passed, TypeScript passed, changed-settings ESLint passed, Vite build passed. Все review замечания закрыты. In Progress сохраняется только из-за неподтверждённых финальных backend/migration/live-API проверок: Docker API не отвечает; разрешение на перезапуск OrbStack ожидается.

Docker снова доступен без перезапуска со стороны агента. Полный backend: 417 passed/5 dependency warnings; migration round-trip отдельно passed. По сообщению пользователя найден точный источник HTTP500 sentence translation: UndefinedColumnError lesson_segment_translations.user_id, база оставалась на 0016. Применён проверенный upgrade до 0017_ui_language_translation(head). Read-only проверка конкретного урока: language=pt, UI=en, target=en, новая колонка существует. Код менять не потребовалось. Реальный повтор через OpenRouter автоматическая проверка разрешений отклонила из-за отправки частного текста и записи кэша; обход не выполнялся, ожидается разрешение пользователя для финального live retry.

Пользователь разрешил коммит и локальное squash-слияние в main. Финальные проверки перед интеграцией: backend417passed, frontend331passed, Ruff passed, Pyright/TypeScript0errors, ESLint0errors, build passed. Все AC подтверждены реализацией, API-интеграционными тестами и браузерной проверкой интерфейса. Реальный вызов OpenRouter не требуется для слияния и не выполнялся. В коммит отобраны103 файла FLQ-9; посторонние изменения исключены.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Settings now expose profile/password, language/preferences and JSON export/account deletion. All existing UI and instructions support English and Russian; translations use the interface language while preserving material and saved personal translations. Migration 0017 aligns legacy preferences and isolates sentence caches by user. Applying this migration fixed the reported missing-column HTTP 500 in the local database.

Validation: 417 backend tests and 331 frontend tests passed; real PostgreSQL/Redis migration and concurrency coverage, TypeScript/Pyright zero errors, Ruff and ESLint zero errors, production build passed. Browser fixture checks passed for saving, locale switching, export, deletion and mobile widths. Scoped and integration reviews approved. Existing warnings remain; a real OpenRouter request with private lesson content was not retried after automatic approval review blocked it.

User authorized committing and a local squash merge into main. No remote push requested. Local database is already at 0017; other installations must apply Alembic upgrade head.
<!-- SECTION:FINAL_SUMMARY:END -->
