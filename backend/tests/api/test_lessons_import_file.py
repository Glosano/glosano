"""File uploads use the same durable import pipeline as pasted text."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.modules.lesson_library.models import LessonSource
from glosano.modules.lesson_library.repo import LessonRepo
from glosano.worker.tasks import run_lesson_import
from tests.api._reader_helpers import library_items
from tests.api.test_lessons_import import (
    _register_and_onboard,  # pyright: ignore[reportPrivateUsage]
)


@pytest.mark.parametrize(
    ("filename", "mime", "title"),
    [
        ("Olá.txt", "text/plain", None),
        ("chapter.MD", "text/markdown", "My title"),
        ("notes.md", "application/octet-stream", None),
        ("notes.txt", "", None),
    ],
)
async def test_file_import_round_trip(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    filename: str,
    mime: str,
    title: str | None,
) -> None:
    jobs: list[tuple[uuid.UUID, uuid.UUID]] = []

    async def enqueue(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
        jobs.append((lesson_id, job_id))

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", enqueue)
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    data = {"language_code": "pt"}
    if title is not None:
        data["title"] = title
    response = await client.post(
        "/api/lessons/import-file",
        data=data,
        files={"file": (filename, "\ufeffOlá mundo.\r\nTudo bem?".encode(), mime)},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "processing"
    lesson_id = uuid.UUID(response.json()["id"])
    assert jobs[0][0] == lesson_id
    async with session_scope() as session:
        lesson = await LessonRepo(session).get_lesson(lesson_id)
        assert lesson is not None
        assert lesson.raw_text == "Olá mundo.\nTudo bem?"
        assert lesson.title == (title or filename.rsplit(".", 1)[0])
        assert lesson.visibility == "private"
        source = (
            await session.execute(select(LessonSource).where(LessonSource.lesson_id == lesson_id))
        ).scalar_one()
        assert source.source_type == "file"
        assert source.original_filename == filename
    await run_lesson_import(*jobs[0])
    result = await client.get(f"/api/lessons/{lesson_id}")
    assert result.json()["status"] == "ready"
    assert result.json()["word_count"] == 4


@pytest.mark.parametrize(
    ("filename", "mime", "content", "extra", "expected"),
    [
        ("book.pdf", "text/plain", b"Hello", {}, 415),
        ("book.txt", "application/pdf", b"Hello", {}, 415),
        ("book.txt", "text/plain", b"\xff", {}, 422),
        ("book.txt", "text/plain", b" \r\n", {}, 422),
        ("book.txt", "text/plain", b"Hello\x00world", {}, 422),
        ("book.txt", "text/plain", b"x" * (5 * 1024 * 1024 + 1), {}, 413),
        ("book.txt", "text/plain", b"Hello", {"language_code": "xx"}, 422),
        ("book.txt", "text/plain", b"Hello", {"title": " "}, 422),
        ("book.txt", "text/plain", b"Hello", {"title": "x" * 201}, 422),
    ],
    ids=[
        "extension",
        "mime",
        "encoding",
        "blank",
        "binary",
        "size",
        "language",
        "blank-title",
        "long-title",
    ],
)
async def test_invalid_file_creates_no_lesson(
    client: AsyncClient,
    filename: str,
    mime: str,
    content: bytes,
    extra: dict[str, str],
    expected: int,
) -> None:
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "pt", **extra},
        files={"file": (filename, content, mime)},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == expected, response.text
    assert [i for i in await library_items(client) if i["can_manage"]] == []


async def test_file_import_requires_auth_and_csrf(client: AsyncClient) -> None:
    upload = {"file": ("book.txt", b"Hello", "text/plain")}
    response = await client.post(
        "/api/lessons/import-file", files=upload, data={"language_code": "pt"}
    )
    assert response.status_code in (401, 403)
    await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/lessons/import-file", files=upload, data={"language_code": "pt"}
    )
    assert response.status_code == 403


async def test_file_enqueue_failure_is_not_stranded(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", fail)
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "pt"},
        files={"file": ("book.txt", b"Hello", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 503
    mine = [i for i in await library_items(client) if i["can_manage"]]
    assert mine[0]["status"] == "failed"


async def test_file_at_size_limit_is_accepted(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def enqueue(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", enqueue)
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "pt"},
        files={"file": ("limit.txt", b"x" * (5 * 1024 * 1024), "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 202
    lesson_id = uuid.UUID(response.json()["id"])
    async with session_scope() as session:
        lesson = await LessonRepo(session).get_lesson(lesson_id)
        assert lesson is not None
        assert len(lesson.raw_text) == 5 * 1024 * 1024


async def test_oversized_chunked_upload_stops_before_reading_entire_body(
    client: AsyncClient,
) -> None:
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    read_chunks: list[int] = []

    async def body() -> AsyncIterator[bytes]:
        yield (
            b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="huge.txt"\r\n'
            b"Content-Type: text/plain\r\n\r\n"
        )
        for i in range(12):
            read_chunks.append(i)
            yield b"x" * (1024 * 1024)
        yield b"\r\n--boundary--\r\n"

    response = await client.post(
        "/api/lessons/import-file",
        content=body(),
        headers={"X-CSRF-Token": csrf, "Content-Type": "multipart/form-data; boundary=boundary"},
    )
    assert response.status_code == 413
    assert len(read_chunks) <= 6


async def test_anonymous_upload_does_not_read_body(client: AsyncClient) -> None:
    read_chunks: list[int] = []

    async def body() -> AsyncIterator[bytes]:
        read_chunks.append(1)
        yield (
            b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="book.txt"\r\n'
            b"Content-Type: text/plain\r\n\r\nHello\r\n--boundary\r\n"
            b'Content-Disposition: form-data; name="language_code"\r\n\r\npt\r\n--boundary--\r\n'
        )

    client.cookies.set("glosano_csrf", "matching-csrf")
    response = await client.post(
        "/api/lessons/import-file",
        content=body(),
        headers={
            "X-CSRF-Token": "matching-csrf",
            "Content-Type": "multipart/form-data; boundary=boundary",
        },
    )
    assert response.status_code == 401
    assert read_chunks == []


async def test_file_name_is_basename_in_source(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def enqueue(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", enqueue)
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "pt"},
        files={"file": ("../../book.md", b"Hello", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 202
    lesson_id = uuid.UUID(response.json()["id"])
    async with session_scope() as session:
        source = (
            await session.execute(select(LessonSource).where(LessonSource.lesson_id == lesson_id))
        ).scalar_one()
        assert source.original_filename == "book.md"
        lesson = await LessonRepo(session).get_lesson(lesson_id)
        assert lesson is not None
        assert lesson.title == "book"


async def test_manual_import_keeps_manual_source(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def enqueue(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", enqueue)
    csrf = await _register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/lessons",
        json={"title": "Manual", "language_code": "pt", "raw_text": "Hello"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 202
    async with session_scope() as session:
        source = (
            await session.execute(
                select(LessonSource).where(
                    LessonSource.lesson_id == uuid.UUID(response.json()["id"])
                )
            )
        ).scalar_one()
        assert source.source_type == "manual"
        assert source.original_filename is None
