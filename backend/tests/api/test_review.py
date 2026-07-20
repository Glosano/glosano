"""API /api/review (FLQ-7): queue + answer, авторизация, лимит."""

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from flinq.core.db import session_scope
from flinq.main import create_app
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.vocabulary.models import TokenItem


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (ReviewEvent, ReviewItem, TokenItem):
            await s.execute(delete(model))


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test")


async def _register(c: AsyncClient) -> str:
    r = await c.post(
        "/auth/register",
        json={
            "display_name": "T",
            "email": f"{uuid.uuid4().hex}@t.io",
            "password": "abcdefghij",
        },
    )
    assert r.status_code == 201
    csrf = c.cookies.get("flinq_csrf")
    assert csrf
    return csrf


async def _create_tracked(c: AsyncClient, csrf: str, text: str = "cada") -> None:
    r = await c.post(
        "/api/vocabulary/items",
        headers={"X-CSRF-Token": csrf},
        json={
            "kind": "token",
            "language_code": "pt",
            "text": text,
            "status": "tracked",
            "confidence": 1,
        },
    )
    assert r.status_code == 201


async def test_queue_requires_auth():
    async with await _client() as c:
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        assert r.status_code == 401


async def test_queue_returns_due_item_and_daily():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        assert r.status_code == 200
        body = r.json()
        assert body["daily"] == {"limit": 20, "done_today": 0, "limit_reached": False}
        assert len(body["items"]) == 1
        item = body["items"][0]
        assert item["text"] == "cada" and item["confidence"] == 1
        assert item["item_kind"] == "token"


async def test_answer_flow_updates_confidence_and_counts():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf},
            json={"review_item_id": review_item_id, "answer": "correct"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["new_confidence"] == 2 and body["new_status"] == "tracked"
        assert body["done_today"] == 1
        # после ответа item не due — очередь пуста
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        assert r.json()["items"] == []


async def test_answer_invalid_value_422_and_foreign_404():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf},
            json={"review_item_id": review_item_id, "answer": "maybe"},
        )
        assert r.status_code == 422
    async with await _client() as c2:
        csrf2 = await _register(c2)
        r = await c2.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf2},
            json={"review_item_id": review_item_id, "answer": "correct"},
        )
        assert r.status_code == 404


async def test_lesson_queue_unknown_lesson_404():
    async with await _client() as c:
        await _register(c)
        r = await c.get(
            "/api/review/queue",
            params={"lang": "pt", "lesson_id": str(uuid.uuid4())},
        )
        assert r.status_code == 404
