"""Reader position upsert/read (domain model §7.1)."""

from __future__ import annotations

import uuid

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.reader_state.models import ReaderPosition


async def upsert_position(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    lesson_id: uuid.UUID,
    view_mode: str,
    current_segment_id: uuid.UUID | None,
    current_token_ordinal: int | None,
) -> None:
    insert_stmt = pg_insert(ReaderPosition).values(
        id=uuid.uuid4(),
        user_id=user_id,
        lesson_id=lesson_id,
        view_mode=view_mode,
        current_segment_id=current_segment_id,
        current_token_ordinal=current_token_ordinal,
    )
    # В ON CONFLICT DO UPDATE ссылки на колонки таблицы — это старая строка,
    # excluded — присланная. Первая вставка (первое открытие) и смена
    # view_mode активностью не считаются. Переключение режима сдвигает и
    # ordinal (страница хранит конец страницы, предложение — конец
    # предложения), поэтому сдвиг засчитывается только в том же режиме.
    moved = and_(
        ReaderPosition.view_mode == insert_stmt.excluded.view_mode,
        or_(
            ReaderPosition.current_segment_id.is_distinct_from(
                insert_stmt.excluded.current_segment_id
            ),
            ReaderPosition.current_token_ordinal.is_distinct_from(
                insert_stmt.excluded.current_token_ordinal
            ),
        ),
    )
    stmt = insert_stmt.on_conflict_do_update(
        constraint="uq_reader_positions_user_lesson",
        set_={
            "view_mode": view_mode,
            "current_segment_id": current_segment_id,
            "current_token_ordinal": current_token_ordinal,
            "last_opened_at": func.now(),
            "last_activity_at": case((moved, func.now()), else_=ReaderPosition.last_activity_at),
        },
    )
    await session.execute(stmt)
    await session.commit()


async def get_position(
    session: AsyncSession, *, user_id: uuid.UUID, lesson_id: uuid.UUID
) -> ReaderPosition | None:
    return await session.scalar(
        select(ReaderPosition).where(
            ReaderPosition.user_id == user_id, ReaderPosition.lesson_id == lesson_id
        )
    )
