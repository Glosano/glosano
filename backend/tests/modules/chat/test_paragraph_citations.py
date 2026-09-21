"""Gutter actions quote verified whole source paragraphs, including token-free UI text."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.modules.lesson_library.models import LessonSegment
from tests.api._reader_helpers import seed_ready_lesson
from tests.api.test_me_settings import register


@pytest.mark.parametrize("paragraph", ["“2026 Hello,  world.\nNext sentence 2027!”", "… !!! …"])
async def test_segment_anchor_quotes_whole_parent_including_edges(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, paragraph: str
):
    await register(client)
    lid = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text=paragraph + "\n\nOther paragraph."
    )
    async with session_scope() as s:
        segments = list(
            (
                await s.scalars(
                    select(LessonSegment)
                    .where(LessonSegment.lesson_id == lid)
                    .order_by(LessonSegment.ordinal)
                )
            ).all()
        )
    # Any displayed sentence inside the paragraph anchors the same whole source.
    anchors = [segment for segment in segments if segment.start_char_offset < len(paragraph)]
    for anchor in anchors:
        r = await client.post(
            "/api/chats/citations/paragraph",
            json={"lesson_id": str(lid), "source_version": 1, "segment_id": str(anchor.id)},
        )
        assert r.status_code == 200, r.text
        quote = r.json()
        assert quote["selected_text"] == quote["context_text"] == paragraph
        assert quote["context_start_offset"] == 0 and quote["context_end_offset"] == len(paragraph)
        assert quote["paragraph_index"] == 0
        assert quote["from_ordinal"] <= quote["to_ordinal"]
    invalid = await client.post(
        "/api/chats/citations/paragraph",
        json={"lesson_id": str(lid), "source_version": 1, "segment_id": str(uuid.uuid4())},
    )
    assert invalid.status_code == 404
    changed = await client.post(
        "/api/chats/citations/paragraph",
        json={"lesson_id": str(lid), "source_version": 2, "segment_id": str(anchors[0].id)},
    )
    assert changed.status_code == 409


async def test_paragraph_command_rejects_other_lesson_anchor_and_client_text(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await register(client)
    first = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text="First paragraph."
    )
    second = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text="Another paragraph."
    )
    async with session_scope() as s:
        segment = await s.scalar(select(LessonSegment).where(LessonSegment.lesson_id == second))
        assert segment
        segment_id = str(segment.id)
    body = {"lesson_id": str(first), "source_version": 1, "segment_id": segment_id}
    response = await client.post("/api/chats/citations/paragraph", json=body)
    assert response.status_code == 404
    response = await client.post(
        "/api/chats/citations/paragraph",
        json={**body, "selected_text": "Injected client paragraph"},
    )
    assert response.status_code == 422


async def test_large_paragraph_has_actionable_error_without_partial_citation(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await register(client)
    lid = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text="Word " * 1000
    )
    async with session_scope() as s:
        segment = await s.scalar(select(LessonSegment).where(LessonSegment.lesson_id == lid))
        assert segment
        segment_id = str(segment.id)
    response = await client.post(
        "/api/chats/citations/paragraph",
        json={"lesson_id": str(lid), "source_version": 1, "segment_id": segment_id},
    )
    assert response.status_code == 422 and response.json()["detail"] == "citation_too_large"
