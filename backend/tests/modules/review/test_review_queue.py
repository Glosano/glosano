"""get_queue: главная очередь (due, сортировка, лимит) и lesson-режим."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import LessonNotFound, get_queue
from flinq.modules.vocabulary import service as vocab
from flinq.modules.vocabulary.models import PersonalTranslation, PhraseItem, TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    # UserRepo(s).create() already attaches a UserSettings row (see
    # flinq/modules/identity/repo.py) — adding a second one here would
    # violate the user_settings_pkey unique constraint.
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
        for model in (
            ReviewEvent,
            ReviewItem,
            PersonalTranslation,
            LessonTokenOccurrence,
            LessonSegment,
            Lesson,
            PhraseItem,
            TokenItem,
        ):
            await s.execute(delete(model))


async def _tracked_token(s: AsyncSession, user_id: uuid.UUID, text: str) -> TokenItem:
    item = await vocab.create_item(
        s,
        user_id=user_id,
        kind="token",
        language_code="pt",
        text=text,
        status="tracked",
        confidence=1,
    )
    assert isinstance(item, TokenItem)
    return item


async def _set_due(s: AsyncSession, item_id: uuid.UUID, due: datetime) -> None:
    ri = (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item_id))).scalars().one()
    ri.due_at = due
    await s.commit()


async def test_main_queue_returns_due_sorted_and_skips_not_due():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")
        b = await _tracked_token(s, user_id, "dois")
        c = await _tracked_token(s, user_id, "tres")
        await _set_due(s, a.id, NOW - timedelta(days=1))
        await _set_due(s, b.id, NOW - timedelta(days=2))
        await _set_due(s, c.id, NOW + timedelta(days=1))  # не due
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert [i.text for i in items] == ["dois", "um"]  # старейший due первым
        assert daily.limit == 20 and daily.done_today == 0 and not daily.limit_reached


async def test_queue_includes_translation_and_confidence():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        await vocab.add_translation(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            target_language_code="ru",
            translation_text="каждый",
            source_type="user",
        )
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert items[0].translation == "каждый" and items[0].confidence == 1


async def test_limit_reached_empties_main_queue():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id)))
            .scalars()
            .one()
        )
        for _ in range(20):  # daily_goal_reviews default = 20
            s.add(
                ReviewEvent(
                    review_item_id=ri.id,
                    user_id=user_id,
                    answer_value="correct",
                    previous_confidence=1,
                    new_confidence=2,
                    previous_due_at=NOW,
                    new_due_at=NOW,
                    reviewed_at=NOW,
                )
            )
        await s.commit()
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert items == [] and daily.limit_reached and daily.done_today == 20


async def _lesson_with_occurrence(s: AsyncSession, user_id: uuid.UUID, token_text: str) -> Lesson:
    lesson = Lesson(
        owner_user_id=user_id,
        language_code="pt",
        title="T",
        raw_text=f"{token_text} mundo",
    )
    s.add(lesson)
    await s.flush()
    seg = LessonSegment(
        lesson_id=lesson.id,
        ordinal=0,
        text=f"{token_text} mundo.",
        start_char_offset=0,
        end_char_offset=10,
    )
    s.add(seg)
    await s.flush()
    s.add(
        LessonTokenOccurrence(
            lesson_id=lesson.id,
            segment_id=seg.id,
            ordinal_in_lesson=0,
            ordinal_in_segment=0,
            surface_text=token_text,
            normalized_text=token_text,
            start_char_offset=0,
            end_char_offset=len(token_text),
        )
    )
    await s.flush()
    return lesson


async def test_lesson_queue_returns_all_tracked_ignoring_due_and_limit():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        await _tracked_token(s, user_id, "fora")  # tracked, но не в уроке
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        await _set_due(s, item.id, NOW + timedelta(days=3))  # не due — всё равно попадает
        items, daily = await get_queue(
            s,
            user_id=user_id,
            language_code="pt",
            lesson_id=lesson.id,
            now=NOW,
        )
        assert [i.text for i in items] == ["cada"]
        assert items[0].context_sentence is None or "cada" in items[0].context_sentence
        assert not daily.limit_reached


async def test_lesson_queue_foreign_lesson_raises():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson = await _lesson_with_occurrence(s, other_id, "cada")
        with pytest.raises(LessonNotFound):
            await get_queue(
                s,
                user_id=user_id,
                language_code="pt",
                lesson_id=lesson.id,
                now=NOW,
            )
