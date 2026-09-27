# AGENTS.md

Guidance for AI agents (Claude Code, Cursor, Copilot, etc.) working in the Glosano repository.

## Project state

Glosano — self-hosted LingQ-like platform for content-driven language learning. Current phase: **pre-implementation**. The repository contains specifications and decision records only; no application code exists yet.

Before proposing or writing any code, read:

1. `docs/lingq-like-self-hosted-spec-2026.md` — source product specification (Draft v1, 2026-04-11).
2. `docs/specs/2026-04-11-mvp-product-alignment-design.md` — MVP decision log. Closes the open questions from §16–17 of the spec.
3. `docs/architecture/2026-04-11-mvp-architecture-overview.md` — high-level architecture overview (modular monolith + worker, Python 3.13+).
4. `docs/adr/ADR-0001-unit-of-learning-token-level.md`
5. `docs/adr/ADR-0002-word-status-model-and-reader-ui.md` — **superseded by ADR-0005**, kept as historical artifact.
6. `docs/adr/ADR-0003-llm-provider-openai-compatible.md`
7. `docs/adr/ADR-0004-dictionary-wiktionary-provider.md`
8. `docs/adr/ADR-0005-word-status-model-lingq-levels.md` — current word status model: `new / tracked / known / ignored` with confidence `0..5`.
9. `docs/adr/ADR-0006-tech-stack.md` — Python + React tech stack, repository layout, tooling.

Product direction is fixed by those documents. Do not reintroduce options that were explicitly rejected. If a decision needs to change, write a new ADR or revise the existing one with a clear status transition — never silently override.

## Product overview

Content-driven language learning: users import real texts, read them in an interactive reader, save unfamiliar words and phrases to a personal vocabulary, review them via SRS, and receive in-context AI translations. Everything runs on a user-owned server.

Five product layers (from spec §15):

1. Content ingestion
2. Interactive reader/player
3. Personal vocabulary and phrase memory
4. AI assistance layer
5. Analytics and self-hosted administration

## Key product decisions (quick reference)

Full rationale in the decision log and ADRs. This section is a lookup table, not the source of truth.

### MVP scope

- **Tenancy:** single-tenant self-hosted.
- **Client:** web-first responsive. No native mobile, no PWA, no offline.
- **Audience:** learner-only. No teacher/LMS features.
- **Library:** private imports + shared library inside the instance. License/source/author fields are required for shared content.
- **Import formats:** `.txt`, `.md`; YouTube URL with existing learning-language captions (ADR-0016). PDF/EPUB/scans go through an **external OCR service** with its own API that returns `.md`.
- **Languages (learning):** EN, RU, PT, ES, FR, DE, ZH-Hans (Simplified Chinese), JA, AR, HI — ADR-0012 supersedes the original three-language scope.
- **Languages (UI):** EN, RU.
- **Auth:** email + password. No SSO.
- **Delivery:** Docker Compose. Target class: personal homelab + small team.

### Unit of learning — ADR-0001

- Learning unit = **Token** (surface form), not lemma.
- Each word form is learned separately, LingQ-style: `poder`, `pode`, `pudesse`, `pudessem` are four distinct cards.
- **No `Lemma` entity** in the data model.
- Normalization on save: Unicode NFC → lowercase → trim leading/trailing punctuation. Diacritics preserved. Internal hyphens and apostrophes preserved.
- `Phrase` is a separate first-class entity with its own status and SRS item.
- **Unified SRS queue** for Token and Phrase (single review session, may use different card formats).
- User can manually edit both the text of an entry and its translation.

### Word status model — ADR-0005

Four statuses: `new`, `tracked`, `known`, `ignored`. Tracked items additionally carry a `confidence` value in range `0..5`.

| Status | Visual in reader | Card content on click |
|---|---|---|
| `new` | pale blue background | AI translation first (labeled AI-generated), dictionary below. Buttons: **Add to study** (→ `tracked`, confidence 1), **Ignore** (→ `ignored`), **I know this** (→ `known`) |
| `tracked` | yellow background (optional confidence gradient) | User's saved translation, confidence indicator `0..5`. Buttons: Edit translation, Adjust confidence, Move to known, Move to ignored |
| `known` | no highlight | Combined AI + dictionary, optional hint. Button: Move back to tracked (edge case) |
| `ignored` | no highlight (visually indistinguishable from `known` in MVP) | Short "Ignored" note. Button: Reactivate (→ `tracked`) |

Transitions:
- `new → tracked`: user clicks and saves. Confidence starts at 1 (or user-chosen value).
- `new → known`: **per-page bulk** — pressing "next page" promotes all remaining `new` occurrences on the current page to `known`. Does not affect `tracked`/`ignored` tokens.
- `new → ignored`: explicit Ignore action in the card. Typical for proper nouns, numbers, mis-segmented tokens, rare technical terms.
- `tracked → tracked` (`confidence ±1`): review session response (correct → +1, wrong → −1, clamped to `[0, 5]`).
- `tracked → known`: SRS graduation (successful review at `confidence = 5`) or manual mark.
- `tracked → ignored`: manual mark.
- `known → tracked`, `ignored → tracked`: manual revert (edge cases).
- No direct transitions between `known` and `ignored` — must go through `tracked`.

`ignored` is **not** counted in the `known` metric. This is the key product distinction: proper nouns and junk tokens do not pollute the "known words" count.

Reader must provide undo for the last bulk-known action.

### AI — ADR-0003

- **AI is optional.** Base product must work without an AI provider. Dictionary, reader, personal dict, SRS, and stats all function without AI.
- **MVP scope:** contextual translation of selected text only. No grammar explanation, no chat, no exercise generation in MVP.
- **Provider:** a single adapter compatible with the OpenAI Chat Completions API. Covers OpenAI, OpenRouter, vLLM, LM Studio, LocalAI, and Ollama (which exposes an OpenAI-compatible endpoint).
- **Configuration:** environment variables on the Docker Compose service:
  ```
  GLOSANO_LLM_BASE_URL=https://api.openai.com/v1
  GLOSANO_LLM_API_KEY=sk-...
  GLOSANO_LLM_MODEL=gpt-4o-mini
  GLOSANO_LLM_ENABLED=true
  ```
- `GLOSANO_LLM_ENABLED=false` is the admin kill-switch — reader and dictionary keep working, AI sections disappear from cards.
- AI responses are always marked as AI-generated. The canonical translation of a card is whatever the user explicitly wrote; AI output is draft material.
- AI response cache is **per-user**, keyed on `(user_id, model, prompt_hash)`. No sharing between users.
- Retry: simple exponential backoff, max 3 attempts, on network errors and 5xx.

### Dictionary — ADR-0004

- **Source:** Wiktionary dump via [Kaikki.org](https://kaikki.org/), licensed CC-BY-SA 4.0.
- Dump is ingested into local database tables on setup. Updating is a manual admin action.
- **License attribution is mandatory** in every card that shows dictionary data. Not an admin-toggleable option.
- `DictionaryProvider` interface exists from day one so additional sources can be added later. Only one implementation in MVP: `WiktionaryDictionaryProvider`.
- User's personal translations never merge back into the dictionary base — they live only in the personal dictionary.

### Metrics

Metrics in MVP:
- Count of read tokens.
- Count of `tracked` items (words + phrases).
- Count of `known` items (words + phrases). **Does not include `ignored`.**
- Count of `ignored` items (words + phrases) — stored, not shown as a hero metric.

No streak. No reading time. No heatmaps. Keep room for meaningful metrics after real usage data.

### Privacy

- JSON export of all user data (button in profile).
- Hard-delete of user profile (shared library and dictionaries untouched).
- Admin kill-switch for all external AI calls (see `GLOSANO_LLM_ENABLED`).
- Provider secrets in MVP live in container env vars — no DB-level secret encryption in MVP.

## Non-goals (do not propose for MVP)

If a user asks for any of these, point them at `docs/specs/2026-04-11-mvp-product-alignment-design.md` §13 and ask for an explicit scope change first.

- Native mobile apps (iOS, Android).
- PWA or full offline support.
- General audio/video import, TTS, STT, alignment, shadowing, speaking practice. **Exception: ADR-0016 accepts YouTube URL imports with existing learning-language captions, timed fragments, embedded playback and optional auto paging in MVP.**
- Teacher/coach workflows, LMS, cohort analytics.
- SSO, tenant isolation, quota management UI.
- Marketplace or federation between instances.
- Social feed, comments on lessons.
- Built-in catalog of curated lessons shipped with the product.
- Automatic language support beyond the ten-language catalog in ADR-0012, or automatic dictionary-package downloads.
- Shared AI cache between users.
- FSRS or other adaptive SRS in the first release (simple SM-2-class is fine).
- Metrics dashboard with heatmaps, cohorts, retention curves.
- Phrase/word lemma linking (explicitly rejected in ADR-0001).
- Removing the per-page bulk-known transition from the reader (explicitly required by ADR-0005).
- Counting `ignored` items into the `known` metric (explicitly rejected in ADR-0005 — this is the main improvement over the superseded ADR-0002).
- AI as the primary translation source for known words (AI-first) or as a replacement for the dictionary.
- Anthropic / Google / any non-OpenAI-compatible LLM backends in MVP (route through OpenRouter if needed).

## Open questions (deliberately deferred)

These are listed in `docs/specs/2026-04-11-mvp-product-alignment-design.md` §11 and must be resolved as they become blocking:

- Exact SRS algorithm (SM-2 vs FSRS vs custom).
- Tokenization rules for edge cases (apostrophes, hyphens, numbers inside words).
- Phrase matching across lessons (exact vs morphological variants).
- Page size in the reader (words? paragraphs? viewport-height?).
- Backup/restore procedure and ownership.
- Rate limiting for external AI calls.
- Wiktionary license attribution UI placement.

When you solve one of these during implementation, record it in a new ADR and remove it from the open questions list.

## Architecture

**TBD.** Architecture and data model design is the next planned phase. The high-level service list from spec §10 is a starting point, not a commitment:

- `web-app` (learner/admin UI)
- `api-gateway` / backend API
- `content-ingestion-service`
- `dictionary-service`
- `ai-orchestrator`
- `review-engine` (SRS)
- `stats-service`
- `worker` (background jobs)
- `postgres` (transactional data)
- `object storage` (media, imports)
- `redis` (queues, caches, ephemeral state)

The MVP likely collapses several of these into a single backend process — final structure will be decided in the architecture phase and recorded in a new ADR.

This section will be filled in with directory layout, data flow, and component responsibilities once code exists.

## Tech stack (ADR-0006)

**Backend** — Python 3.13+, FastAPI, Pydantic v2, SQLAlchemy 2.x async, Alembic, asyncpg, httpx, Taskiq (with Redis broker), loguru, typer, pydantic-settings, argon2-cffi. Package manager: **uv**. Linter/formatter: **ruff**. Type checker: **pyright**.

**Frontend** — React 19+, TypeScript strict, Vite, pnpm. State: **Zustand** (client) + **TanStack Query** (server). Routing: **TanStack Router**. Styling: **Tailwind CSS v4**. Icons: **lucide-react**. Tests: **Vitest** + **@testing-library/react**.

**Repository layout** — monorepo with `backend/`, `frontend/` and `extension/` at the root. Each directory is a self-contained project with its own lockfile. CI jobs are path-filtered: `backend/**`, `frontend/**` and `extension/**` trigger independent workflows. `extension/` is the browser importer (WXT, Chrome + Firefox MV3, ADR-0024); it talks to a Glosano instance through the learner's browser session.

**Delivery** — `app-api` and `app-worker` containers from the same `backend/` codebase. Frontend is built as static assets in a multi-stage Docker build and served by FastAPI via `StaticFiles`. Single `docker compose up`.

## Commands

**TBD.** Commands will be filled in after the project is scaffolded. Expected shape:

- `uv sync` — install backend deps
- `uv run glosano serve` — start app-api in dev
- `uv run glosano worker` — start Taskiq worker
- `uv run pytest` — backend tests
- `uv run ruff check . && uv run ruff format .` — lint & format
- `uv run pyright` — type check
- `uv run alembic upgrade head` — apply migrations
- `pnpm install` (in `frontend/`) — install frontend deps
- `pnpm dev` — start Vite dev server
- `pnpm test` — frontend tests
- `pnpm build` / `pnpm build:firefox` (in `extension/`) — build the browser extension into `.output/`
- `pnpm test` (in `extension/`) — extension tests
- `docker compose -f docker-compose.dev.yml up` — full dev stack

## Testing

- **Backend**: pytest + pytest-asyncio, testcontainers-python for real Postgres/Redis in integration tests, `httpx.AsyncClient` with `ASGITransport` for API tests. Every domain module from architecture overview §7 must have unit tests for its public service API.
- **Frontend**: Vitest + @testing-library/react + jsdom. Component tests colocated with source. Integration tests for reader flow, vocabulary actions, review session.
- **Never mock the database** in integration tests — use testcontainers, not SQLite.

## Database schema

**TBD.** Core entities planned (from spec §9 plus ADR-0001 adjustments):

- `User`, `UserProfile`
- `Lesson`, `LessonSegment`, `LessonSource`
- `Token` (learning unit, ADR-0001), `Phrase`
- `DictionaryEntry`, `DictionaryTranslation`, `DictionaryExample`
- `PersonalDictionaryEntry` (joins User ↔ Token/Phrase with status, translation, notes)
- `ReviewItem`, `ReviewEvent`
- `AIRequest`, `AIResponse`
- `StatsSnapshot`, `Goal`
- `Course`, `Collection`

Final schema will be recorded in an ADR before migrations are written.

## Deployment

**TBD.** Docker Compose is the committed delivery format. See ADR-0003 for LLM env var conventions. Kubernetes / Helm is out of scope for MVP.

## Guidelines for agents working in this repo

1. **Read the decision log and relevant ADRs first.** Product direction is settled; do not relitigate closed decisions in conversation.
2. **Respect non-goals.** If a user asks for a non-goal, cite the doc and request an explicit scope change. Do not silently implement it.
3. **Updating decisions requires an ADR.** Do not edit accepted ADRs in place; write a new one referencing the old and set the old to `Superseded`.
4. **Language conventions:**
   - Primary working language with the user is Russian.
   - Code, identifiers, API schemas, commit messages, PR titles: English.
   - Design docs, ADRs, decision logs: match the surrounding document (current docs are in Russian).
5. **Tokenization and status semantics** are subtle — ADR-0001 and ADR-0005 are mandatory reading before touching anything vocabulary-related. Do not special-case morphology for Russian; LingQ model is deliberate.
6. **When AI is disabled** (`GLOSANO_LLM_ENABLED=false`), the product must still run and the reader must still render cards — just without the AI section. Every AI-touching code path needs this graceful degradation.
7. **Never commit provider secrets.** API keys live only in environment variables or the developer's local `.env` (gitignored).
8. **Do not introduce dependencies on morphological analyzers** (`pymorphy3`, `spaCy`, `stanza`) in core code without an ADR. ADR-0001 explicitly rejected this class of dependency for the learning pipeline.
9. **CC-BY-SA attribution for dictionary data is not optional.** Any card rendering must include the Wiktionary attribution.
10. **Ask before destructive actions.** No force-pushing, no rewriting merged commits, no deleting branches or volumes without explicit user approval.

## Git conventions

### Формат сообщения

- Conventional commits: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`, `perf`
- Язык — английский (см. «Language conventions» выше), subject в императиве (`add`, `fix`)
- Не указывать соавторство (Co-Authored-By)
- Subject — одно предложение до 72 символов. Если нужна запятая или союз «и» — разбей на отдельные коммиты
    
### Привязка к задачам

- Номер задачи указывать в scope: `feat(FLQ-XXXXX): ...`, `fix(FLQ-XXXXX): ...`
- Для подзадач: `FLQ-{id}.{sub_id}` — например `feat(FLQ-32.1): ...`
- Не дублировать номер задачи в body или footer — scope достаточно
- Формат единый: всегда `FLQ-N`, как ID задачи в backlog, — не `flq-N`, не `task-N`

### Body коммита

- Body отвечает на вопрос **«зачем»**, а не **«что»** — diff покажет «что» сам
- Не писать changelog-style списки изменённых файлов или модулей
- Допустимо: контекст проблемы, причина выбранного решения, что **не** сделано и почему
- `BREAKING CHANGE:` в footer, если ломается публичный API

### Один коммит = одно логическое изменение

- Правило действует **внутри фичеветки во время разработки**: каждый коммит атомарен
- Не смешивать в одном коммите: фичу + рефакторинг + правку багов + обновление примеров
- Тесты коммитить вместе с кодом, который они тестируют (один `feat` коммит), либо отдельным коммитом `test:` перед реализацией (TDD red phase)
- Зависимости (`uv.lock`, `pyproject.toml`) коммитить отдельно, если они не часть фичи
- При мёрже эти атомарные коммиты схлопываются в один (см. «Слияние со сквошем») — противоречия нет: атомарность нужна для ревью ветки, сквош — для чистой истории целевой ветки

### Слияние со сквошем
- Фичеветки вливаются в `main`/`dev` **только со сквошем** — одна задача = один коммит в целевой ветке (нет merge-коммитов, история линейна)
- Итоговое сообщение **обязательно** переписать вручную: один заголовок `feat(FLQ-XXXXX): ...` + описание с «зачем» по всей задаче
- Не оставлять имя ветки (`fix/task-33`) или дефолтный список коммитов как сообщение
- Убирать автоматически добавленный `Co-authored-by`
- Итоговое сообщение должно следовать всем правилам выше (формат, привязка к задаче, описание)
- Локально без PR всегда делать слияние со сквошем явным сценарием:

```bash
git checkout main
git pull --ff-only
git merge --squash feature/...
# запустить тесты и линтер
git commit -m "feat(FLQ-XXXXX): add new feature"
```

- Не использовать обычное слияние для фичеветок:

```bash
git merge feature/...
```

- После успешных проверок и коммита со сквошем удалить локальную фичеветку:

```bash
git branch -d feature/...
```

- Если Git отказывается удалить ветку, потому что слияние со сквошем не сохраняет хэши исходных коммитов в истории `main`/`dev`, использовать `git branch -D feature/...` только после проверки, что squash-коммит создан и тесты прошли
- Через GitLab использовать опцию «Squash commits» в MR

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_workflow_overview()` tool to load the tool-oriented overview (it lists the matching guide tools).

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and finalization
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->

## Superpowers workflow docs and plans

Save plans to docs/superpowers/plans/
Save specs to docs/superpowers/specs/

Имя файла привязываем к задаче (FLQ-id), а не к дате:
- спека: `docs/superpowers/specs/FLQ-<id>-<slug>-design.md`
- план:  `docs/superpowers/plans/FLQ-<id>-<slug>-plan.md`
