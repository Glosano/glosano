"""Statistics API: authentication, isolation and reader accounting."""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson


async def test_stats_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/api/stats/overview?lang=en")).status_code == 401


async def test_stats_empty_and_language_validation(client: AsyncClient) -> None:
    await register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    assert (await client.get("/api/stats/overview?lang=de")).status_code == 422
    response = await client.get("/api/stats/overview?lang=pt")
    assert response.status_code == 200
    data = response.json()
    assert data["timezone"] == "UTC"
    assert data["date"] == datetime.now(UTC).date().isoformat()
    assert datetime.fromisoformat(data["reading_tracking_started_at"]) <= datetime.now(UTC)
    for key in (
        "known_items_count",
        "tracked_items_count",
        "ignored_items_count",
        "tokens_read_today",
        "new_items_today",
        "learned_items_today",
        "reviews_completed_today",
        "due_reviews",
    ):
        assert data[key] == 0


async def test_reading_overlap_retry_and_undo(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    lesson = await seed_ready_lesson(client, csrf, monkeypatch, text="Olá, olá! Mundo.")
    actions: list[str] = []
    for start, end in ((0, 2), (1, 100), (0, 100)):
        response = await client.post(
            "/api/reader/bulk-known",
            headers={"X-CSRF-Token": csrf},
            json={"lesson_id": str(lesson), "from_ordinal": start, "to_ordinal": end},
        )
        assert response.status_code == 200
        actions.append(response.json()["action_id"])
    for action in actions:
        assert (
            await client.post(
                f"/api/reader/bulk-actions/{action}/undo", headers={"X-CSRF-Token": csrf}
            )
        ).status_code == 200
    data = (await client.get("/api/stats/overview?lang=pt")).json()
    assert data["tokens_read_today"] == 3
    assert data["known_items_count"] == 0
    assert data["new_items_today"] == 0
    assert (await client.get("/api/stats/overview?lang=en")).json()["tokens_read_today"] == 0


async def test_authenticated_users_cannot_see_each_others_stats(client: AsyncClient) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    response = await client.post(
        "/api/vocabulary/items",
        headers={"X-CSRF-Token": csrf},
        json={
            "kind": "token",
            "language_code": "pt",
            "text": "cada",
            "status": "tracked",
            "confidence": 1,
        },
    )
    assert response.status_code == 201
    owner = (await client.get("/api/stats/overview?lang=pt")).json()
    assert owner["new_items_today"] == owner["tracked_items_count"] == owner["due_reviews"] == 1
    client.cookies.clear()
    await register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    other = (await client.get("/api/stats/overview?lang=pt")).json()
    assert other["new_items_today"] == other["tracked_items_count"] == other["due_reviews"] == 0
