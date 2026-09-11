"""Concurrent range accounting and UTC daily aggregates."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson

from flinq.core.db import session_scope
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson
from flinq.modules.statistics.models import DailyUserStats
from flinq.modules.statistics.service import get_overview, record_reading


async def test_concurrent_overlap_and_next_day(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    email = f"{uuid.uuid4()}@example.com"
    csrf = await register_and_onboard(client, email)
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Um, dois três!")
    user = await UserRepo(db_session).get_by_email(email)
    lesson = await db_session.get(Lesson, lesson_id)
    assert user is not None and lesson is not None
    now = datetime(2026, 9, 10, 23, 59, 59, tzinfo=UTC)

    async def record(start: int, end: int, when: datetime) -> None:
        async with session_scope() as session:
            await record_reading(
                session,
                user_id=user.id,
                lesson=lesson,
                from_ordinal=start,
                to_ordinal=end,
                now=when,
            )

    await asyncio.gather(record(0, 2, now), record(1, 100, now), record(0, 100, now))
    await record(0, 100, now + timedelta(seconds=1))
    for when in (now, now + timedelta(seconds=1)):
        overview = await get_overview(db_session, user_id=user.id, language_code="pt", now=when)
        assert overview.tokens_read_today == 3
        total = await db_session.scalar(
            select(DailyUserStats.tokens_read).where(
                DailyUserStats.user_id == user.id, DailyUserStats.date == when.date()
            )
        )
        assert total == 3
