"""POST /api/lessons stores page provenance for browser-extension imports (FLQ-38)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.modules.lesson_library import service
from glosano.modules.lesson_library.models import LessonSource

from ._reader_helpers import register_and_onboard


@pytest.fixture
async def csrf(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> str:
    async def _noop(lesson_id: object, job_id: object) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", _noop)
    return await register_and_onboard(client, f"{uuid.uuid4()}@example.com")


def _body(**extra: Any) -> dict[str, Any]:
    return {
        "title": "Artigo",
        "language_code": "pt",
        "raw_text": "Olá mundo.\n\nSegundo parágrafo.",
        "visibility": "private",
        **extra,
    }


async def _sources(lesson_id: str) -> list[LessonSource]:
    async with session_scope() as s:
        rows = await s.scalars(
            select(LessonSource).where(LessonSource.lesson_id == uuid.UUID(lesson_id))
        )
        return list(rows.all())


async def test_source_is_stored_as_url_provenance(client: AsyncClient, csrf: str) -> None:
    r = await client.post(
        "/api/lessons",
        json=_body(
            source={
                "url": "https://example.com/pt/artigo?id=1",
                "author": "  Ana Souza ",
                "site_name": "Exemplo",
            }
        ),
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 202, r.text
    [source] = await _sources(r.json()["id"])
    assert source.source_type == "url"
    assert source.source_uri == "https://example.com/pt/artigo?id=1"
    assert source.author == "Ana Souza"
    assert source.source_label == "Exemplo"
    assert source.original_filename is None


async def test_blank_author_and_site_name_become_null(client: AsyncClient, csrf: str) -> None:
    r = await client.post(
        "/api/lessons",
        json=_body(source={"url": "http://example.com/a", "author": "  ", "site_name": ""}),
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 202, r.text
    [source] = await _sources(r.json()["id"])
    assert source.author is None
    assert source.source_label is None


async def test_without_source_stays_manual(client: AsyncClient, csrf: str) -> None:
    r = await client.post("/api/lessons", json=_body(), headers={"X-CSRF-Token": csrf})
    assert r.status_code == 202, r.text
    [source] = await _sources(r.json()["id"])
    assert source.source_type == "manual"
    assert source.source_uri is None


@pytest.mark.parametrize(
    "source",
    [
        {"url": "ftp://example.com/a"},
        {"url": "javascript:alert(1)"},
        {"url": "example.com/no-scheme"},
        {"url": "https://example.com/" + "a" * 2048},
        {"url": "https://example.com/a", "license": "CC-BY"},
        {"author": "Ana"},
    ],
)
async def test_invalid_source_is_rejected(
    client: AsyncClient, csrf: str, source: dict[str, str]
) -> None:
    r = await client.post("/api/lessons", json=_body(source=source), headers={"X-CSRF-Token": csrf})
    assert r.status_code == 422, r.text


async def _ready_lesson(client: AsyncClient, csrf: str, **extra: Any) -> str:
    r = await client.post("/api/lessons", json=_body(**extra), headers={"X-CSRF-Token": csrf})
    assert r.status_code == 202, r.text
    lesson_id = r.json()["id"]
    async with session_scope() as s:
        await service.process_lesson_import(s, uuid.UUID(lesson_id))
    return lesson_id


async def test_text_edit_keeps_url_provenance(client: AsyncClient, csrf: str) -> None:
    lesson_id = await _ready_lesson(
        client,
        csrf,
        source={"url": "https://example.com/a", "author": "Ana", "site_name": "Exemplo"},
    )
    r = await client.patch(
        f"/api/lessons/{lesson_id}",
        json={"title": "Artigo", "raw_text": "Texto novo."},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    latest = max(await _sources(lesson_id), key=lambda s: s.version_number)
    assert latest.version_number == 2
    assert latest.source_type == "url"
    assert latest.source_uri == "https://example.com/a"
    assert latest.author == "Ana"
    assert latest.source_label == "Exemplo"


async def test_text_edit_of_manual_lesson_stays_manual(client: AsyncClient, csrf: str) -> None:
    lesson_id = await _ready_lesson(client, csrf)
    r = await client.patch(
        f"/api/lessons/{lesson_id}",
        json={"title": "Artigo", "raw_text": "Texto novo."},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    latest = max(await _sources(lesson_id), key=lambda s: s.version_number)
    assert latest.version_number == 2
    assert latest.source_type == "manual"
    assert latest.source_uri is None
