"""Atomic, idempotent completion of the final reader fragment (ADR-0014)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from glosano.modules.reader_state.bulk import bulk_mark_known
from glosano.modules.reader_state.completion_summary import completion_response, snapshot_vocabulary
from glosano.modules.reader_state.models import BulkAction, ReaderPosition
from glosano.modules.reader_state.schemas import CompleteLessonRequest, CompleteLessonResponse
from glosano.modules.statistics.models import DailyReadOccurrence


class InvalidFinalFragment(Exception): ...  # noqa: N818 — mapped to 422


async def complete_lesson(
    session: AsyncSession, *, user_id: uuid.UUID, lesson: Lesson, body: CompleteLessonRequest
) -> CompleteLessonResponse:
    """Caller holds the lesson revision lock; this function owns the commit."""
    last_segment = await session.scalar(
        select(LessonSegment)
        .where(LessonSegment.lesson_id == lesson.id, LessonSegment.segment_type == "sentence")
        .order_by(LessonSegment.ordinal.desc())
        .limit(1)
    )
    if body.last_segment_id != (last_segment.id if last_segment else None):
        raise InvalidFinalFragment
    words = select(LessonTokenOccurrence.ordinal_in_lesson).where(
        LessonTokenOccurrence.lesson_id == lesson.id, LessonTokenOccurrence.is_word_like.is_(True)
    )
    if body.view_mode == "sentence":
        words = words.where(LessonTokenOccurrence.segment_id == body.last_segment_id)
    bounds = words.subquery()
    first, last = (
        await session.execute(
            select(func.min(bounds.c.ordinal_in_lesson), func.max(bounds.c.ordinal_in_lesson))
        )
    ).one()
    if last is None:
        if body.from_ordinal is not None or body.to_ordinal is not None:
            raise InvalidFinalFragment
    elif (
        body.to_ordinal != last
        or body.from_ordinal is None
        or (body.view_mode == "sentence" and body.from_ordinal != first)
    ):
        raise InvalidFinalFragment

    await session.execute(
        insert(ReaderPosition)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            lesson_id=lesson.id,
            view_mode=body.view_mode,
        )
        .on_conflict_do_nothing(constraint="uq_reader_positions_user_lesson")
    )
    position = (
        await session.scalars(
            select(ReaderPosition)
            .where(ReaderPosition.user_id == user_id, ReaderPosition.lesson_id == lesson.id)
            .with_for_update()
        )
    ).one()
    if position.completed_at is not None and position.completion_action_id is not None:
        action = await session.get(BulkAction, position.completion_action_id)
        assert action is not None
        return completion_response(action, position.completed_at)

    summary = await snapshot_vocabulary(session, user_id=user_id, lesson=lesson)
    # The empty 0..-1 range creates an undo action without marking or counting words.
    action_id, count = await bulk_mark_known(
        session,
        user_id=user_id,
        lesson=lesson,
        from_ordinal=body.from_ordinal if body.from_ordinal is not None else 0,
        to_ordinal=body.to_ordinal if body.to_ordinal is not None else -1,
        commit=False,
    )
    summary.reading_days = (
        await session.scalar(
            select(func.count(func.distinct(DailyReadOccurrence.date))).where(
                DailyReadOccurrence.user_id == user_id, DailyReadOccurrence.lesson_id == lesson.id
            )
        )
        or 0
    )
    summary.marked_known_words = count
    action = await session.get(BulkAction, action_id)
    assert action is not None
    action.payload_json = {**action.payload_json, "completion_summary": summary.model_dump()}
    position.view_mode = body.view_mode
    position.current_segment_id = body.last_segment_id
    position.current_token_ordinal = await session.scalar(
        select(func.max(LessonTokenOccurrence.ordinal_in_lesson)).where(
            LessonTokenOccurrence.lesson_id == lesson.id,
            LessonTokenOccurrence.is_word_like.is_(True),
        )
    )
    completed_at = datetime.now(UTC)
    position.completed_at = completed_at
    position.completion_action_id = action_id
    await session.commit()
    return CompleteLessonResponse(
        action_id=action_id, created_count=count, completed_at=completed_at, summary=summary
    )
