"""answer(): SM-2 + confidence ±1, graduation на c=5, append-only events."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import ReviewItemNotFound, answer
from flinq.modules.vocabulary import service as vocab
from flinq.modules.vocabulary.models import TokenItem

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


async def test_correct_bumps_confidence_and_schedules():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=1)
        res = await answer(
            s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW
        )
        assert res.new_confidence == 2 and res.new_status == "tracked"
        assert res.due_at == NOW + timedelta(days=1)
        assert res.done_today == 1
    async with session_scope() as s:
        item_db = (await s.execute(select(TokenItem))).scalars().one()
        assert item_db.confidence == 2
        ri_db = (await s.execute(select(ReviewItem))).scalars().one()
        assert ri_db.last_reviewed_at == NOW
        assert ri_db.algorithm_state_json["repetitions"] == 1
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert (ev.previous_confidence, ev.new_confidence) == (1, 2)
        assert ev.answer_value == "correct"


async def test_wrong_drops_confidence_floor_zero_and_due_now():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=0)
        res = await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="wrong", now=NOW)
        assert res.new_confidence == 0  # floor
        assert res.due_at == NOW  # снова due сразу


async def test_graduation_at_confidence_five():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=5)
        res = await answer(
            s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW
        )
        assert res.new_status == "known" and res.new_confidence is None
    async with session_scope() as s:
        item_db = (await s.execute(select(TokenItem))).scalars().one()
        assert item_db.status == "known" and item_db.confidence is None
        ri_db = (await s.execute(select(ReviewItem))).scalars().one()
        assert ri_db.is_active is False
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.previous_confidence == 5 and ev.new_confidence is None


async def test_events_are_append_only_across_answers():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=1)
        await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
        # item снова due только через день, но answer по id всё равно валиден
        await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="wrong", now=NOW)
        events = (await s.execute(select(ReviewEvent))).scalars().all()
        assert len(events) == 2


async def test_foreign_or_inactive_item_raises():
    async with session_scope() as s:
        user_id, _item, ri = await _setup(s, confidence=5)
        stranger = await _make_user(s)
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=stranger, review_item_id=ri.id, answer_value="correct", now=NOW)
        # graduation деактивирует — повторный ответ по неактивному запрещён
        await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
        with pytest.raises(ReviewItemNotFound):
            await answer(s, user_id=user_id, review_item_id=ri.id, answer_value="correct", now=NOW)
