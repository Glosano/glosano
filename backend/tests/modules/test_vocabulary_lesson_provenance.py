"""Провенанс урока в write-путях vocabulary (FLQ-21)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.vocabulary import service
from flinq.modules.vocabulary.models import PhraseItem, TokenItem


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
        for model in (
            ReviewEvent,
            ReviewItem,
            LessonTokenOccurrence,
            LessonSegment,
            Lesson,
            PhraseItem,
            TokenItem,
        ):
            await s.execute(delete(model))


async def _lesson(s: AsyncSession, user_id: uuid.UUID) -> tuple[Lesson, LessonSegment]:
    lesson = Lesson(owner_user_id=user_id, language_code="pt", title="L", raw_text="cada dia")
    s.add(lesson)
    await s.flush()
    seg = LessonSegment(
        lesson_id=lesson.id,
        ordinal=0,
        text="cada dia.",
        start_char_offset=0,
        end_char_offset=9,
    )
    s.add(seg)
    await s.flush()
    return lesson, seg


async def test_create_item_records_lesson_and_segment():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert item.created_from_lesson_id == lesson.id
        assert item.created_from_segment_id == seg.id


async def test_create_phrase_records_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="cada dia",
            status="tracked",
            confidence=1,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert item.created_from_lesson_id == lesson.id


async def test_create_item_rejects_foreign_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        other_id = await _make_user(s)
        lesson, _ = await _lesson(s, other_id)
        with pytest.raises(service.LessonNotFound):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text="cada",
                status="tracked",
                confidence=1,
                lesson_id=lesson.id,
            )


async def test_create_item_rejects_segment_from_other_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson_a, _ = await _lesson(s, user_id)
        _, seg_b = await _lesson(s, user_id)
        with pytest.raises(service.InvalidProvenance):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text="cada",
                status="tracked",
                confidence=1,
                lesson_id=lesson_a.id,
                segment_id=seg_b.id,
            )


async def test_create_item_rejects_segment_without_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        _, seg = await _lesson(s, user_id)
        with pytest.raises(service.InvalidProvenance):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text="cada",
                status="tracked",
                confidence=1,
                segment_id=seg.id,
            )
