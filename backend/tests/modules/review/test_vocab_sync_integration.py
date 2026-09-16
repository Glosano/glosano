"""Write-пути vocabulary поддерживают инвариант tracked ⇔ активный review_item."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.vocabulary import service as vocab
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


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
        for model in (ReviewEvent, ReviewItem, PhraseItem, TokenItem):
            await s.execute(delete(model))


async def _active_items(s: AsyncSession) -> list[ReviewItem]:
    return list(
        (await s.execute(select(ReviewItem).where(ReviewItem.is_active.is_(True)))).scalars().all()
    )


async def test_create_tracked_token_creates_review_item():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
        )
    async with session_scope() as s:
        [ri] = await _active_items(s)
        assert (ri.item_kind, ri.item_id, ri.language_code) == ("token", item.id, "pt")


async def test_create_tracked_phrase_creates_review_item():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="bom dia",
            status="tracked",
            confidence=1,
        )
    async with session_scope() as s:
        [ri] = await _active_items(s)
        assert (ri.item_kind, ri.item_id) == ("phrase", item.id)


async def test_create_known_does_not_create_review_item():
    async with session_scope() as s:
        user_id = await _make_user(s)
        await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="mundo",
            status="known",
            confidence=None,
        )
    async with session_scope() as s:
        assert await _active_items(s) == []


async def test_patch_to_known_deactivates_and_back_reactivates():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
        )
        await vocab.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="known",
            confidence=None,
        )
        assert await _active_items(s) == []
        await vocab.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="tracked",
            confidence=1,
        )
        assert len(await _active_items(s)) == 1


async def test_bulk_set_known_and_delete_deactivate():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="um",
            status="tracked",
            confidence=1,
        )
        b = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="dois",
            status="tracked",
            confidence=1,
        )
        await vocab.bulk_action(
            s,
            user_id=user_id,
            item_ids=[a.id],
            action="set_known",
            tag_name=None,
        )
        assert len(await _active_items(s)) == 1
        await vocab.bulk_action(
            s,
            user_id=user_id,
            item_ids=[b.id],
            action="delete",
            tag_name=None,
        )
        assert await _active_items(s) == []
