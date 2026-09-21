"""Concurrency, acknowledgement durability, and cancellation fences."""

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from starlette.requests import Request

from glosano.api.chats import send_message
from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.chat.generations import persist_partial
from glosano.modules.chat.models import Generation, Message
from glosano.modules.chat.schemas import SendRequest
from tests.api.test_chats import draft, send
from tests.api.test_me_settings import register


@pytest.fixture(autouse=True)
def ai_enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_simultaneous_replay_is_one_message_and_preserves_later_draft(client: AsyncClient):
    await register(client)
    await draft(client)
    operation = str(uuid.uuid4())
    a, b = await asyncio.gather(
        send(client, operation_id=operation), send(client, operation_id=operation)
    )
    assert a == b
    cid = a["conversation_id"]
    history = (await client.get(f"/api/chats/{cid}")).json()
    assert len(history["messages"]) == 2
    await draft(client, "Unsent newer work", revision=2)
    await send(client, operation_id=operation)
    assert (await client.get("/api/chats/drafts/new")).json()["text"] == "Unsent newer work"
    stale = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 1,
            "learning_language_code": "pt",
        },
    )
    assert stale.status_code == 409
    assert (await client.get("/api/chats/drafts/new")).json()["text"] == "Unsent newer work"


async def test_command_committed_before_ack_and_late_updates_fenced(client: AsyncClient):
    uid, _ = await register(client)
    await draft(client)
    request = Request({"type": "http", "state": {"user_id": uuid.UUID(uid)}})
    async with session_scope() as command_session:
        result = await send_message(
            request,
            SendRequest(operation_id=uuid.uuid4(), draft_revision=1, learning_language_code="pt"),
            command_session,
        )
        gid = result["generation"]["id"]
        # Still inside route's dependency lifetime: an independent connection must see commit.
        async with session_scope() as observer:
            assert await observer.get(Generation, gid) is not None
            await observer.execute(
                update(Generation).where(Generation.id == gid).values(status="running")
            )
    cid = result["conversation_id"]
    async with session_scope() as s:
        assert await persist_partial(s, gid, "Partial reply")
    await client.post(f"/api/chats/{cid}/generations/{gid}/cancel")
    async with session_scope() as s:
        assert not await persist_partial(s, gid, "late text")
        assert (
            await s.scalar(
                select(Message.state).where(Message.id == result["generation"]["message_id"])
            )
            == "cancelled"
        )
    history = (await client.get(f"/api/chats/{cid}")).json()
    stopped = next(m for m in history["messages"] if m["role"] == "assistant")
    assert stopped["text"] == "Partial reply"
    await client.delete(f"/api/chats/{cid}")
    async with session_scope() as s:
        assert not await persist_partial(s, gid, "resurrection")
        assert await s.get(Generation, gid) is None
