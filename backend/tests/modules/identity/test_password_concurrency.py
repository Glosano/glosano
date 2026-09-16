"""A login already verifying the old password cannot outlive session revocation."""

import asyncio
import uuid

from fastapi import Request, Response
from redis.asyncio import Redis
from sqlalchemy import text

from glosano.core.db import session_scope
from glosano.core.rate_limit import RateLimiter
from glosano.core.security import hash_password
from glosano.modules.identity.middleware import SESSION_TTL
from glosano.modules.identity.repo import SessionRepo, UserRepo
from glosano.modules.identity.service import change_password, login_user


async def test_password_change_revokes_login_already_using_old_password(redis_client: Redis):
    from datetime import UTC, datetime

    async with session_scope() as session:
        user = await UserRepo(session).create(
            email=f"{uuid.uuid4()}@example.com",
            password_hash=hash_password("old-password"),
            display_name="Concurrent",
        )
        user_id, email = user.id, user.email
        await SessionRepo(session).create(
            token="current-session", user_id=user_id, expires_at=datetime.now(UTC) + SESSION_TTL
        )

    login_verified = asyncio.Event()
    release_login = asyncio.Event()
    password_connected = asyncio.Event()
    password_pid = 0

    class PausingRateLimiter(RateLimiter):
        async def reset(self, key: str) -> None:
            # login_user reaches reset only after a valid password check.
            login_verified.set()
            await release_login.wait()
            await super().reset(key)

    response = Response()

    async def login() -> None:
        async with session_scope() as session:
            await login_user(
                Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1)}),
                response,
                email=email,
                password="old-password",
                remember_me=True,
                user_repo=UserRepo(session),
                session_repo=SessionRepo(session),
                rate_limiter=PausingRateLimiter(redis_client, max_attempts=5, window_seconds=900),
            )

    async def change() -> None:
        nonlocal password_pid
        async with session_scope() as session:
            pid = await session.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(pid, int)
            password_pid = pid
            password_connected.set()
            await change_password(
                user_id,
                current_password="old-password",
                new_password="new-password",
                current_session_token="current-session",
                user_repo=UserRepo(session),
            )

    login_task = asyncio.create_task(login())
    change_task: asyncio.Task[None] | None = None
    try:
        await asyncio.wait_for(login_verified.wait(), timeout=5)
        change_task = asyncio.create_task(change())
        await asyncio.wait_for(password_connected.wait(), timeout=5)
        # Wait for a real database lock wait OR completed password change (the buggy case).
        # This does not infer transaction ordering from an arbitrary sleep duration.
        async with asyncio.timeout(5), session_scope() as observer:
            while not change_task.done():
                waiting = await observer.scalar(
                    text("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"),
                    {"pid": password_pid},
                )
                await observer.commit()
                if waiting:
                    break
                await asyncio.sleep(0.01)
        release_login.set()
        await asyncio.gather(login_task, change_task)
        async with session_scope() as session:
            assert await SessionRepo(session).get_active("current-session") is not None
            active = await session.scalar(
                text(
                    "SELECT count(*) FROM user_sessions "
                    "WHERE user_id = :user_id AND expires_at > now()"
                ),
                {"user_id": user_id},
            )
            assert active == 1  # even the paused login was revoked
    finally:
        release_login.set()
        for task in (login_task, change_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (login_task, change_task) if task is not None),
            return_exceptions=True,
        )
