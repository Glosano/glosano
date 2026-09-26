"""last_activity_at: какие действия считаются работой с материалом (FLQ-36)."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.modules.reader_state.models import ReaderPosition
from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson


async def _activity(lesson_id: uuid.UUID) -> datetime | None:
    async with session_scope() as s:
        return await s.scalar(
            select(ReaderPosition.last_activity_at).where(ReaderPosition.lesson_id == lesson_id)
        )


async def _put(
    c: AsyncClient,
    csrf: str,
    lesson_id: uuid.UUID,
    *,
    ordinal: int,
    mode: str = "page",
    segment_id: object = None,
) -> None:
    r = await c.put(
        "/api/reader/positions",
        json={
            "lesson_id": str(lesson_id),
            "view_mode": mode,
            "current_segment_id": segment_id,
            "current_token_ordinal": ordinal,
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 204, r.text


async def _lesson(c: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> tuple[str, uuid.UUID]:
    csrf = await register_and_onboard(c, f"activity-{uuid.uuid4()}@example.com")
    return csrf, await seed_ready_lesson(c, csrf, monkeypatch)


async def test_first_open_is_not_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    await _put(client, csrf, lesson, ordinal=3)
    assert await _activity(lesson) is None


async def test_same_position_and_mode_switch_are_not_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    await _put(client, csrf, lesson, ordinal=3)
    await _put(client, csrf, lesson, ordinal=3)
    await _put(client, csrf, lesson, ordinal=3, mode="sentence")
    assert await _activity(lesson) is None


async def test_moving_position_is_activity_and_reopening_keeps_it(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    await _put(client, csrf, lesson, ordinal=3)
    await _put(client, csrf, lesson, ordinal=7)
    moved_at = await _activity(lesson)
    assert moved_at is not None
    await _put(client, csrf, lesson, ordinal=7)
    assert await _activity(lesson) == moved_at


async def test_mode_switch_with_new_ordinal_is_not_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The reader saves the page end in page mode and the sentence end in
    # sentence mode, so toggling the mode also changes the ordinal.
    csrf, lesson = await _lesson(client, monkeypatch)
    await _put(client, csrf, lesson, ordinal=7)
    await _put(client, csrf, lesson, ordinal=3, mode="sentence")
    await _put(client, csrf, lesson, ordinal=7)
    assert await _activity(lesson) is None


async def test_segment_move_is_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    first, second = (await _sentences(client, lesson))[:2]
    await _put(client, csrf, lesson, ordinal=3, mode="sentence", segment_id=first["seg_id"])
    assert await _activity(lesson) is None
    await _put(client, csrf, lesson, ordinal=3, mode="sentence", segment_id=second["seg_id"])
    assert await _activity(lesson) is not None


async def _sentences(c: AsyncClient, lesson_id: uuid.UUID) -> list[dict[str, object]]:
    r = await c.get(f"/api/lessons/{lesson_id}/content")
    assert r.status_code == 200
    return [sent for para in r.json()["paragraphs"] for sent in para["sentences"]]


def _word_ordinals(sentence: dict[str, object]) -> list[int]:
    tokens = sentence["tokens"]
    assert isinstance(tokens, list)
    return [tok["i"] for tok in tokens if "i" in tok]


async def test_bulk_known_is_activity(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    words = _word_ordinals((await _sentences(client, lesson))[0])
    r = await client.post(
        "/api/reader/bulk-known",
        json={
            "lesson_id": str(lesson),
            "source_version": 1,
            "from_ordinal": words[0],
            "to_ordinal": words[-1],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    assert await _activity(lesson) is not None


async def test_completion_is_activity(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    last = (await _sentences(client, lesson))[-1]
    words = _word_ordinals(last)
    r = await client.post(
        "/api/reader/complete",
        json={
            "lesson_id": str(lesson),
            "source_version": 1,
            "view_mode": "sentence",
            "last_segment_id": last["seg_id"],
            "from_ordinal": words[0],
            "to_ordinal": words[-1],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    assert await _activity(lesson) is not None


async def _create_word(
    c: AsyncClient,
    csrf: str,
    *,
    text: str,
    lesson_id: uuid.UUID | None,
    segment_id: object = None,
) -> tuple[int, dict[str, object]]:
    r = await c.post(
        "/api/vocabulary/items",
        json={
            "kind": "token",
            "language_code": "pt",
            "text": text,
            "status": "tracked",
            "confidence": 1,
            "lesson_id": str(lesson_id) if lesson_id else None,
            "segment_id": segment_id,
        },
        headers={"X-CSRF-Token": csrf},
    )
    return r.status_code, r.json()


async def test_word_from_lesson_is_activity_and_creates_position(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    status, _ = await _create_word(client, csrf, text="edifício", lesson_id=lesson)
    assert status == 201
    async with session_scope() as s:
        position = await s.scalar(select(ReaderPosition).where(ReaderPosition.lesson_id == lesson))
    assert position is not None
    assert position.last_activity_at is not None
    assert position.current_token_ordinal is None


async def test_word_without_lesson_is_not_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    status, _ = await _create_word(client, csrf, text="antigo", lesson_id=None)
    assert status == 201
    assert await _activity(lesson) is None


async def test_patching_word_from_lesson_is_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    status, item = await _create_word(client, csrf, text="praça", lesson_id=None)
    assert status == 201
    r = await client.patch(
        f"/api/vocabulary/items/token/{item['item_id']}",
        json={"status": "known", "lesson_id": str(lesson)},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    assert await _activity(lesson) is not None


async def test_patching_word_without_lesson_is_not_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    status, item = await _create_word(client, csrf, text="praça", lesson_id=None)
    assert status == 201
    r = await client.patch(
        f"/api/vocabulary/items/token/{item['item_id']}",
        json={"status": "known"},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    assert await _activity(lesson) is None


async def test_rejected_word_is_not_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf, lesson = await _lesson(client, monkeypatch)
    other = await seed_ready_lesson(client, csrf, monkeypatch, title="Other material")
    foreign_segment = (await _sentences(client, other))[0]["seg_id"]
    status, _ = await _create_word(
        client, csrf, text="gosto", lesson_id=lesson, segment_id=foreign_segment
    )
    assert status == 422
    assert await _activity(lesson) is None
