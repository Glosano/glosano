"""Build a user's read-only vocabulary snapshot for one lesson."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Literal, cast

from sqlalchemy import Text, and_, any_, bindparam, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.modules.lesson_library.models import Lesson
from flinq.modules.reader_state.content import build_lesson_content
from flinq.modules.reader_state.schemas import (
    LessonContentResponse,
    LessonVocabularyContext,
    LessonVocabularyItem,
    LessonVocabularyResponse,
    SentenceOut,
    WordToken,
)
from flinq.modules.vocabulary.models import PersonalTranslation, PhraseItem, TokenItem
from flinq.modules.vocabulary.schemas import PrimaryTranslationOut

StoredStatus = Literal["tracked", "known", "ignored"]


def _sentences(content: LessonContentResponse) -> Iterator[SentenceOut]:
    for paragraph in content.paragraphs:
        yield from paragraph.sentences


def _words(sentence: SentenceOut) -> list[WordToken]:
    return [token for token in sentence.tokens if isinstance(token, WordToken)]


def _matches_at(words: list[WordToken], start: int, phrase_words: tuple[str, ...]) -> bool:
    end = start + len(phrase_words)
    return end <= len(words) and tuple(word.n for word in words[start:end]) == phrase_words


def _context(sentence: SentenceOut, token: WordToken) -> LessonVocabularyContext:
    return LessonVocabularyContext(
        segment_id=sentence.seg_id,
        token_ordinal=token.i,
        sentence_text=sentence.text,
    )


def find_phrase_context(
    content: LessonContentResponse,
    phrase_text: str,
) -> LessonVocabularyContext | None:
    """Find the first same-sentence match for an already normalized phrase."""
    phrase_words = tuple(phrase_text.split(" "))
    if not phrase_text or any(not word for word in phrase_words):
        return None
    for sentence in _sentences(content):
        words = _words(sentence)
        for start, word in enumerate(words):
            if _matches_at(words, start, phrase_words):
                return _context(sentence, word)
    return None


async def build_lesson_vocabulary(
    session: AsyncSession,
    *,
    lesson: Lesson,
    user_id: uuid.UUID,
    target: str,
) -> LessonVocabularyResponse:
    """Return unique lesson words enriched with the user's stored state."""
    content = await build_lesson_content(session, lesson)
    first_context: dict[str, tuple[str, LessonVocabularyContext]] = {}
    for paragraph in content.paragraphs:
        for sentence in paragraph.sentences:
            for token in sentence.tokens:
                if isinstance(token, WordToken):
                    first_context.setdefault(
                        token.n,
                        (
                            token.t,
                            _context(sentence, token),
                        ),
                    )

    lesson_words = bindparam(
        "lesson_words",
        value=list(first_context),
        type_=ARRAY(Text),
    )
    token_items = list(
        (
            await session.scalars(
                select(TokenItem).where(
                    TokenItem.user_id == user_id,
                    TokenItem.language_code == lesson.language_code,
                    or_(
                        TokenItem.token_text == any_(lesson_words),
                        TokenItem.created_from_lesson_id == lesson.id,
                    ),
                )
            )
        ).all()
    )
    by_text = {item.token_text: item for item in token_items}

    phrase_items = list(
        (
            await session.scalars(
                select(PhraseItem)
                .where(
                    PhraseItem.user_id == user_id,
                    PhraseItem.language_code == lesson.language_code,
                )
                .order_by(PhraseItem.created_at, PhraseItem.id)
            )
        ).all()
    )
    phrases_by_first: dict[str, list[tuple[PhraseItem, tuple[str, ...]]]] = {}
    for phrase in phrase_items:
        phrase_words = tuple(phrase.phrase_text.split(" "))
        if phrase_words:
            phrases_by_first.setdefault(phrase_words[0], []).append((phrase, phrase_words))

    phrase_contexts: dict[uuid.UUID, LessonVocabularyContext] = {}
    for sentence in _sentences(content):
        words = _words(sentence)
        for start, word in enumerate(words):
            for phrase, phrase_words in phrases_by_first.get(word.n, []):
                if phrase.id not in phrase_contexts and _matches_at(words, start, phrase_words):
                    phrase_contexts[phrase.id] = _context(sentence, word)

    included_phrases = [
        phrase
        for phrase in phrase_items
        if phrase.id in phrase_contexts or phrase.created_from_lesson_id == lesson.id
    ]
    token_ids = bindparam(
        "token_ids",
        value=[item.id for item in token_items],
        type_=ARRAY(PGUUID(as_uuid=True)),
    )
    phrase_ids = bindparam(
        "phrase_ids",
        value=[item.id for item in included_phrases],
        type_=ARRAY(PGUUID(as_uuid=True)),
    )
    translations = list(
        (
            await session.scalars(
                select(PersonalTranslation).where(
                    PersonalTranslation.owner_user_id == user_id,
                    PersonalTranslation.target_language_code == target,
                    PersonalTranslation.is_primary.is_(True),
                    or_(
                        and_(
                            PersonalTranslation.item_kind == "token",
                            PersonalTranslation.item_id == any_(token_ids),
                        ),
                        and_(
                            PersonalTranslation.item_kind == "phrase",
                            PersonalTranslation.item_id == any_(phrase_ids),
                        ),
                    ),
                )
            )
        ).all()
    )
    translation_by_item = {(row.item_kind, row.item_id): row for row in translations}

    items: list[LessonVocabularyItem] = []
    for text, (display_text, context) in first_context.items():
        item = by_text.get(text)
        items.append(
            LessonVocabularyItem(
                kind="token",
                item_id=item.id if item else None,
                text=text,
                display_text=display_text,
                status=cast("StoredStatus", item.status) if item else "new",
                confidence=item.confidence if item else None,
                primary_translation=(
                    PrimaryTranslationOut(
                        text=translation_by_item[("token", item.id)].translation_text,
                        target_language_code=target,
                    )
                    if item and ("token", item.id) in translation_by_item
                    else None
                ),
                added_here=bool(item and item.created_from_lesson_id == lesson.id),
                context=context,
            )
        )

    for item in token_items:
        if item.token_text in first_context:
            continue
        translation = translation_by_item.get(("token", item.id))
        items.append(
            LessonVocabularyItem(
                kind="token",
                item_id=item.id,
                text=item.token_text,
                display_text=item.token_text,
                status=cast("StoredStatus", item.status),
                confidence=item.confidence,
                primary_translation=(
                    PrimaryTranslationOut(
                        text=translation.translation_text,
                        target_language_code=target,
                    )
                    if translation
                    else None
                ),
                added_here=True,
                context=None,
            )
        )

    for item in included_phrases:
        translation = translation_by_item.get(("phrase", item.id))
        items.append(
            LessonVocabularyItem(
                kind="phrase",
                item_id=item.id,
                text=item.phrase_text,
                display_text=item.display_text,
                status=cast("StoredStatus", item.status),
                confidence=item.confidence,
                primary_translation=(
                    PrimaryTranslationOut(
                        text=translation.translation_text,
                        target_language_code=target,
                    )
                    if translation
                    else None
                ),
                added_here=item.created_from_lesson_id == lesson.id,
                context=phrase_contexts.get(item.id),
            )
        )

    return LessonVocabularyResponse(
        lesson_id=lesson.id,
        language_code=lesson.language_code,
        items=items,
    )
