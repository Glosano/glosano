# FLQ-28 — YouTube Video Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import YouTube captions as interactive learning material and play timed fragments/pages with optional automatic page navigation.

**Architecture:** Extend Lesson Library and its worker with a bounded transcript provider and versioned media facts. Extend the existing reader with one persistent iframe and a playback controller; preserve vocabulary, reading accounting, undo and explicit completion.

**Tech Stack:** Python 3.13+, FastAPI, SQLAlchemy/Postgres, Taskiq, youtube-transcript-api 1.2.4; React 19, TypeScript, TanStack Query, YouTube IFrame API.

**Spec:** `docs/superpowers/specs/FLQ-28-youtube-video-materials-design.md` (approved 2026-09-16).

## Global Constraints

- Manual captions before generated captions, learning-language matches only; never translate a track.
- Text limit 5 MiB, 20,000 cues, last cue end at most 6 hours; finite, ordered, positive intervals.
- Group at cue boundaries using the existing segmenter; soft fragment limits 20 seconds / 60 word-like tokens; split gaps over 1 second.
- PAGE_SIZE_WORDS remains 250; whole fragments remain indivisible.
- Auto paging starts disabled, is page-only, marks departing new words known and retains Undo. Manual seeking never marks skipped pages known.
- One pending transition at a time; UUID request id survives retry, including an already-undone result.
- No autoplay on entry; word cards, selection, hidden document, navigation and mode changes pause.
- Last fragment stops; completion still needs the existing explicit confirmation.
- Text editing preserves the ordered fragments and timing, checks source version and resets reader facts only when text changes.
- AI is optional; tokens remain surface forms; dictionary attribution remains mandatory.
- No media download, arbitrary URL fetch, cookies, proxy or provider secrets in export/logs.
- Existing unfinished changes are the integration baseline. Preserve them; do not commit them incidentally.
- Backend integration tests use real Postgres/Redis testcontainers, never SQLite.

## Task 1: Backend YouTube import, timed facts and reliable bulk transitions

**Files:** Create `backend/src/flinq/modules/lesson_library/youtube.py`, `video_import.py`, `video_segments.py` and migration(s) after `0018`; modify lesson library models/service/schemas/repo, worker tasks, lessons API, reader content/schemas/bulk/API, identity export and dependency lock. Add provider, normalization, worker/API/edit/export/bulk integration tests in the corresponding backend test directories.

**Interfaces:** JSON contracts consumed by Tasks 2–4:

```typescript
interface LessonMedia {
  provider: 'youtube'; video_id: string; canonical_url: string;
  title: string; author: string | null; language_code: string;
  is_generated: boolean;
}
interface TimedFields { media_start_ms: number | null; media_end_ms: number | null }
// GET lesson detail/content/edit: additive media: LessonMedia | null.
// Detail: import_error: { code: string; retryable: boolean } | null.
// Content sentences: TimedFields, existing seg_id/index/text/tokens unchanged.
// Edit: source_version:number, fragments:[{seg_id,text,...TimedFields}] | null.
// POST /api/lessons/import-youtube: {url,language_code,request_id}; 202 {id,status}.
// POST /api/lessons/{id}/retry-import: 202 {id,status}.
// PATCH /api/lessons/{id}: text payload unchanged OR
// {title,source_version,fragments:[{seg_id,text}]} for video.
// bulk-known: optional request_id UUID; result adds undone:boolean (default false).
```

- [x] Write failing tests for URL validation, manual/region/auto language selection (including Chinese aliases), cue overlap/equal starts/gaps, invalid limits and grouping; then run the focused tests to observe missing behavior.

```python
def test_canonical_youtube_id():
    assert parse_youtube_url("https://youtu.be/M7lc1UVf-VE?t=9") == "M7lc1UVf-VE"

async def test_retry_keeps_original_undo_action(client, bulk_request):
    first = await client.post("/api/reader/bulk-known", json=bulk_request)
    second = await client.post("/api/reader/bulk-known", json=bulk_request)
    assert second.json()["action_id"] == first.json()["action_id"]
```

- [x] Implement the provider with explicit endpoint/redirect restrictions, per-request timeouts and bounded total acquisition; map external errors to safe internal codes. Add pinned dependency through uv. oEmbed yields plain title/author; no HTML embedding.
- [x] Implement versioned media/cue facts, nullable timing columns, per-user import request identity and per-user bulk request identity. Reuse tokenizer and occurrence materialization with prepared fragments instead of resegmenting them.
- [x] Add asynchronous import creation/retry and worker acquisition outside database locks; use attempt/lease/version checks before atomic publication. Duplicate deliveries, deletion, rollback, stale attempts and worker cleanup are covered by tests.
- [x] Extend reader/detail/edit/export responses with the contracts above. Validate fragment IDs/order/count/nonempty text/version on edits; preserve timing and snapshot provenance across versions. Reject raw text replacement for video.
- [x] Implement idempotent bulk requests preserving the original action, reading accounting and undone state. Serialize concurrent identical requests; reject payload reuse with 409.
- [x] Run focused and regression tests (`uv run pytest tests/api tests/modules/lesson_library tests/modules/reader_state tests/modules/identity`), `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`; report exact results and any baseline failures. No commits of pre-existing changes.

## Task 2: Library import, failure retry and timed-fragment editing

**Files:** Modify `frontend/src/api/lessons.ts`, `features/library/ImportLessonDialog.tsx`, `EditLessonPage.tsx`, `LessonCard.tsx`; add `features/library/RetryVideoImport.tsx`, `videoImportErrors.ts` and localized video copy. Add focused library tests.

**Interfaces:** Consume Task 1 contracts. Reuse existing list/detail query invalidation and polling. Generate one UUID per import submission and reuse it for ambiguous network retries; generate a new one only after input changes or a completed import.

- [x] Write failing form tests covering URL submission without a title, progress/error visibility and retry of the same lesson; edit tests check that video sends ordered fragment IDs/text and source version.

```typescript
expect(await screen.findByLabelText('Ссылка YouTube')).toBeVisible()
expect(submitted).toEqual({ url, language_code: 'en', request_id: expect.any(String) })
expect(saved).toEqual({ title: 'Lesson', source_version: 2, fragments: [{ seg_id: 's1', text: 'Fixed.' }] })
```

- [x] Add the YouTube tab with current learning language, explanatory manual/generated policy and progress polling. Map error codes into useful EN/RU messages; expose retry in the dialog and failed library card without creating duplicates.
- [x] Add timing labels and per-fragment textareas to editing; keep timing readonly and the existing plain text editor for text lessons.
- [x] Run focused Vitest tests and TypeScript build; preserve existing file/text import behavior.

## Task 3: YouTube player boundary and playback controller

**Files:** Create `frontend/src/features/reader/video/youtubePlayer.ts`, `VideoPlayer.tsx`, `playback.ts` and tests.

**Interfaces:** Consume timed sentences and pages from existing pagination. Adapter owns iframe lifecycle with `play`, `pause`, `seek(seconds)`, `time()`, `rate()`, state/error notifications and disposal. Controller identifies active fragment, natural boundary versus seek and destination page; UI owns async bulk mutation.

- [x] Write behavior tests with a fake clock/player for pause/resume/replay, interval stop, gap highlighting, unexpected seeks, buffering/rate changes and natural automatic boundaries.

```typescript
expect(activeFragment([{ start: 1, end: 2 }, { start: 3, end: 4 }], 2.5)).toBe(-1)
// Crossing a page boundary naturally requests its successor once;
// a discontinuous jump reports a seek and never requests bulk-known.
```

- [x] Load iframe API only on explicit Play, create one iframe per material, set origin/playsinline and retain native controls. Handle embed errors and blocked autoplay with visible retry controls and preserve text access.
- [x] Poll while playing at 100 ms; stop at current bounds, infer seeks conservatively using elapsed time/rate/buffering. Hidden documents pause. Keep controls outside iframe, accessible, with EN/RU labels.
- [x] Verify controller/component tests; native playback and bounds remain subject to the open live browser acceptance in Task 4.

## Task 4: Reader integration, highlighting and automatic page transitions

**Files:** Modify `frontend/src/api/reader.ts`, `features/reader/ReaderPage.tsx`, `PageView.tsx`, `SentenceView.tsx`, `useReaderQueries.ts` and tests; create a focused hook for pending video transitions if needed. Update `docs/ui/reader.md`, `docs/ui/library.md`, decision log and AGENTS scope links.

**Interfaces:** One persistent VideoPlayer precedes the current text view. Reader passes interval/current fragment, auto toggle and callbacks for natural page boundary and user seek; page changes do not remount iframe. Task 1 bulk-known accepts request_id and returns undone.

- [x] Add tests for auto-off stopping; auto-on continuous page navigation and exactly one bulk call; seek skips without bulk; retry reuses UUID/range; pending save pauses at another boundary; Undo pauses/disables auto; last fragment never auto-completes.
- [x] Wire automatic navigation optimistically, save departing page in background, retain exact failed request and expose Retry. Block competing navigation/completion/undo while saving or awaiting retry. Handle version conflict by reloading material.
- [x] Use existing manual navigation semantics with idempotent request IDs; pause on word/phrase selection, mode change, manual navigation, completion and unmount. Restore a fragment start without autoplay.
- [x] Highlight active fragment without hiding token status; add separate timestamp seek controls, aria-current, reduced-motion scrolling and RTL compatibility. Video sentence label is «Фрагмент»; hide the obsolete audio placeholder for videos.
- [x] Run frontend tests/lint/type/build and backend regressions; record exact results and baseline failures in `docs/superpowers/specs/FLQ-28-youtube-validation.md`.
- [ ] Inspect real desktop/mobile layout and public YouTube playback. Live import passed on the local Docker stack; iframe/mobile checks are blocked by the browser environment and locked Mac (FLQ-28.3 AC8).
- [x] Review the complete change against the approved spec, resolve findings, update Backlog acceptance criteria and report delivery with exact verification results. Keep user baseline changes out of any feature commit.
