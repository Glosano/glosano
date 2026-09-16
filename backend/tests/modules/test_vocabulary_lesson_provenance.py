"""Провенанс урока в write-путях vocabulary (FLQ-21)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from glosano.modules.review import service as review_service
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.vocabulary import service
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


async def test_create_item_known_status_does_not_record_provenance():
    """Провенанс — атрибут взятия слова в работу (status == tracked), не
    атрибут создания записи (решение человека, FLQ-21): ручная кнопка
    "Изучено" в ридере не должна занимать провенанс урока, иначе слово,
    позже переведённое в tracked в другом уроке, не смогло бы попасть в
    очередь этого урока (тот же капкан, что и bulk_mark_known)."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="novo",
            status="known",
            confidence=None,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert item.created_from_lesson_id is None
        assert item.created_from_segment_id is None


async def test_create_item_ignored_status_does_not_record_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="novo",
            status="ignored",
            confidence=None,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert item.created_from_lesson_id is None


async def test_known_word_created_in_one_lesson_can_be_tracked_into_another():
    """Сквозной сценарий: слово создано как known в уроке A (провенанс не
    пишется), затем встречено и взято в работу в уроке B — попадает в
    очередь урока B, не урока A."""
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson_a, seg_a = await _lesson(s, user_id)
        lesson_b, seg_b = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="novo",
            status="known",
            confidence=None,
            lesson_id=lesson_a.id,
            segment_id=seg_a.id,
        )
        assert item.created_from_lesson_id is None

        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="tracked",
            confidence=1,
            lesson_id=lesson_b.id,
            segment_id=seg_b.id,
        )
        assert patched.created_from_lesson_id == lesson_b.id

        items_b, _ = await review_service.get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson_b.id
        )
        assert [i.text for i in items_b] == ["novo"]
        items_a, _ = await review_service.get_queue(
            s, user_id=user_id, language_code="pt", lesson_id=lesson_a.id
        )
        assert items_a == []


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


async def test_create_item_rejects_language_mismatch_with_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, _ = await _lesson(s, user_id)  # урок на "pt"
        with pytest.raises(service.InvalidProvenance):
            await service.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="ru",  # язык записи и язык урока не совпадают
                text="cada",
                status="tracked",
                confidence=1,
                lesson_id=lesson.id,
            )


async def test_patch_item_rejects_language_mismatch_with_lesson():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, _ = await _lesson(s, user_id)  # урок на "pt"
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="ru",
            text="privet",
            status="known",
            confidence=None,
        )
        with pytest.raises(service.InvalidProvenance):
            await service.patch_item(
                s,
                user_id=user_id,
                kind="token",
                item_id=item.id,
                status="tracked",
                confidence=1,
                lesson_id=lesson.id,  # урок на "pt", item.language_code == "ru"
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


async def test_create_item_upsert_does_not_overwrite_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson_a, seg_a = await _lesson(s, user_id)
        lesson_b, seg_b = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
            lesson_id=lesson_a.id,
            segment_id=seg_a.id,
        )
        assert item.created_from_lesson_id == lesson_a.id
        again = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=3,
            lesson_id=lesson_b.id,
            segment_id=seg_b.id,
        )
        assert again.id == item.id
        assert again.created_from_lesson_id == lesson_a.id
        assert again.created_from_segment_id == seg_a.id


async def test_patch_to_tracked_fills_empty_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="known",
            confidence=None,
        )
        assert item.created_from_lesson_id is None
        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="tracked",
            confidence=1,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert patched.created_from_lesson_id == lesson.id
        assert patched.created_from_segment_id == seg.id


async def test_patch_does_not_overwrite_existing_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson_a, seg_a = await _lesson(s, user_id)
        lesson_b, seg_b = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="tracked",
            confidence=1,
            lesson_id=lesson_a.id,
            segment_id=seg_a.id,
        )
        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="tracked",
            confidence=3,
            lesson_id=lesson_b.id,
            segment_id=seg_b.id,
        )
        assert patched.created_from_lesson_id == lesson_a.id
        assert patched.created_from_segment_id == seg_a.id


async def test_patch_to_known_does_not_set_provenance():
    async with session_scope() as s:
        user_id = await _make_user(s)
        lesson, seg = await _lesson(s, user_id)
        item = await service.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="cada",
            status="ignored",
            confidence=None,
        )
        patched = await service.patch_item(
            s,
            user_id=user_id,
            kind="token",
            item_id=item.id,
            status="known",
            confidence=None,
            lesson_id=lesson.id,
            segment_id=seg.id,
        )
        assert patched.created_from_lesson_id is None
