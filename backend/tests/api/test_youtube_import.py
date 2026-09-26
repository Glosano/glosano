import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.modules.lesson_library.models import LessonImportJob
from glosano.modules.lesson_library.video_segments import Cue
from glosano.modules.lesson_library.youtube import VideoResult
from glosano.worker.tasks import run_lesson_import
from tests.api._reader_helpers import library_items, register_and_onboard


async def test_video_import_edit_export_and_idempotency(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, "youtube-flow@example.com", lang="en")
    headers = {"X-CSRF-Token": csrf}

    async def enqueue(*args: Any) -> None:
        pass

    async def acquire(*args: Any) -> VideoResult:
        return VideoResult(
            "M7lc1UVf-VE",
            "Sample",
            "Author",
            "en-US",
            False,
            [Cue("Hello world.", 0, 2000), Cue("Next lesson.", 4000, 6000)],
        )

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", enqueue)
    monkeypatch.setattr(
        "glosano.modules.lesson_library.youtube.YouTubeTranscriptProvider.acquire", acquire
    )
    payload = {
        "url": "https://youtu.be/M7lc1UVf-VE",
        "language_code": "en",
        "request_id": str(uuid.uuid4()),
    }
    response = await client.post("/api/lessons/import-youtube", json=payload, headers=headers)
    assert response.status_code == 202, response.text
    lesson_id = response.json()["id"]
    assert (await client.post("/api/lessons/import-youtube", json=payload, headers=headers)).json()[
        "id"
    ] == lesson_id
    assert (
        await client.post(
            "/api/lessons/import-youtube", json={**payload, "language_code": "pt"}, headers=headers
        )
    ).status_code == 409
    async with session_scope() as s:
        job_id = await s.scalar(
            select(LessonImportJob.id).where(LessonImportJob.lesson_id == uuid.UUID(lesson_id))
        )
    assert job_id is not None
    await run_lesson_import(uuid.UUID(lesson_id), job_id)
    await run_lesson_import(uuid.UUID(lesson_id), job_id)
    detail = (await client.get(f"/api/lessons/{lesson_id}")).json()
    assert detail["status"] == "ready"
    assert detail["media"]["language_code"] == "en-US"
    content = (await client.get(f"/api/lessons/{lesson_id}/content")).json()
    sentences = [s for p in content["paragraphs"] for s in p["sentences"]]
    assert [(s["media_start_ms"], s["media_end_ms"]) for s in sentences] == [
        (0, 2000),
        (4000, 6000),
    ]
    edit = (await client.get(f"/api/lessons/{lesson_id}/edit")).json()
    fragments = [{"seg_id": s["seg_id"], "text": s["text"]} for s in edit["fragments"]]
    assert (
        await client.patch(
            f"/api/lessons/{lesson_id}",
            json={"title": "No", "raw_text": "replacement"},
            headers=headers,
        )
    ).status_code == 422
    bad = {"title": "Sample", "source_version": 1, "fragments": list(reversed(fragments))}
    assert (
        await client.patch(f"/api/lessons/{lesson_id}", json=bad, headers=headers)
    ).status_code == 422
    fragments[0]["text"] = "Hello everyone."
    body = {"title": "Revised", "source_version": 1, "fragments": fragments}
    changed = await client.patch(f"/api/lessons/{lesson_id}", json=body, headers=headers)
    assert changed.status_code == 200, changed.text
    assert changed.json()["source_version"] == 2
    assert changed.json()["fragments"][0]["media_end_ms"] == 2000
    assert (
        await client.patch(f"/api/lessons/{lesson_id}", json=body, headers=headers)
    ).status_code == 409
    exported = await client.get("/me/export")
    assert exported.status_code == 200
    media = exported.json()["data"]["lesson_media_sources"]
    assert len(media) == 2
    assert media[-1]["cue_snapshot"][0]["text"] == "Hello world."


async def test_bulk_request_replay_and_undo(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.api._reader_helpers import seed_ready_lesson

    csrf = await register_and_onboard(client, "youtube-bulk@example.com")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Hello world.")
    headers = {"X-CSRF-Token": csrf}
    body = {
        "lesson_id": str(lesson_id),
        "from_ordinal": 0,
        "to_ordinal": 10,
        "request_id": str(uuid.uuid4()),
    }
    first = await client.post("/api/reader/bulk-known", json=body, headers=headers)
    replay = await client.post("/api/reader/bulk-known", json=body, headers=headers)
    assert replay.json() == first.json()
    assert first.json()["undone"] is False
    assert (
        await client.post(
            "/api/reader/bulk-known", json={**body, "to_ordinal": 11}, headers=headers
        )
    ).status_code == 409
    await client.post(f"/api/reader/bulk-actions/{first.json()['action_id']}/undo", headers=headers)
    replay = await client.post("/api/reader/bulk-known", json=body, headers=headers)
    assert replay.json()["action_id"] == first.json()["action_id"]
    assert replay.json()["undone"] is True


async def test_concurrent_bulk_request_returns_original_action(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio

    from tests.api._reader_helpers import seed_ready_lesson

    csrf = await register_and_onboard(client, "youtube-concurrent-bulk@example.com")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Concurrent words.")
    body = {
        "lesson_id": str(lesson_id),
        "from_ordinal": 0,
        "to_ordinal": 10,
        "request_id": str(uuid.uuid4()),
    }
    responses = await asyncio.gather(
        *(
            client.post("/api/reader/bulk-known", json=body, headers={"X-CSRF-Token": csrf})
            for _ in range(3)
        )
    )
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json() == responses[0].json() for r in responses)
    assert responses[0].json()["created_count"] == 2


async def test_queue_failure_is_safe_and_retry_preserves_lesson(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from glosano.modules.lesson_library.youtube import VideoImportError

    csrf = await register_and_onboard(client, "youtube-retry@example.com", lang="en")
    headers = {"X-CSRF-Token": csrf}

    async def enqueue(*args: Any) -> None:
        raise RuntimeError("secret transport information")

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", enqueue)
    body = {
        "url": "https://youtu.be/M7lc1UVf-VE",
        "language_code": "en",
        "request_id": str(uuid.uuid4()),
    }
    response = await client.post("/api/lessons/import-youtube", json=body, headers=headers)
    assert response.status_code == 503
    repeated = await client.post("/api/lessons/import-youtube", json=body, headers=headers)
    lesson_id = repeated.json()["id"]
    detail = (await client.get(f"/api/lessons/{lesson_id}")).json()
    assert detail["import_error"] == {"code": "queue_unavailable", "retryable": True}
    library = await library_items(client, "en")
    assert next(i for i in library if i["id"] == lesson_id)["source_type"] == "youtube"

    async def queued(*args: Any) -> None:
        pass

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", queued)
    retried = await client.post(f"/api/lessons/{lesson_id}/retry-import", headers=headers)
    assert retried.status_code == 202 and retried.json()["id"] == lesson_id
    assert (
        await client.post(f"/api/lessons/{lesson_id}/retry-import", headers=headers)
    ).status_code == 409
    async with session_scope() as s:
        job_id = await s.scalar(
            select(LessonImportJob.id).where(
                LessonImportJob.lesson_id == uuid.UUID(lesson_id),
                LessonImportJob.status == "pending",
            )
        )
        assert job_id is not None

    async def unavailable(*args: Any) -> VideoResult:
        raise VideoImportError("captions_language_unavailable")

    monkeypatch.setattr(
        "glosano.modules.lesson_library.youtube.YouTubeTranscriptProvider.acquire", unavailable
    )
    await run_lesson_import(uuid.UUID(lesson_id), job_id)
    assert (
        await client.post(f"/api/lessons/{lesson_id}/retry-import", headers=headers)
    ).status_code == 409
    csrf = await register_and_onboard(client, "youtube-other@example.com", lang="en")
    assert (await client.get(f"/api/lessons/{lesson_id}")).status_code == 404
    assert (
        await client.post(f"/api/lessons/{lesson_id}/retry-import", headers={"X-CSRF-Token": csrf})
    ).status_code == 404


async def test_bulk_request_identity_survives_source_edit(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.api._reader_helpers import seed_ready_lesson

    csrf = await register_and_onboard(client, "youtube-bulk-revision@example.com")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Old words.")
    headers = {"X-CSRF-Token": csrf}
    body = {
        "lesson_id": str(lesson_id),
        "source_version": 1,
        "from_ordinal": 0,
        "to_ordinal": 10,
        "request_id": str(uuid.uuid4()),
    }
    first = await client.post("/api/reader/bulk-known", json=body, headers=headers)
    assert first.status_code == 200
    assert (
        await client.patch(
            f"/api/lessons/{lesson_id}",
            json={"title": "Revision", "raw_text": "Revised words."},
            headers=headers,
        )
    ).status_code == 200
    assert (
        await client.post(
            "/api/reader/bulk-known", json={**body, "source_version": 2}, headers=headers
        )
    ).status_code == 409
    assert (
        await client.post(
            f"/api/reader/bulk-actions/{first.json()['action_id']}/undo", headers=headers
        )
    ).status_code == 404
