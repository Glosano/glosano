"""answer(): SM-2 + confidence mapping (quality 0..5), graduation на c=5, append-only events."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.review.service import ReviewItemNotFound, answer
from glosano.modules.vocabulary import service as vocab
from glosano.modules.vocabulary.models import TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    return user.id


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (ReviewEvent, ReviewItem, TokenItem):
            await s.execute(delete(model))


async def _setup(s: AsyncSession, confidence: int = 1) -> tuple[uuid.UUID, TokenItem, ReviewItem]:
    user_id = await _make_user(s)
    item = await vocab.create_item(
        s,
        user_id=user_id,
        kind="token",
        language_code="pt",
        text="cada",
        status="tracked",
        confidence=confidence,
    )
    assert isinstance(item, TokenItem)
    ri = (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id))).scalars().one()
    return user_id, item, ri


async def test_q4_bumps_confidence_and_schedules():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=1)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
        assert res.new_confidence == 2 and res.new_status == "tracked"
        assert res.due_at == NOW + timedelta(days=1)
        assert res.done_today == 1
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.quality == 4 and ev.answer_value == "correct"
        assert (ev.previous_confidence, ev.new_confidence) == (1, 2)


async def test_q3_keeps_confidence_but_progresses_srs():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=2)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=3, now=NOW)
        assert res.new_confidence == 2  # q=3: confidence без изменений
        assert res.due_at == NOW + timedelta(days=1)  # но SRS прогрессирует
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.quality == 3 and ev.answer_value == "correct"


async def test_q0_drops_confidence_floor_zero_and_due_now():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=0)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=0, now=NOW)
        assert res.new_confidence == 0  # floor
        assert res.due_at == NOW
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.quality == 0 and ev.answer_value == "wrong"


async def test_graduation_at_q4_confidence_five():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=5)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
        assert res.new_status == "known" and res.new_confidence is None
    async with session_scope() as s:
        item_db = (await s.execute(select(TokenItem))).scalars().one()
        assert item_db.status == "known" and item_db.confidence is None
        ri_db = (await s.execute(select(ReviewItem))).scalars().one()
        assert ri_db.is_active is False


async def test_q3_at_confidence_five_does_not_graduate():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=5)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, quality=3, now=NOW)
        assert res.new_status == "tracked" and res.new_confidence == 5


async def test_events_are_append_only_across_answers():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=1)
        await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
        await answer(s, user_id=user_id, review_item_id=ri.id, quality=1, now=NOW)
        events = (await s.execute(select(ReviewEvent))).scalars().all()
        assert len(events) == 2


async def test_foreign_or_inactive_item_raises():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=5)
        stranger = await _make_user(s)
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=stranger, review_item_id=ri.id, quality=4, now=NOW)
        await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)  # graduation
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=user_id, review_item_id=ri.id, quality=4, now=NOW)
