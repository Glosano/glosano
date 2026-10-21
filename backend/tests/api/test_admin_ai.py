"""ADR-0036 acceptance on real PostgreSQL/Redis and a local HTTP provider."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select, update

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.admin import network
from glosano.modules.admin.models import AISettings
from glosano.modules.admin.settings import effective_settings
from glosano.modules.ai_translation.provider import OpenAICompatibleProvider, ProviderRejected
from glosano.modules.ai_translation.service import AIDisabled
from glosano.modules.chat.provider import ChatProvider
from glosano.modules.identity.models import User
from tests.api.test_me_settings import register

PATH = "/api/admin/ai"
SECRET = "flq11-instance-secret-with-at-least-32-characters"


@pytest.fixture(autouse=True)
async def isolated(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    monkeypatch.setattr(get_settings(), "secret_key", SECRET)
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    monkeypatch.setattr(get_settings(), "llm_force_disabled", False)
    async with session_scope() as s:
        await s.execute(delete(AISettings))
    yield
    async with session_scope() as s:
        await s.execute(delete(AISettings))


async def admin(client: httpx.AsyncClient) -> dict[str, Any]:
    await register(client)
    me = (await client.get("/me")).json()
    async with session_scope() as s:
        await s.execute(update(User).where(User.id == uuid.UUID(me["id"])).values(role="admin"))
    return me


def draft(**values: Any) -> dict[str, Any]:
    return {
        "revision": 0,
        "enabled": True,
        "base_url": "http://localhost:1234/v1",
        "model": "local-model",
        "key_action": "remove",
        **values,
    }


@pytest.fixture
async def provider() -> AsyncIterator[tuple[str, list[dict[str, Any]]]]:
    calls: list[dict[str, Any]] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = (await reader.readuntil(b"\r\n\r\n")).decode()
            lines = head.split("\r\n")
            headers = dict(line.split(": ", 1) for line in lines[1:] if ": " in line)
            length = next((int(v) for k, v in headers.items() if k.lower() == "content-length"), 0)
            raw = await reader.readexactly(length)
            body: dict[str, Any] = json.loads(raw) if raw else {}
            calls.append({"path": lines[0], "headers": headers, "body": body})
            result = (
                {"data": [{"id": "local-model"}]}
                if "/models" in lines[0]
                else {"choices": [{"message": {"content": "OK"}}]}
            )
            encoded = json.dumps(result).encode()
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                + str(len(encoded)).encode()
                + b"\r\nConnection: close\r\n\r\n"
                + encoded
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        yield f"http://127.0.0.1:{port}/v1", calls


async def test_permissions_and_secret_safe_validation(client: httpx.AsyncClient):
    assert (await client.get(PATH)).status_code == 401
    await register(client)
    assert (await client.get(PATH)).status_code == 403
    for suffix in ("", "/test", "/models"):
        method = "PUT" if not suffix else "POST"
        assert (await client.request(method, PATH + suffix, json=draft())).status_code == 403
    await admin(client)
    bad = await client.put(PATH, json=draft(api_key="private-value", revision="bad"))
    assert bad.status_code == 422
    assert "private-value" not in bad.text
    client.headers.pop("X-CSRF-Token", None)
    assert (await client.put(PATH, json=draft())).status_code == 403


async def test_save_encrypted_cas_and_recover_key(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await admin(client)
    result = await client.put(PATH, json=draft(key_action="replace", api_key="provider-secret"))
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "database"
    assert result.json()["revision"] == 1
    assert "provider-secret" not in result.text
    async with session_scope() as s:
        row = await s.get(AISettings, 1)
        assert row and row.key_ciphertext and "provider-secret" not in row.key_ciphertext
    assert (await effective_settings()).llm_api_key == "provider-secret"
    assert (await client.put(PATH, json=draft())).status_code == 409
    assert (
        await client.put(
            PATH, json=draft(revision=1, base_url="http://localhost:4321/v1", key_action="keep")
        )
    ).json()["detail"] == "key_action_required"
    monkeypatch.setattr(get_settings(), "secret_key", SECRET + "-changed")
    assert not (await effective_settings()).llm_enabled
    assert (await client.get(PATH)).json()["key_error"] == "key_unreadable"
    assert (await client.put(PATH, json=draft(revision=1, key_action="remove"))).status_code == 200
    assert (await effective_settings()).llm_enabled
    assert (await effective_settings()).llm_api_key == ""


async def test_legacy_key_transition_and_force_disabled(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await admin(client)
    env = get_settings()
    monkeypatch.setattr(env, "llm_api_key", "legacy-private-key")
    monkeypatch.setattr(env, "llm_base_url", "http://localhost:1234/v1")
    assert (await client.get(PATH)).json()["source"] == "environment"
    saved = await client.put(PATH, json=draft(key_action="keep"))
    assert saved.status_code == 200
    assert (await effective_settings()).llm_api_key == "legacy-private-key"
    assert (await client.get("/me")).json()["ai_enabled"]
    monkeypatch.setattr(env, "llm_force_disabled", True)
    assert not (await effective_settings()).llm_enabled
    assert not (await client.get("/me")).json()["ai_enabled"]
    for action in ("test", "models"):
        assert (await client.post(PATH + "/" + action, json=draft(revision=1))).status_code == 403
    monkeypatch.setattr(env, "llm_force_disabled", False)
    await client.put(PATH, json=draft(revision=1, key_action="remove"))
    assert (await effective_settings()).llm_api_key == ""


async def test_real_diagnostics_and_runtime_without_restart(
    client: httpx.AsyncClient, provider: tuple[str, list[dict[str, Any]]]
):
    url, calls = provider
    await admin(client)
    body = draft(base_url=url, enabled=False)
    assert (await client.post(PATH + "/test", json=body)).status_code == 200
    assert (await client.post(PATH + "/models", json=body)).json() == {"models": ["local-model"]}
    assert (await client.get(PATH)).json()["source"] == "environment"
    assert not (await effective_settings()).llm_enabled
    assert len(calls) == 2
    body["enabled"] = True
    assert (await client.put(PATH, json=body)).status_code == 200
    assert len(calls) == 2  # saving never contacts the provider
    snapshot = await effective_settings()
    completion = await OpenAICompatibleProvider(snapshot).complete(system="Test", user="Test")
    assert completion.text == "OK"
    async with httpx.AsyncClient(trust_env=False) as http:
        assert [piece async for piece in ChatProvider(http).stream([])] == ["OK"]
    assert all("Authorization" not in call["headers"] for call in calls)
    changed = {**body, "revision": 1, "model": "another-model"}
    assert (await client.put(PATH, json=changed)).status_code == 200
    with pytest.raises(ProviderRejected, match="configuration_changed"):
        await OpenAICompatibleProvider(snapshot).complete(system="Test", user="Test")
    changed.update(revision=2, enabled=False)
    assert (await client.put(PATH, json=changed)).status_code == 200
    with pytest.raises(AIDisabled):
        await OpenAICompatibleProvider(await effective_settings()).complete(
            system="Test", user="Test"
        )
    assert len(calls) == 4


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://169.254.169.254",
        "http://[fe80::1]",
        "http://100.100.100.200",
        "https://key:secret@example.com",
        "https://metadata.google.internal",
        "http://0.0.0.0",
        "https://example.com?key=secret",
    ],
)
def test_reject_unsafe_endpoint(url: str):
    with pytest.raises(network.EndpointError):
        network.validate_url(url)


async def test_concurrent_initial_save(client: httpx.AsyncClient):
    await admin(client)
    responses = await asyncio.gather(client.put(PATH, json=draft()), client.put(PATH, json=draft()))
    assert sorted(response.status_code for response in responses) == [200, 409]
    async with session_scope() as s:
        assert len(list((await s.scalars(select(AISettings))).all())) == 1


async def test_queued_worker_uses_saved_connection_and_honors_disable(
    client: httpx.AsyncClient, provider: tuple[str, list[dict[str, Any]]]
):
    from glosano.modules.chat.generation import run_generation
    from tests.api.test_chats import draft as chat_draft
    from tests.api.test_chats import send

    url, calls = provider
    await admin(client)
    body = draft(base_url=url)
    await client.put(PATH, json=body)
    await chat_draft(client)
    sent = await send(client)
    gid = uuid.UUID(sent["generation"]["id"])
    await client.put(PATH, json={**body, "revision": 1, "model": "worker-model"})
    await run_generation(gid)
    result = (await client.get(f"/api/chats/{sent['conversation_id']}/generations/{gid}")).json()
    assert result["status"] == "complete", result
    assert calls[-1]["body"]["model"] == "worker-model"
    await chat_draft(client, revision=2)
    sent = await send(client, revision=3)
    await client.put(PATH, json={**body, "revision": 2, "enabled": False})
    await run_generation(uuid.UUID(sent["generation"]["id"]))
    result = (
        await client.get(
            f"/api/chats/{sent['conversation_id']}/generations/{sent['generation']['id']}"
        )
    ).json()
    assert result["status"] == "failed"
    assert len(calls) == 1


async def test_retry_never_switches_to_another_provider(client: httpx.AsyncClient):
    await admin(client)
    body = draft()
    await client.put(PATH, json=body)
    snapshot = await effective_settings()
    calls = 0

    async def failing(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        changed = await client.put(PATH, json={**body, "revision": 1, "model": "new-model"})
        assert changed.status_code == 200
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(failing)) as http:
        with pytest.raises(ProviderRejected, match="configuration_changed"):
            await OpenAICompatibleProvider(snapshot, client=http).complete(
                system="test", user="test"
            )
    assert calls == 1


async def test_translation_cache_is_scoped_to_configuration(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from unittest.mock import patch

    from glosano.modules.ai_translation import service as translations
    from glosano.modules.lesson_library.models import Lesson, LessonSegment
    from glosano.modules.reader_state.translations import get_or_translate_segment
    from tests.api._reader_helpers import seed_ready_lesson

    me = await admin(client)
    uid = uuid.UUID(me["id"])
    await client.put(PATH, json=draft())
    lid = await seed_ready_lesson(client, client.headers["X-CSRF-Token"], monkeypatch)
    calls = 0

    async def translate(*_args: Any, **_kwargs: Any) -> translations.SentenceTranslationResult:
        nonlocal calls
        calls += 1
        settings = await effective_settings()
        return translations.SentenceTranslationResult(
            "translated", settings.llm_model, 1, settings.llm_revision
        )

    with patch.object(translations, "translate_sentence", translate):
        async with session_scope() as s:
            lesson = await s.get(Lesson, lid)
            segment = await s.scalar(select(LessonSegment).where(LessonSegment.lesson_id == lid))
            assert lesson and segment
            kwargs: dict[str, Any] = {
                "user_id": uid,
                "lesson": lesson,
                "segment_id": segment.id,
                "target_language_code": "ru",
            }
            _, cached = await get_or_translate_segment(s, **kwargs)
            assert not cached
            _, cached = await get_or_translate_segment(s, **kwargs)
            assert cached
            await client.put(PATH, json=draft(revision=1, model="new"))
            _, cached = await get_or_translate_segment(s, **kwargs)
            assert not cached
    assert calls == 2


@pytest.mark.parametrize(
    ("status", "raw", "expected"),
    [
        (302, b"", "incompatible_response"),
        (401, b"provider-secret", "authorization_failed"),
        (200, b"not-json", "incompatible_response"),
        (200, b"x" * 262145, "response_too_large"),
    ],
)
async def test_diagnostic_errors_are_bounded_and_never_follow_redirects(
    client: httpx.AsyncClient, status: int, raw: bytes, expected: str
):
    await admin(client)
    calls = 0

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal calls
        calls += 1
        await reader.readuntil(b"\r\n\r\n")
        writer.write(
            f"HTTP/1.1 {status} Test\r\nLocation: http://169.254.169.254/\r\n"
            f"Content-Length: {len(raw)}\r\nConnection: close\r\n\r\n".encode()
            + raw
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        response = await client.post(
            PATH + "/test", json=draft(base_url=f"http://127.0.0.1:{port}/v1")
        )
    assert response.status_code == 422
    assert response.json() == {"detail": expected}
    assert calls == 1
