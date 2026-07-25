"""get_queue: главная очередь (due, сортировка, лимит) и lesson-режим."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.config import get_settings
from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import LessonNotFound, get_counts, get_queue
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
        await _set_due(s, item.id, NOW - timedelta(hours=1))
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


async def test_new_mode_returns_unreviewed_newest_first():
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")
        await _tracked_token(s, user_id, "dois")
        # отвеченное слово выпадает из режима new
        ri_a = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == a.id))).scalars().one()
        )
        ri_a.last_reviewed_at = NOW
        await s.commit()
        items, daily = await get_queue(s, user_id=user_id, language_code="pt", mode="new", now=NOW)
        assert [i.text for i in items] == ["dois"]
        assert not daily.limit_reached


async def test_practice_mode_returns_confident_items_and_ignores_limit():
    async with session_scope() as s:
        user_id = await _make_user(s)
        strong = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="forte",
            status="tracked",
            confidence=4,
        )
        await _tracked_token(s, user_id, "fraco")  # confidence 1 — не попадает
        ri = (
            (await s.execute(select(ReviewItem).where(ReviewItem.item_id == strong.id)))
            .scalars()
            .one()
        )
        for _ in range(20):  # дневной лимит исчерпан
            s.add(
                ReviewEvent(
                    review_item_id=ri.id,
                    user_id=user_id,
                    answer_value="correct",
                    previous_confidence=4,
                    new_confidence=4,
                    previous_due_at=NOW,
                    new_due_at=NOW,
                    reviewed_at=NOW,
                )
            )
        await s.commit()
        items, daily = await get_queue(
            s, user_id=user_id, language_code="pt", mode="practice", now=NOW
        )
        assert [i.text for i in items] == ["forte"]  # лимит не режет practice
        assert daily.limit_reached is False


async def test_practice_mode_mixes_kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Слитый список перемешивается: phrase-элементы не вытесняются токенами."""
    import flinq.modules.review.service as review_service

    # Детерминированность: «перемешивание» = reverse, phrase-строки (добавленные
    # вторыми) оказываются в голове списка.
    def _reverse_shuffle(lst: list[object]) -> None:
        lst.reverse()

    monkeypatch.setattr(review_service.random, "shuffle", _reverse_shuffle)
    async with session_scope() as s:
        user_id = await _make_user(s)
        for i in range(5):
            await vocab.create_item(
                s,
                user_id=user_id,
                kind="token",
                language_code="pt",
                text=f"tok{i}",
                status="tracked",
                confidence=4,
            )
        await vocab.create_item(
            s,
            user_id=user_id,
            kind="phrase",
            language_code="pt",
            text="bom dia",
            status="tracked",
            confidence=4,
        )
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", mode="practice", now=NOW)
        assert len(items) == 5
        assert any(i.item_kind == "phrase" for i in items)


async def test_counts_reports_due_new_practice(monkeypatch: pytest.MonkeyPatch) -> None:
    # локальный .env репозитория держит FLINQ_LLM_ENABLED=true (dev/OpenRouter) —
    # явно фиксируем False, чтобы тест не зависел от ambient-конфига окружения.
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    async with session_scope() as s:
        user_id = await _make_user(s)
        a = await _tracked_token(s, user_id, "um")  # due + new
        strong = await vocab.create_item(
            s,
            user_id=user_id,
            kind="token",
            language_code="pt",
            text="forte",
            status="tracked",
            confidence=4,
        )
        # флейк-поправка: lifecycle-синк ставит due_at=real now(); тест
        # фиксирует NOW=2026-07-20 12:00 UTC — без явной пиновки due-счётчик
        # флейкует после полудня. Каждый item должен быть due относительно NOW.
        await _set_due(s, a.id, NOW - timedelta(hours=1))
        await _set_due(s, strong.id, NOW - timedelta(hours=1))
        counts = await get_counts(s, user_id=user_id, language_code="pt", now=NOW)
        assert counts.due == 2 and counts.new == 2 and counts.practice == 1
        assert counts.ai_enabled is False  # llm выключен в тестовом окружении


async def test_queue_context_sentence_comes_from_segment():
    async with session_scope() as s:
        user_id = await _make_user(s)
        item = await _tracked_token(s, user_id, "cada")
        lesson = await _lesson_with_occurrence(s, user_id, "cada")
        seg_id = (
            await s.execute(select(LessonSegment.id).where(LessonSegment.lesson_id == lesson.id))
        ).scalar_one()
        item.created_from_lesson_id = lesson.id
        item.created_from_segment_id = seg_id
        await _set_due(s, item.id, NOW - timedelta(hours=1))
        await s.commit()
        items, _ = await get_queue(s, user_id=user_id, language_code="pt", now=NOW)
        assert [i.context_sentence for i in items] == ["cada mundo."]
