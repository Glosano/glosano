"""Private durable chat commands, exercised against real PostgreSQL."""

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

from glosano.core.config import get_settings
from glosano.core.db import Base, session_scope
from glosano.main import create_app
from glosano.modules.lesson_library.models import Lesson
from tests.api._reader_helpers import seed_ready_lesson
from tests.api.test_me_settings import register


async def draft(c: AsyncClient, text: str = "Explain this", **extra: object) -> dict[str, Any]:
    r = await c.put("/api/chats/drafts/new", json={"revision": 0, "text": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


async def send(c: AsyncClient, revision: int = 1, **extra: object) -> dict[str, Any]:
    r = await c.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": revision,
            "learning_language_code": "pt",
            **extra,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def ai_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_draft_cas_send_replay_cancel_and_private_crud(client: AsyncClient):
    assert (await client.get("/api/chats")).status_code == 401
    await register(client)
    d = await draft(client)
    assert d["revision"] == 1
    assert (await client.get("/api/chats")).json()["items"] == []
    stale = await client.put("/api/chats/drafts/new", json={"revision": 0, "text": "lost"})
    assert stale.status_code == 409
    assert stale.json()["detail"]["draft"]["text"] == "Explain this"
    op = str(uuid.uuid4())
    result = await send(client, operation_id=op)
    cid = result["conversation_id"]
    assert (await send(client, operation_id=op)) == result
    assert (await client.get("/api/chats/drafts/new")).json()["revision"] == 2
    assert (await client.get("/api/chats")).json()["items"][0]["title"] == "Explain this"
    assert (await client.patch(f"/api/chats/{cid}", json={"title": "Renamed"})).status_code == 200
    await client.put(f"/api/chats/{cid}/draft", json={"revision": 0, "text": "next"})
    busy = await client.post(
        "/api/chats/send",
        json={"conversation_id": cid, "draft_revision": 1, "operation_id": str(uuid.uuid4())},
    )
    assert busy.status_code == 409
    gid = result["generation"]["id"]
    stop = await client.post(f"/api/chats/{cid}/generations/{gid}/cancel")
    assert stop.json()["status"] == "cancelled"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as other:
        await register(other)
        assert (await other.get(f"/api/chats/{cid}")).status_code == 404
        assert (await other.patch(f"/api/chats/{cid}", json={"title": "hijack"})).status_code == 404
        assert (await other.delete(f"/api/chats/{cid}")).status_code == 404
        assert (await other.post(f"/api/chats/{cid}/generations/{gid}/cancel")).status_code == 404
    assert (await client.delete(f"/api/chats/{cid}")).status_code == 204
    assert (await client.get(f"/api/chats/{cid}")).status_code == 404


async def test_citations_verify_source_access_version_range_and_keep_snapshot(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    await register(client)
    lesson_id = await seed_ready_lesson(
        client,
        client.cookies["glosano_csrf"],
        monkeypatch,
        text="Olá mundo. Outra frase.",
        title="Original",
    )
    req = {
        "lesson_id": str(lesson_id),
        "source_version": 1,
        "from_ordinal": 0,
        "to_ordinal": 1,
        "context": "paragraph",
    }
    r = await client.post("/api/chats/citations", json=req)
    assert r.status_code == 200, r.text
    citation = r.json()
    assert citation["selected_text"] == "Olá mundo"
    assert citation["context_text"] == "Olá mundo. Outra frase."
    assert (
        await client.post("/api/chats/citations", json={**req, "to_ordinal": 500})
    ).status_code == 422
    assert (
        await client.post("/api/chats/citations", json={**req, "selected_text": "forged"})
    ).status_code == 422
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as other:
        await register(other)
        assert (await other.post("/api/chats/citations", json=req)).status_code == 404
        async with session_scope() as s:
            await s.execute(
                update(Lesson).where(Lesson.id == lesson_id).values(visibility="shared")
            )
        assert (await other.post("/api/chats/citations", json=req)).status_code == 200
        assert (
            await other.put(
                "/api/chats/drafts/new", json={"revision": 0, "citation_ids": [citation["id"]]}
            )
        ).status_code == 404
    await draft(client, citation_ids=[citation["id"]])
    async with session_scope() as s:
        await s.execute(
            update(Lesson).where(Lesson.id == lesson_id).values(current_source_version=2)
        )
    stale = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 1,
            "learning_language_code": "pt",
        },
    )
    assert stale.status_code == 409
    assert (await client.get("/api/chats/drafts/new")).json()["text"] == "Explain this"
    async with session_scope() as s:
        await s.execute(
            update(Lesson).where(Lesson.id == lesson_id).values(current_source_version=1)
        )
    result = await send(client)
    cid = result["conversation_id"]
    async with session_scope() as s:
        await s.execute(delete(Lesson).where(Lesson.id == lesson_id))
    history = (await client.get(f"/api/chats/{cid}")).json()
    sent = history["messages"][0]["citations"][0]
    assert sent["selected_text"] == "Olá mundo"
    assert sent["title"] == "Original" and sent["source_available"] is False
    assert sent["lesson_id"] is None


async def test_ai_off_history_export_delete(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    uid, _ = await register(client)
    await draft(client)
    result = await send(client)
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "false")
    get_settings.cache_clear()
    cid = result["conversation_id"]
    assert (await client.get(f"/api/chats/{cid}")).status_code == 200
    await draft(client, revision=2)
    r = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 3,
            "learning_language_code": "pt",
        },
    )
    assert r.status_code == 503
    exported = (await client.get("/me/export")).json()["data"]
    assert any(m["text"] == "Explain this" for m in exported["chat_messages"])
    assert exported["chat_drafts"][0]["text"] == "Explain this"
    assert (
        await client.request("DELETE", "/me", json={"password": "abcdefghij"})
    ).status_code == 200
    async with session_scope() as s:
        for name, table in Base.metadata.tables.items():
            if name.startswith("chat_"):
                assert not (
                    await s.execute(select(table).where(table.c.user_id == uuid.UUID(uid)))
                ).first()


async def test_multiple_sources_revocation_and_safe_navigation(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await register(client)
    ids: list[tuple[uuid.UUID, str]] = []
    for text in ("Olá mundo.", "Bom dia."):
        lid = await seed_ready_lesson(
            client, client.cookies["glosano_csrf"], monkeypatch, text=text
        )
        r = await client.post(
            "/api/chats/citations",
            json={"lesson_id": str(lid), "source_version": 1, "from_ordinal": 0, "to_ordinal": 1},
        )
        ids.append((lid, r.json()["id"]))
    await draft(client, citation_ids=[c for _, c in ids])
    sent = await send(client)
    cid = sent["conversation_id"]
    async with session_scope() as s:
        await s.execute(
            update(Lesson)
            .where(Lesson.id == ids[0][0])
            .values(current_source_version=2, raw_text="Changed entirely.")
        )
    history = (await client.get(f"/api/chats/{cid}")).json()
    snapshots = history["messages"][0]["citations"]
    assert {c["selected_text"] for c in snapshots} == {"Olá mundo", "Bom dia"}
    changed = next(c for c in snapshots if c["selected_text"] == "Olá mundo")
    assert changed["source_available"] is True and changed["source_current"] is False
    assert changed["current_source_version"] == 2
    csrf = client.headers.pop("X-CSRF-Token")
    assert (await client.patch(f"/api/chats/{cid}", json={"title": "CSRF"})).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as other:
        await register(other)
        async with session_scope() as s:
            await s.execute(
                update(Lesson).where(Lesson.id == ids[1][0]).values(visibility="shared")
            )
        prepared = await other.post(
            "/api/chats/citations",
            json={
                "lesson_id": str(ids[1][0]),
                "source_version": 1,
                "from_ordinal": 0,
                "to_ordinal": 1,
            },
        )
        await draft(other, citation_ids=[prepared.json()["id"]])
        async with session_scope() as s:
            await s.execute(
                update(Lesson).where(Lesson.id == ids[1][0]).values(visibility="private")
            )
        r = await other.post(
            "/api/chats/send",
            json={
                "operation_id": str(uuid.uuid4()),
                "draft_revision": 1,
                "learning_language_code": "pt",
            },
        )
        assert r.status_code == 404
        assert (await other.get("/api/chats/drafts/new")).json()["text"] == "Explain this"
        assert (await other.get(f"/api/chats/citations/{ids[0][1]}")).status_code == 404


async def test_learning_language_required_validated_and_immutable(client: AsyncClient):
    await register(client)
    await draft(client)
    body = {"operation_id": str(uuid.uuid4()), "draft_revision": 1}
    assert (await client.post("/api/chats/send", json=body)).status_code == 422
    assert (
        await client.post("/api/chats/send", json={**body, "learning_language_code": "xx"})
    ).status_code == 422
    r = await client.post("/api/chats/send", json={**body, "learning_language_code": "ja"})
    assert r.status_code == 200, r.text
    cid = r.json()["conversation_id"]
    assert (await client.get(f"/api/chats/{cid}")).json()["learning_language_code"] == "ja"
    assert (await client.get("/api/chats")).json()["items"][0]["learning_language_code"] == "ja"
    await client.post(f"/api/chats/{cid}/generations/{r.json()['generation']['id']}/cancel")
    await client.put(f"/api/chats/{cid}/draft", json={"revision": 0, "text": "Continue"})
    changed = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "conversation_id": cid,
            "draft_revision": 1,
            "learning_language_code": "en",
        },
    )
    assert changed.status_code == 409
    continued = await client.post(
        "/api/chats/send",
        json={"operation_id": str(uuid.uuid4()), "conversation_id": cid, "draft_revision": 1},
    )
    assert continued.status_code == 200
    assert (await client.get(f"/api/chats/{cid}")).json()["learning_language_code"] == "ja"
