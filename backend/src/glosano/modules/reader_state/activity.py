"""Время последней осмысленной работы с материалом (FLQ-36)."""

from __future__ import annotations

import uuid

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.reader_state.models import ReaderPosition


async def touch_lesson_activity(
    session: AsyncSession, *, user_id: uuid.UUID, lesson_id: uuid.UUID
) -> None:
    """Отметить работу с материалом; строку позиции создаёт, если её ещё нет.

    Поля позиции не трогает. Не коммитит — касание должно попасть в транзакцию
    действия, которое его вызвало.
    """
    await session.execute(
        pg_insert(ReaderPosition)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            lesson_id=lesson_id,
            last_activity_at=func.now(),
        )
        .on_conflict_do_update(
            constraint="uq_reader_positions_user_lesson",
            set_={"last_activity_at": func.now()},
        )
    )
