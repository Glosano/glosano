"""ReviewItem/ReviewEvent roundtrip + backfill SQL (FLQ-7 Task 1)."""

import importlib.util
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.vocabulary.models import TokenItem


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


async def test_review_item_and_event_roundtrip():
    now = datetime.now(UTC)
    async with session_scope() as s:
        user_id = await _make_user(s)
        ri = ReviewItem(
            user_id=user_id,
            item_kind="token",
            item_id=uuid.uuid4(),
            language_code="pt",
            algorithm_state_json={"ease_factor": 2.5, "interval_days": 0.0, "repetitions": 0},
            due_at=now,
        )
        s.add(ri)
        await s.flush()
        assert ri.is_active is True and ri.algorithm_name == "sm2"
        s.add(
            ReviewEvent(
                review_item_id=ri.id,
                user_id=user_id,
                answer_value="correct",
                previous_confidence=1,
                new_confidence=2,
                previous_due_at=now,
                new_due_at=now,
            )
        )
        await s.commit()
    async with session_scope() as s:
        ev = (await s.execute(select(ReviewEvent))).scalars().one()
        assert ev.answer_value == "correct" and ev.reviewed_at is not None


async def test_unique_active_allows_inactive_duplicates():
    """Partial unique: два неактивных дубликата допустимы, активный — один."""
    now = datetime.now(UTC)
    async with session_scope() as s:
        user_id = await _make_user(s)
        item_id = uuid.uuid4()
        for active in (False, False, True):
            s.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind="token",
                    item_id=item_id,
                    language_code="pt",
                    is_active=active,
                    algorithm_state_json={},
                    due_at=now,
                )
            )
        await s.commit()  # не должно упасть


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "0012_review",
        Path(__file__).parent.parent.parent.parent / "migrations" / "versions" / "0012_review.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_chains_from_0011():
    mod = _load_migration()
    assert mod.revision == "0012_review"
    assert mod.down_revision == "0011_phrase_text_check"
    assert callable(mod.upgrade) and callable(mod.downgrade)


async def test_backfill_sql_creates_active_items_for_tracked():
    mod = _load_migration()
    async with session_scope() as s:
        user_id = await _make_user(s)
        s.add(
            TokenItem(
                user_id=user_id,
                language_code="pt",
                token_text="cada",
                status="tracked",
                confidence=1,
            )
        )
        s.add(
            TokenItem(
                user_id=user_id,
                language_code="pt",
                token_text="mundo",
                status="known",
                confidence=None,
            )
        )
        await s.flush()
        await s.execute(text(mod.BACKFILL_SQL_TOKENS))
        await s.execute(text(mod.BACKFILL_SQL_PHRASES))
        await s.commit()
    async with session_scope() as s:
        rows = (await s.execute(select(ReviewItem))).scalars().all()
        assert len(rows) == 1
        ri = rows[0]
        assert ri.is_active and ri.item_kind == "token" and ri.language_code == "pt"
        assert ri.algorithm_state_json == {
            "ease_factor": 2.5,
            "interval_days": 0.0,
            "repetitions": 0,
        }


async def test_review_event_quality_roundtrip():
    now = datetime.now(UTC)
    async with session_scope() as s:
        user_id = await _make_user(s)
        ri = ReviewItem(
            user_id=user_id,
            item_kind="token",
            item_id=uuid.uuid4(),
            language_code="pt",
            algorithm_state_json={},
            due_at=now,
        )
        s.add(ri)
        await s.flush()
        s.add(
            ReviewEvent(
                review_item_id=ri.id,
                user_id=user_id,
                answer_value="correct",
                quality=4,
                previous_confidence=1,
                new_confidence=2,
                previous_due_at=now,
                new_due_at=now,
            )
        )
        # старые события без quality остаются валидными
        s.add(
            ReviewEvent(
                review_item_id=ri.id,
                user_id=user_id,
                answer_value="wrong",
                previous_confidence=1,
                new_confidence=0,
                previous_due_at=now,
                new_due_at=now,
            )
        )
        await s.commit()
    async with session_scope() as s:
        rows = (
            (await s.execute(select(ReviewEvent).order_by(ReviewEvent.reviewed_at))).scalars().all()
        )
        assert {r.quality for r in rows} == {4, None}


def test_migration_0013_chains_from_0012():
    spec = importlib.util.spec_from_file_location(
        "0013_review_quality",
        Path(__file__).parent.parent.parent.parent
        / "migrations"
        / "versions"
        / "0013_review_quality.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.revision == "0013_review_quality"
    assert mod.down_revision == "0012_review"
    assert callable(mod.upgrade) and callable(mod.downgrade)
