"""Writes must be committed before the response leaves the server (FLQ-19).

A client that gets a 200 from /auth/login and immediately calls /me must find
the session it was just given. If the DB transaction commits only after the
response is sent, that follow-up request races the commit and gets a 401.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from http.cookies import SimpleCookie

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from glosano.core.db import get_session, session_scope
from glosano.main import create_app
from glosano.modules.identity.middleware import SESSION_COOKIE
from glosano.modules.identity.repo import SessionRepo, UserRepo

Probe = Callable[[Message], Awaitable[None]]


def _slow_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make every commit slow so a commit racing the response reliably loses.

    The app's BaseHTTPMiddleware stack streams the response from a separate
    task, so without this the late commit wins or loses by scheduling luck.
    """
    original = AsyncSession.commit

    async def slow_commit(self: AsyncSession) -> None:
        await asyncio.sleep(0.2)
        await original(self)

    monkeypatch.setattr(AsyncSession, "commit", slow_commit)


def _probe_response_start(app: ASGIApp, probe: Probe) -> ASGIApp:
    """Run `probe` at the moment the response headers are sent to the client."""

    async def wrapped(scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_probe(message: Message) -> None:
            if message["type"] == "http.response.start":
                await probe(message)
            await send(message)

        await app(scope, receive, send_with_probe)

    return wrapped


def _session_token(message: Message) -> str | None:
    for name, value in message.get("headers", []):
        if name.lower() == b"set-cookie":
            cookie = SimpleCookie(value.decode("latin-1"))
            if SESSION_COOKIE in cookie:
                return cookie[SESSION_COOKIE].value
    return None


async def test_login_session_is_committed_before_the_response_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = f"commit-login-{uuid.uuid4()}@example.com"
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        r = await c.post(
            "/auth/register",
            json={"display_name": "T", "email": email, "password": "abcdefghij"},
        )
        assert r.status_code == 201, r.text

    _slow_commits(monkeypatch)
    seen: list[bool] = []

    async def probe(message: Message) -> None:
        token = _session_token(message)
        assert token, "login response must set the session cookie"
        async with session_scope() as s:
            seen.append(await SessionRepo(s).get_active(token) is not None)

    app = _probe_response_start(create_app(), probe)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/auth/login",
            json={"email": email, "password": "abcdefghij", "remember_me": True},
        )
        assert r.status_code == 200, r.text

    assert seen == [True]


async def test_registered_user_is_committed_before_the_response_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = f"commit-register-{uuid.uuid4()}@example.com"
    _slow_commits(monkeypatch)
    seen: list[bool] = []

    async def probe(message: Message) -> None:
        async with session_scope() as s:
            seen.append(await UserRepo(s).get_by_email(email) is not None)

    app = _probe_response_start(create_app(), probe)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/auth/register",
            json={"display_name": "T", "email": email, "password": "abcdefghij"},
        )
        assert r.status_code == 201, r.text

    assert seen == [True]


def _session_dependants(dependant: Dependant) -> list[Dependant]:
    found = [d for d in dependant.dependencies if d.call is get_session]
    for sub in dependant.dependencies:
        found.extend(_session_dependants(sub))
    return found


def test_every_route_commits_its_db_session_before_responding() -> None:
    """Guard for new endpoints: a request-scoped get_session commits too late."""
    late: list[str] = []
    for route in create_app().routes:
        if not isinstance(route, APIRoute):
            continue
        for dep in _session_dependants(route.dependant):
            if dep.scope != "function":
                late.append(f"{sorted(route.methods)} {route.path}")
    assert late == []
