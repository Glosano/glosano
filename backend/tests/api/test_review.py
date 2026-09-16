"""API /api/review (FLQ-7): queue + answer, авторизация, лимит."""

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.main import create_app
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.vocabulary.models import TokenItem


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
    csrf = c.cookies.get("glosano_csrf")
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
        assert body["daily"] == {"limit": 500, "done_today": 0, "limit_reached": False}
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
            json={"review_item_id": review_item_id, "quality": 4},
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
            json={"review_item_id": review_item_id, "quality": 7},
        )
        assert r.status_code == 422
    async with await _client() as c2:
        csrf2 = await _register(c2)
        r = await c2.post(
            "/api/review/answer",
            headers={"X-CSRF-Token": csrf2},
            json={"review_item_id": review_item_id, "quality": 4},
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


async def test_counts_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    # локальный .env репозитория держит GLOSANO_LLM_ENABLED=true (dev/OpenRouter) —
    # явно фиксируем False, чтобы тест не зависел от ambient-конфига окружения.
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/counts", params={"lang": "pt"})
        assert r.status_code == 200
        body = r.json()
        assert body["due"] == 1 and body["new"] == 1
        assert body["practice"] == 0 and body["ai_enabled"] is False


async def test_queue_mode_new():
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt", "mode": "new"})
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1


async def test_counts_with_unknown_lesson_returns_404():
    async with await _client() as c:
        await _register(c)
        r = await c.get("/api/review/counts", params={"lang": "pt", "lesson_id": str(uuid.uuid4())})
        assert r.status_code == 404


async def test_exercise_returns_503_when_ai_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    # локальный .env репозитория держит GLOSANO_LLM_ENABLED=true (dev/OpenRouter) —
    # явно фиксируем False, чтобы тест не зависел от ambient-конфига окружения.
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/exercise",
            headers={"X-CSRF-Token": csrf},
            json={"kind": "example", "review_item_id": review_item_id},
        )
        assert r.status_code == 503
        assert r.json()["detail"] == "ai_disabled"


async def test_exercise_validation_422():
    async with await _client() as c:
        csrf = await _register(c)
        # writing без review_item_ids
        r = await c.post(
            "/api/review/exercise",
            headers={"X-CSRF-Token": csrf},
            json={"kind": "writing"},
        )
        assert r.status_code == 422
        # example без review_item_id
        r = await c.post(
            "/api/review/exercise",
            headers={"X-CSRF-Token": csrf},
            json={"kind": "example"},
        )
        assert r.status_code == 422


async def test_feedback_returns_503_when_ai_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    # локальный .env репозитория держит GLOSANO_LLM_ENABLED=true (dev/OpenRouter) —
    # явно фиксируем False, чтобы тест не зависел от ambient-конфига окружения.
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    async with await _client() as c:
        csrf = await _register(c)
        await _create_tracked(c, csrf)
        r = await c.get("/api/review/queue", params={"lang": "pt"})
        review_item_id = r.json()["items"][0]["review_item_id"]
        r = await c.post(
            "/api/review/exercise/feedback",
            headers={"X-CSRF-Token": csrf},
            json={
                "review_item_id": review_item_id,
                "sentence_translation": "Каждый день уникален.",
                "user_text": "Cada dia e unico.",
            },
        )
        assert r.status_code == 503
