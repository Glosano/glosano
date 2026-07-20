"""SRS review service (FLQ-7). Session-first module functions.

Lifecycle-инвариант (domain model §10.1): tracked item ⇔ активный review_item.
sync_review_item/deactivate_review_items вызываются из write-путей vocabulary
ДО их commit — сами не коммитят.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.modules.review.models import ReviewItem
from flinq.modules.review.sm2 import INITIAL_STATE, state_to_json


async def sync_review_item(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    item_kind: str,
    item_id: uuid.UUID,
    language_code: str,
    status: str,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(UTC)
    existing = (
        (
            await session.execute(
                select(ReviewItem).where(
                    ReviewItem.user_id == user_id,
                    ReviewItem.item_kind == item_kind,
                    ReviewItem.item_id == item_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if status == "tracked":
        if existing is None:
            session.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind=item_kind,
                    item_id=item_id,
                    language_code=language_code,
                    is_active=True,
                    algorithm_state_json=state_to_json(INITIAL_STATE),
                    due_at=now,
                )
            )
        elif not existing.is_active:
            # Реактивация (known/ignored -> tracked): свежая траектория (spec §3).
            existing.is_active = True
            existing.algorithm_state_json = state_to_json(INITIAL_STATE)
            existing.due_at = now
        # Уже активный: ручная смена confidence SRS state не трогает.
    elif existing is not None and existing.is_active:
        existing.is_active = False


async def deactivate_review_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    item_kind: str,
    item_ids: list[uuid.UUID],
) -> None:
    await session.execute(
        update(ReviewItem)
        .where(
            ReviewItem.user_id == user_id,
            ReviewItem.item_kind == item_kind,
            ReviewItem.item_id.in_(item_ids),
            ReviewItem.is_active.is_(True),
        )
        .values(is_active=False)
    )
