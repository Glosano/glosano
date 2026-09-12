# FLQ-25 Add Learning Languages Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Добавлять один из десяти изучаемых языков из шапки и использовать его в приложении.
**Architecture:** Единый каталог на каждой стороне API, атомарное добавление языка, языковая сегментация поверх существующего pipeline.
**Tech Stack:** FastAPI, SQLAlchemy async, React, TanStack Query/Router, Jieba, TinySegmenter.
**Spec:** docs/superpowers/specs/FLQ-25-add-learning-languages-design.md

## Global Constraints

- Каталог: en, ru, pt, es, fr, de, zh-Hans, ja, ar, hi; флаги и поведение ADR-0012.
- UI EN/RU; AI опционален; Token surface form, без лемм; права/данные сохраняются.
- Не коммитить посторонние изменения; FLQ-10 уже находится в рабочем дереве.

### Task 1: Backend catalog and atomic profile addition

Files: core/languages.py; identity schemas/service; api/me.py; API/schema Literal consumers; tests/api/test_learning_languages.py.
Produces: `POST /me/learning-languages`, JSON `{ "language_code": "zh-Hans" }`, response MeResponse; existing languages preserved, current = selected.
- [x] Write failing API tests: add zh-Hans to [pt], repeat yields exactly [pt, zh-Hans], GET /me persists current, invalid xx -> 422, auth/CSRF enforced, preferences accept all ten.
- [x] Run `uv run pytest tests/api/test_learning_languages.py -q` to observe failures.
- [x] Implement shared `LearningLanguageCode = Literal["en", "ru", "pt", "es", "fr", "de", "zh-Hans", "ja", "ar", "hi"]`; update validators and type consumers.
- [x] Implement service with user row lock, append missing UserLearningLanguage, update last_language, flush; return fresh MeResponse.
- [x] Run API tests, ruff/pyright; inspect diff.

### Task 2: Frontend add-language flow

Owns frontend/** only, except existing FLQ-10 files not to modify. Read spec and ADR-0012 first.
Consumes POST /me/learning-languages above. Produces common catalog, form and usable routes.
- [x] Add tests for visible Add language action, ten choices with Chinese simplified, flags, duplicate-disabled/all-added states, cancel, rejected request retaining profile, success updating store/cache and navigation. Assert backend boundary payload `{language_code:'zh-Hans'}`.
- [x] Run new tests to observe missing flow.
- [x] Create `frontend/src/lib/languages.ts` with catalog/type/direction helper and localized labels. Reuse in LanguagePicker, PreferencesSettings, onboarding, route guard, StatisticsDropdown and other language-name consumers.
- [x] Create focused AddLanguageDialog with single selection, disabled duplicates, pending/error states, successful `meApi.addLearningLanguage(languageCode)` returning MeResponse. Preserve settings with server atomic endpoint, not full preferences replacement.
- [x] Add flags alongside labels, use accessible names independent of emoji. Apply language/RTL direction to content blocks in reader; keep UI direction and translation target unchanged.
- [x] Run `NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/vitest run`, tsc/build and targeted ESLint. No commits or backend edits.

### Task 3: Multilingual pipeline and integration

Files: lesson_library/tokenization.py/service.py; vocabulary/service.py; dictionary parser; backend deps/lock; tokenization and integration tests.
- [x] Add failing tests for `tokenize('我喜欢学习中文。', language_code='zh-Hans')` yielding multiple whole-word surfaces with exact original offsets; Japanese words; Hindi/Arabic combining marks; Unicode sentence boundaries; phrase normalization uses same language.
- [x] Add Jieba/TinySegmenter dependencies per ADR; extend signature without breaking callers and preserve source substrings. Run tokenizer tests and update worker/vocabulary callers.
- [x] Extend AI language names; dictionary code alias zh-Hans -> zh for imported records; retain explicit unavailable-pair behavior.
- [x] Verify Chinese lesson through import, worker, reader, vocabulary, review/stats with AI disabled and unavailable dictionary package. Run affected API/module suite.
- [x] Final frontend accessibility recheck and task Done. Backend/frontend review findings resolved; visual desktop/mobile check complete.

## Execution record

Task 1/3: primary agent. Task 2: one frontend implementer. UI and backend share only documented endpoint/catalog; no shared source files. No conflicting task requirements found. Existing task scope and flags already approved; implementation details are routine decisions recorded in ADR-0012.

Backend verification: 470 tests passed; ruff src/tests passed; targeted pyright 0 errors/0 warnings. Chinese import→reader→word/phrase→review/stats covered with AI disabled. Backend review findings fixed and independently rechecked. Frontend final full run: 348 tests in 50 files passed; tsc/build/targeted ESLint passed. Independent final reviewer reran 7 tests and confirmed current-language accessible name, keyboard flow and focus restoration.
