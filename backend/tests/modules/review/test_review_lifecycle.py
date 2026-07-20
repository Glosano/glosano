"""sync_review_item: tracked ⇒ активный review_item; known/ignored ⇒ деактивация."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import deactivate_review_items, sync_review_item
from flinq.modules.review.sm2 import INITIAL_STATE, state_to_json

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
        for model in (ReviewEvent, ReviewItem):
            await s.execute(delete(model))


async def _one(s: AsyncSession) -> ReviewItem:
    return (await s.execute(select(ReviewItem))).scalars().one()


async def test_tracked_creates_active_item():
    item_id = uuid.uuid4()
    async with session_scope() as s:
        user_id = await _make_user(s)
        await sync_review_item(
            s,
            user_id=user_id,
            item_kind="token",
            item_id=item_id,
            language_code="pt",
            status="tracked",
            now=NOW,
        )
        await s.commit()
    async with session_scope() as s:
        ri = await _one(s)
        assert ri.is_active and ri.due_at == NOW and ri.item_id == item_id
        assert ri.algorithm_state_json == state_to_json(INITIAL_STATE)


async def test_tracked_again_does_not_duplicate_or_reset():
    item_id = uuid.uuid4()
    async with session_scope() as s:
        user_id = await _make_user(s)
        await sync_review_item(
            s,
            user_id=user_id,
            item_kind="token",
            item_id=item_id,
            language_code="pt",
            status="tracked",
            now=NOW,
        )
        await s.commit()
        # активный item: смена confidence руками не должна трогать SRS state
        item = await _one(s)
        item.algorithm_state_json = {"ease_factor": 2.1, "interval_days": 6.0, "repetitions": 2}
        await s.commit()
        await sync_review_item(
            s,
            user_id=user_id,
            item_kind="token",
            item_id=item_id,
            language_code="pt",
            status="tracked",
            now=NOW,
        )
        await s.commit()
    async with session_scope() as s:
        ri = await _one(s)
        assert ri.algorithm_state_json["repetitions"] == 2  # state сохранён


async def test_known_deactivates_and_retrack_reactivates_fresh():
    item_id = uuid.uuid4()
    async with session_scope() as s:
        user_id = await _make_user(s)
        await sync_review_item(
            s,
            user_id=user_id,
            item_kind="token",
            item_id=item_id,
            language_code="pt",
            status="tracked",
            now=NOW,
        )
        await s.commit()
        item = await _one(s)
        item.algorithm_state_json = {"ease_factor": 2.1, "interval_days": 6.0, "repetitions": 2}
        await sync_review_item(
            s,
            user_id=user_id,
            item_kind="token",
            item_id=item_id,
            language_code="pt",
            status="known",
            now=NOW,
        )
        await s.commit()
        assert (await _one(s)).is_active is False
        await sync_review_item(
            s,
            user_id=user_id,
            item_kind="token",
            item_id=item_id,
            language_code="pt",
            status="tracked",
            now=NOW,
        )
        await s.commit()
    async with session_scope() as s:
        ri = await _one(s)  # реактивация той же строки, не дубликат
        assert ri.is_active is True
        assert ri.algorithm_state_json == state_to_json(INITIAL_STATE)  # fresh state
        assert ri.due_at == NOW


async def test_bulk_deactivate():
    ids = [uuid.uuid4(), uuid.uuid4()]
    async with session_scope() as s:
        user_id = await _make_user(s)
        for iid in ids:
            await sync_review_item(
                s,
                user_id=user_id,
                item_kind="token",
                item_id=iid,
                language_code="pt",
                status="tracked",
                now=NOW,
            )
        await s.commit()
        await deactivate_review_items(s, user_id=user_id, item_kind="token", item_ids=ids)
        await s.commit()
    async with session_scope() as s:
        rows = (await s.execute(select(ReviewItem))).scalars().all()
        assert all(not r.is_active for r in rows) and len(rows) == 2
