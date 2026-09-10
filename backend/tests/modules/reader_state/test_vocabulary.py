"""Lesson vocabulary snapshot service and phrase matching."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import get_engine
from flinq.core.security import hash_password
from flinq.modules.ai_translation import service as ai_service
from flinq.modules.dictionary.provider import WiktionaryLocalProvider
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson
from flinq.modules.lesson_library.service import process_lesson_import
from flinq.modules.reader_state.schemas import (
    LessonContentResponse,
    ParagraphOut,
    PunctToken,
    SentenceOut,
    WhitespaceToken,
    WordToken,
)
from flinq.modules.reader_state.vocabulary import build_lesson_vocabulary, find_phrase_context
from flinq.modules.review.models import ReviewItem
from flinq.modules.vocabulary.models import PersonalTranslation, PhraseItem, TokenItem


def test_find_phrase_context_uses_normalized_words_and_stays_in_one_sentence() -> None:
    first_id = uuid.uuid4()
    second_id = uuid.uuid4()
    content = LessonContentResponse(
        lesson_id=uuid.uuid4(),
        language_code="pt",
        word_count=3,
        paragraphs=[
            ParagraphOut(
                sentences=[
                    SentenceOut(
                        seg_id=first_id,
                        index=0,
                        text="Mão, bem-estar.",
                        normalized_text="mão, bem-estar.",
                        tokens=[
                            WordToken(t="Mão", n="mão", i=0),
                            PunctToken(p=","),
                            WhitespaceToken(ws=" "),
                            WordToken(t="bem-estar", n="bem-estar", i=2),
                            PunctToken(p="."),
                        ],
                    ),
                    SentenceOut(
                        seg_id=second_id,
                        index=1,
                        text="Outra.",
                        normalized_text="outra.",
                        tokens=[WordToken(t="Outra", n="outra", i=4), PunctToken(p=".")],
                    ),
                ]
            )
        ],
    )

    context = find_phrase_context(content, "mão bem-estar")

    assert context is not None
    assert context.segment_id == first_id
    assert context.token_ordinal == 0
    assert context.sentence_text == "Mão, bem-estar."
    assert find_phrase_context(content, "bem-estar outra") is None


async def _make_lesson(session: AsyncSession, user_id: uuid.UUID, word_count: int) -> Lesson:
    lesson = Lesson(
        owner_user_id=user_id,
        language_code="pt",
        title=f"{word_count} words",
        raw_text=" ".join(f"word{index}" for index in range(word_count)),
        status="processing",
    )
    session.add(lesson)
    await session.flush()
    await process_lesson_import(session, lesson.id)
    return lesson


async def _counts(session: AsyncSession, user_id: uuid.UUID) -> tuple[int, int, int, int]:
    token_count = await session.scalar(
        select(func.count()).select_from(TokenItem).where(TokenItem.user_id == user_id)
    )
    phrase_count = await session.scalar(
        select(func.count()).select_from(PhraseItem).where(PhraseItem.user_id == user_id)
    )
    translation_count = await session.scalar(
        select(func.count())
        .select_from(PersonalTranslation)
        .where(PersonalTranslation.owner_user_id == user_id)
    )
    review_count = await session.scalar(
        select(func.count()).select_from(ReviewItem).where(ReviewItem.user_id == user_id)
    )
    return (
        token_count or 0,
        phrase_count or 0,
        translation_count or 0,
        review_count or 0,
    )


async def test_snapshot_query_count_is_constant_and_has_no_side_effects(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await UserRepo(db_session).create(
        email=f"{uuid.uuid4()}@example.com",
        password_hash=hash_password("abcdefghij"),
        display_name="T",
    )
    ten_words = await _make_lesson(db_session, user.id, 10)
    thousand_words = await _make_lesson(db_session, user.id, 1000)
    before = await _counts(db_session, user.id)

    async def forbidden_call(*_args: object, **_kwargs: object) -> object:
        pytest.fail("snapshot called an external AI or dictionary service")

    monkeypatch.setattr(ai_service, "translate_hints", forbidden_call)
    monkeypatch.setattr(ai_service, "translate_sentence", forbidden_call)
    monkeypatch.setattr(WiktionaryLocalProvider, "lookup", forbidden_call)

    selects: list[int] = []
    current_count = 0

    def count_select(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal current_count
        if statement.lstrip().upper().startswith("SELECT"):
            current_count += 1

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", count_select)
    try:
        for lesson in (ten_words, thousand_words):
            current_count = 0
            snapshot = await build_lesson_vocabulary(
                db_session,
                lesson=lesson,
                user_id=user.id,
                target="ru",
            )
            assert len(snapshot.items) == lesson.word_count
            selects.append(current_count)
    finally:
        event.remove(engine, "before_cursor_execute", count_select)

    assert selects == [5, 5]
    assert await _counts(db_session, user.id) == before
