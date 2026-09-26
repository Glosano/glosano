"""list_items: due-фильтр (due_before) даёт ровно столько записей, сколько due-счётчик (FLQ-35)."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.review.service import get_counts
from glosano.modules.vocabulary import service
from glosano.modules.vocabulary.models import PersonalTranslation, PhraseItem, TokenItem

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)

LIST_DEFAULTS: dict[str, Any] = {
    "target_language_code": "ru",
    "statuses": ["tracked", "known", "ignored"],
    "confidence_min": None,
    "confidence_max": None,
    "tags": [],
    "q": None,
    "added_after": None,
    "sort": "text",
    "sort_dir": "asc",
    "page": 1,
    "page_size": 25,
    "added_by": "user",
}


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (ReviewEvent, ReviewItem, PersonalTranslation, PhraseItem, TokenItem):
            await s.execute(delete(model))


async def _make_user(s: AsyncSession) -> uuid.UUID:
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    return user.id


async def _item(
    s: AsyncSession, user_id: uuid.UUID, kind: str, text: str, status: str, due: datetime | None
) -> None:
    item = await service.create_item(
        s,
        user_id=user_id,
        kind=kind,
        language_code="pt",
        text=text,
        status=status,
        confidence=1 if status == "tracked" else None,
    )
    if due is not None:
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
            .scalars()
            .one()
        )
        ri.due_at = due
    await s.commit()


async def _seed(s: AsyncSession, user_id: uuid.UUID) -> None:
    await _item(s, user_id, "token", "casa", "tracked", NOW - timedelta(days=1))
    await _item(s, user_id, "token", "livro", "tracked", NOW + timedelta(days=1))  # ещё рано
    await _item(s, user_id, "token", "porta", "known", None)  # без активного повтора
    await _item(s, user_id, "phrase", "bom dia", "tracked", NOW - timedelta(hours=1))
    await _item(s, user_id, "phrase", "boa noite", "tracked", NOW + timedelta(hours=1))


@pytest.mark.parametrize(
    ("kind", "expected"),
    [("all", ["bom dia", "casa"]), ("token", ["casa"]), ("phrase", ["bom dia"])],
)
async def test_due_filter_lists_items_due_for_review(kind: str, expected: list[str]) -> None:
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _seed(s, user_id)
        items, total = await service.list_items(
            s, user_id=user_id, language_code="pt", kind=kind, due_before=NOW, **LIST_DEFAULTS
        )
        assert [i.text for i in items] == expected
        counts = await get_counts(s, user_id=user_id, language_code="pt", kind=kind, now=NOW)
        assert total == counts.due


async def test_without_due_filter_lists_everything() -> None:
    async with session_scope() as s:
        user_id = await _make_user(s)
        await _seed(s, user_id)
        _, total = await service.list_items(
            s, user_id=user_id, language_code="pt", kind="all", **LIST_DEFAULTS
        )
        assert total == 5
