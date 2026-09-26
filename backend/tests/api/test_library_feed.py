"""GET /api/lessons/continue и /api/lessons/history (FLQ-36)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from glosano.core.db import session_scope
from glosano.main import create_app
from glosano.modules.identity.models import User
from glosano.modules.lesson_library.models import Lesson
from tests.api._reader_helpers import (
    library_items,
    register_and_onboard,
    seed_ready_lesson,
)


async def _move(c: AsyncClient, csrf: str, lesson_id: uuid.UUID) -> None:
    """Открыть материал и сдвинуться — это активность."""
    for ordinal in (1, 2):
        r = await c.put(
            "/api/reader/positions",
            json={
                "lesson_id": str(lesson_id),
                "view_mode": "page",
                "current_segment_id": None,
                "current_token_ordinal": ordinal,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 204, r.text


async def _continue_ids(c: AsyncClient, **params: str | int) -> list[str]:
    r = await c.get("/api/lessons/continue", params={"lang": "pt", **params})
    assert r.status_code == 200, r.text
    return [item["id"] for item in r.json()["items"]]


async def _set_created(lesson_id: uuid.UUID, iso: str) -> None:
    async with session_scope() as s:
        await s.execute(
            update(Lesson)
            .where(Lesson.id == lesson_id)
            .values(created_at=datetime.fromisoformat(iso))
        )
        await s.commit()


async def test_continue_lists_started_unfinished_by_latest_activity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"continue-{marker}@example.com")
    untouched = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} a")
    older = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} b")
    newer = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} c")
    await _move(client, csrf, older)
    await _move(client, csrf, newer)

    ids = await _continue_ids(client, q=marker)
    assert ids == [str(newer), str(older)]
    assert str(untouched) not in ids

    items = (await client.get("/api/lessons/continue", params={"lang": "pt", "q": marker})).json()
    assert items["items"][0]["last_activity_at"] is not None
    assert await _continue_ids(client, q=marker, limit=1) == [str(newer)]


async def test_continue_excludes_completed(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"continue-done-{marker}@example.com")
    lesson = await seed_ready_lesson(client, csrf, monkeypatch, title=marker)
    await _move(client, csrf, lesson)
    content = (await client.get(f"/api/lessons/{lesson}/content")).json()
    last = [s for p in content["paragraphs"] for s in p["sentences"]][-1]
    words = [t["i"] for t in last["tokens"] if "i" in t]
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
    assert await _continue_ids(client, q=marker) == []


async def test_continue_is_personal(monkeypatch: pytest.MonkeyPatch) -> None:
    marker = uuid.uuid4().hex
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as owner:
        csrf = await register_and_onboard(owner, f"owner-{marker}@example.com")
        lesson = await seed_ready_lesson(
            owner, csrf, monkeypatch, title=marker, visibility="shared"
        )
        await _move(owner, csrf, lesson)
    async with AsyncClient(transport=transport, base_url="http://test") as other:
        await register_and_onboard(other, f"other-{marker}@example.com")
        assert await _continue_ids(other, q=marker) == []
        assert [i["id"] for i in await library_items(other, q=marker)] == [str(lesson)]


async def test_history_groups_by_user_timezone(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tz-{marker}@example.com")
    late = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} late")
    early = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} early")
    await _set_created(late, "2026-09-25T20:30:00+00:00")  # 23:30 в Москве, 25-е
    await _set_created(early, "2026-09-25T21:30:00+00:00")  # 00:30 в Москве, 26-е

    utc = (
        await client.get("/api/lessons/history", params={"lang": "pt", "q": marker, "tz": "UTC"})
    ).json()
    assert [(d["date"], [i["id"] for i in d["items"]]) for d in utc["days"]] == [
        ("2026-09-25", [str(early), str(late)])
    ]
    msk = (
        await client.get(
            "/api/lessons/history", params={"lang": "pt", "q": marker, "tz": "Europe/Moscow"}
        )
    ).json()
    assert [(d["date"], [i["id"] for i in d["items"]]) for d in msk["days"]] == [
        ("2026-09-26", [str(early)]),
        ("2026-09-25", [str(late)]),
    ]


async def test_history_pages_by_days(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"pages-{marker}@example.com")
    for day in ("01", "02", "03"):
        lesson = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} {day}")
        await _set_created(lesson, f"2026-01-{day}T12:00:00+00:00")

    first = (
        await client.get("/api/lessons/history", params={"lang": "pt", "q": marker, "days": 2})
    ).json()
    assert [d["date"] for d in first["days"]] == ["2026-01-03", "2026-01-02"]
    assert first["next_before"] == "2026-01-02"
    second = (
        await client.get(
            "/api/lessons/history",
            params={"lang": "pt", "q": marker, "days": 2, "before": first["next_before"]},
        )
    ).json()
    assert [d["date"] for d in second["days"]] == ["2026-01-01"]
    assert second["next_before"] is None


async def test_history_caps_a_day_at_one_hundred(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    email = f"cap-{marker}@example.com"
    await register_and_onboard(client, email)
    async with session_scope() as s:
        user_id = await s.scalar(select(User.id).where(User.email == email))
        assert user_id is not None
        s.add_all(
            Lesson(
                owner_user_id=user_id,
                language_code="pt",
                title=f"{marker} {n}",
                raw_text="x",
                status="ready",
                created_at=datetime(2026, 2, 1, 12, 0, n % 60, tzinfo=UTC),
            )
            for n in range(101)
        )
        await s.commit()

    body = (await client.get("/api/lessons/history", params={"lang": "pt", "q": marker})).json()
    assert len(body["days"]) == 1
    assert body["days"][0]["total"] == 101
    assert len(body["days"][0]["items"]) == 100


async def test_history_includes_processing_material(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _noop(lesson_id: object, job_id: object) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", _noop)
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"processing-{marker}@example.com")
    r = await client.post(
        "/api/lessons",
        json={"title": marker, "language_code": "pt", "raw_text": "Olá.", "visibility": "private"},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 202
    items = await library_items(client, q=marker)
    assert [i["status"] for i in items] == ["processing"]
    assert await _continue_ids(client, q=marker) == []


async def test_history_rejects_unknown_timezone(client: AsyncClient) -> None:
    await register_and_onboard(client, f"tz-bad-{uuid.uuid4()}@example.com")
    r = await client.get("/api/lessons/history", params={"lang": "pt", "tz": "Mars/Olympus"})
    assert r.status_code == 422


# Postgres does the day math, so it decides which zones are valid. Python's
# zoneinfo accepts "localtime" on Linux (/usr/share/zoneinfo/localtime) while
# Postgres rejects it; the ZoneInfo check let it through into a 500.
@pytest.mark.parametrize("tz", ["localtime", "right/UTC"])
async def test_history_rejects_timezone_unknown_to_postgres(client: AsyncClient, tz: str) -> None:
    await register_and_onboard(client, f"tz-pg-{uuid.uuid4()}@example.com")
    r = await client.get("/api/lessons/history", params={"lang": "pt", "tz": tz})
    assert r.status_code == 422


@pytest.mark.parametrize("path", ["/api/lessons/continue", "/api/lessons/history"])
async def test_feed_requires_auth(client: AsyncClient, path: str) -> None:
    assert (await client.get(path, params={"lang": "pt"})).status_code == 401
