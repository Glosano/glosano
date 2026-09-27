"""Personal lesson tags: editing, privacy and library filtering (FLQ-39)."""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select, update

from glosano.core.db import session_scope
from glosano.main import create_app
from glosano.modules.lesson_library.models import Lesson, LessonTag
from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson


async def _put_tags(c: AsyncClient, csrf: str, lesson_id: uuid.UUID, tags: list[str]) -> Response:
    return await c.put(
        f"/api/lessons/{lesson_id}/tags", json={"tags": tags}, headers={"X-CSRF-Token": csrf}
    )


async def _history(c: AsyncClient, marker: str, *tags: str) -> dict[str, list[str]]:
    params = ("lang", "pt"), ("days", "31"), ("q", marker), *(("tag", t) for t in tags)
    r = await c.get("/api/lessons/history", params=params)
    assert r.status_code == 200, r.text
    return {item["title"]: item["tags"] for day in r.json()["days"] for item in day["items"]}


async def _move(c: AsyncClient, csrf: str, lesson_id: uuid.UUID) -> None:
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


async def test_put_replaces_and_clears_tags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tags-put-{marker}@example.com")
    lesson = await seed_ready_lesson(client, csrf, monkeypatch, title=marker)

    r = await _put_tags(client, csrf, lesson, ["News", "b2"])
    assert r.status_code == 200, r.text
    assert r.json() == {"tags": ["b2", "news"]}
    assert await _history(client, marker) == {marker: ["b2", "news"]}

    assert (await _put_tags(client, csrf, lesson, ["x"])).json() == {"tags": ["x"]}
    assert (await _put_tags(client, csrf, lesson, [])).json() == {"tags": []}
    assert await _history(client, marker) == {marker: []}


async def test_filter_requires_every_selected_tag(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tags-and-{marker}@example.com")
    both = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} both")
    only_x = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} x")
    only_y = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} y")
    await _put_tags(client, csrf, both, ["x", "y"])
    await _put_tags(client, csrf, only_x, ["x"])
    await _put_tags(client, csrf, only_y, ["y"])

    assert set(await _history(client, marker, "x", "y")) == {f"{marker} both"}
    assert set(await _history(client, marker, " X ")) == {f"{marker} both", f"{marker} x"}
    assert len(await _history(client, marker)) == 3

    await _move(client, csrf, both)
    await _move(client, csrf, only_x)
    r = await client.get(
        "/api/lessons/continue", params=[("lang", "pt"), ("q", marker), ("tag", "y")]
    )
    assert [item["id"] for item in r.json()["items"]] == [str(both)]


async def test_tags_are_personal_on_shared_lessons(monkeypatch: pytest.MonkeyPatch) -> None:
    marker = uuid.uuid4().hex
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as owner:
        owner_csrf = await register_and_onboard(owner, f"owner-{marker}@example.com")
        shared = await seed_ready_lesson(
            owner, owner_csrf, monkeypatch, title=marker, visibility="shared"
        )
        private = await seed_ready_lesson(owner, owner_csrf, monkeypatch, title=f"{marker} p")
        async with AsyncClient(transport=transport, base_url="http://test") as other:
            other_csrf = await register_and_onboard(other, f"other-{marker}@example.com")
            assert (await _put_tags(other, other_csrf, shared, ["mine"])).status_code == 200
            assert await _history(other, marker) == {marker: ["mine"]}
            assert (await _put_tags(other, other_csrf, private, ["x"])).status_code == 404
            assert (await _put_tags(other, other_csrf, uuid.uuid4(), ["x"])).status_code == 404

            # The owner neither sees nor filters by another learner's labels.
            assert (await _history(owner, marker))[marker] == []
            assert (await owner.get("/api/lessons/tags", params={"lang": "pt"})).json() == {
                "tags": []
            }

            # Once the owner stops sharing, the other learner's tags go with the lesson.
            async with session_scope() as s:
                await s.execute(
                    update(Lesson).where(Lesson.id == shared).values(visibility="private")
                )
                await s.commit()
            assert (await other.get("/api/lessons/tags", params={"lang": "pt"})).json() == {
                "tags": []
            }
            assert await _history(other, marker, "mine") == {}


async def test_tag_counts_follow_language(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tags-count-{marker}@example.com")
    first = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} 1")
    second = await seed_ready_lesson(client, csrf, monkeypatch, title=f"{marker} 2")
    english = await seed_ready_lesson(
        client, csrf, monkeypatch, title=f"{marker} en", language_code="en"
    )
    await _put_tags(client, csrf, first, ["x", "y"])
    await _put_tags(client, csrf, second, ["x"])
    await _put_tags(client, csrf, english, ["z"])

    r = await client.get("/api/lessons/tags", params={"lang": "pt"})
    assert r.status_code == 200, r.text
    assert r.json() == {"tags": [{"name": "x", "count": 2}, {"name": "y", "count": 1}]}


async def test_filter_accepts_more_than_twenty_tags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tags-many-{marker}@example.com")
    await seed_ready_lesson(client, csrf, monkeypatch, title=marker)
    many_tags = [f"t{i}" for i in range(21)]

    assert await _history(client, marker, *many_tags) == {}


async def test_invalid_tags_are_rejected(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tags-bad-{marker}@example.com")
    lesson = await seed_ready_lesson(client, csrf, monkeypatch, title=marker)
    assert (await _put_tags(client, csrf, lesson, ["x" * 41])).status_code == 422
    r = await client.get("/api/lessons/history", params={"lang": "pt", "tag": "x" * 41})
    assert r.status_code == 422


async def test_deleting_a_lesson_removes_its_tags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = uuid.uuid4().hex
    csrf = await register_and_onboard(client, f"tags-del-{marker}@example.com")
    lesson = await seed_ready_lesson(client, csrf, monkeypatch, title=marker)
    await _put_tags(client, csrf, lesson, ["x"])
    r = await client.delete(f"/api/lessons/{lesson}", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 204
    async with session_scope() as s:
        rows = await s.scalars(select(LessonTag).where(LessonTag.lesson_id == lesson))
        assert rows.all() == []
