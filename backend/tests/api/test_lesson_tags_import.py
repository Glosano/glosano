"""Tags given at import time become the importer's personal labels (FLQ-39)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.modules.lesson_library.models import LessonTag
from tests.api._reader_helpers import library_items, register_and_onboard


@pytest.fixture
async def csrf(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> str:
    async def _noop(*args: object) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", _noop)
    return await register_and_onboard(client, f"{uuid.uuid4()}@example.com")


async def _tags(lesson_id: str) -> list[str]:
    async with session_scope() as s:
        rows = await s.scalars(
            select(LessonTag.tag)
            .where(LessonTag.lesson_id == uuid.UUID(lesson_id))
            .order_by(LessonTag.tag)
        )
        return list(rows.all())


def _text(title: str, **extra: Any) -> dict[str, Any]:
    return {"title": title, "language_code": "pt", "raw_text": "Olá mundo.", **extra}


async def test_text_import_stores_normalized_tags(client: AsyncClient, csrf: str) -> None:
    r = await client.post(
        "/api/lessons",
        json=_text("t", tags=[" Новости ", "новости", "B2", "", "a,b"]),
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 202, r.text
    assert await _tags(r.json()["id"]) == ["a", "b", "b2", "новости"]


async def test_import_without_tags_stores_none(client: AsyncClient, csrf: str) -> None:
    r = await client.post("/api/lessons", json=_text("t"), headers={"X-CSRF-Token": csrf})
    assert r.status_code == 202, r.text
    assert await _tags(r.json()["id"]) == []


@pytest.mark.parametrize("tags", [["x" * 41], [f"t{i}" for i in range(21)]])
async def test_invalid_tags_reject_the_import(
    client: AsyncClient, csrf: str, tags: list[str]
) -> None:
    marker = uuid.uuid4().hex
    r = await client.post(
        "/api/lessons", json=_text(marker, tags=tags), headers={"X-CSRF-Token": csrf}
    )
    assert r.status_code == 422
    assert await library_items(client, q=marker) == []


async def test_file_import_parses_comma_separated_tags(client: AsyncClient, csrf: str) -> None:
    r = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "pt", "tags": "News, b2；подкаст"},  # noqa: RUF001
        files={"file": ("a.txt", "Olá.".encode(), "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 202, r.text
    assert await _tags(r.json()["id"]) == ["b2", "news", "подкаст"]


async def test_file_import_rejects_an_overlong_tag(client: AsyncClient, csrf: str) -> None:
    marker = uuid.uuid4().hex
    r = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "pt", "title": marker, "tags": "x" * 41},
        files={"file": ("a.txt", "Olá.".encode(), "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 422
    assert "longer than 40" in r.json()["detail"]
    assert await library_items(client, q=marker) == []


async def test_youtube_import_stores_tags_and_a_replay_merges_them(
    client: AsyncClient, csrf: str
) -> None:
    payload = {
        "url": "https://youtu.be/M7lc1UVf-VE",
        "language_code": "pt",
        "request_id": str(uuid.uuid4()),
        "tags": ["News"],
    }
    first = await client.post(
        "/api/lessons/import-youtube", json=payload, headers={"X-CSRF-Token": csrf}
    )
    assert first.status_code == 202, first.text
    lesson_id = first.json()["id"]
    again = await client.post(
        "/api/lessons/import-youtube",
        json={**payload, "tags": ["b2", "news"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert again.json()["id"] == lesson_id
    assert await _tags(lesson_id) == ["b2", "news"]
