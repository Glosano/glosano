"""Source-backed overview and transaction-local reading accounting."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.languages import LearningLanguageCode
from glosano.modules.lesson_library.models import Lesson, LessonTokenOccurrence
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.review.service import get_counts
from glosano.modules.statistics.models import (
    DailyReadOccurrence,
    DailyUserLanguageStats,
    DailyUserStats,
    StatisticsTracking,
)
from glosano.modules.statistics.schemas import Overview
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


async def record_reading(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    lesson: Lesson,
    from_ordinal: int,
    to_ordinal: int,
    now: datetime | None = None,
) -> None:
    day = (now or datetime.now(UTC)).astimezone(UTC).date()
    occurrences = (
        select(
            literal(user_id),
            literal(day),
            LessonTokenOccurrence.lesson_id,
            LessonTokenOccurrence.ordinal_in_lesson,
        )
        .where(
            LessonTokenOccurrence.lesson_id == lesson.id,
            LessonTokenOccurrence.is_word_like.is_(True),
            LessonTokenOccurrence.ordinal_in_lesson.between(from_ordinal, to_ordinal),
        )
        .order_by(LessonTokenOccurrence.ordinal_in_lesson)
    )
    added = (
        await session.scalars(
            insert(DailyReadOccurrence)
            .from_select(["user_id", "date", "lesson_id", "ordinal"], occurrences)
            .on_conflict_do_nothing()
            .returning(DailyReadOccurrence.ordinal)
        )
    ).all()
    if not added:
        return
    for model, keys in (
        (DailyUserStats, {"user_id": user_id, "date": day}),
        (
            DailyUserLanguageStats,
            {"user_id": user_id, "date": day, "language_code": lesson.language_code},
        ),
    ):
        await session.execute(
            insert(model)
            .values(**keys, tokens_read=len(added))
            .on_conflict_do_update(
                index_elements=list(keys), set_={"tokens_read": model.tokens_read + len(added)}
            )
        )


async def get_overview(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: LearningLanguageCode,
    now: datetime | None = None,
) -> Overview:
    now = (now or datetime.now(UTC)).astimezone(UTC)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    counts = {"known": 0, "tracked": 0, "ignored": 0}
    for model in (TokenItem, PhraseItem):
        rows = await session.execute(
            select(model.status, func.count())
            .where(model.user_id == user_id, model.language_code == language_code)
            .group_by(model.status)
        )
        for status, count in rows:
            counts[status] += count
    first_added = (
        select(func.min(ReviewItem.created_at).label("first_at"))
        .where(ReviewItem.user_id == user_id, ReviewItem.language_code == language_code)
        .group_by(ReviewItem.item_kind, ReviewItem.item_id)
        .subquery()
    )
    new_count = await session.scalar(
        select(func.count())
        .select_from(first_added)
        .where(first_added.c.first_at >= start, first_added.c.first_at < end)
    )
    events = (
        select(ReviewEvent.id)
        .join(ReviewItem)
        .where(
            ReviewEvent.user_id == user_id,
            ReviewItem.user_id == user_id,
            ReviewItem.language_code == language_code,
            ReviewEvent.reviewed_at >= start,
            ReviewEvent.reviewed_at < end,
        )
    )
    reviews = await session.scalar(select(func.count()).select_from(events.subquery()))
    graduates = (
        events.with_only_columns(ReviewItem.item_kind, ReviewItem.item_id)
        .where(
            ReviewEvent.answer_value == "correct",
            ReviewEvent.previous_confidence == 5,
            ReviewEvent.new_confidence.is_(None),
        )
        .distinct()
        .subquery()
    )
    learned = await session.scalar(select(func.count()).select_from(graduates))
    reading = await session.scalar(
        select(DailyUserLanguageStats.tokens_read).where(
            DailyUserLanguageStats.user_id == user_id,
            DailyUserLanguageStats.date == start.date(),
            DailyUserLanguageStats.language_code == language_code,
        )
    )
    tracking = (
        await session.execute(
            select(StatisticsTracking.started_at).where(StatisticsTracking.id == 1)
        )
    ).scalar_one()
    due = await get_counts(session, user_id=user_id, language_code=language_code, now=now)
    return Overview(
        language_code=language_code,
        date=start.date(),
        known_items_count=counts["known"],
        tracked_items_count=counts["tracked"],
        ignored_items_count=counts["ignored"],
        tokens_read_today=reading or 0,
        new_items_today=new_count or 0,
        learned_items_today=learned or 0,
        reviews_completed_today=reviews or 0,
        due_reviews=due.due,
        reading_tracking_started_at=tracking,
    )
