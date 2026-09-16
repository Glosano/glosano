"""Immutable completion metrics; vocabulary is sampled before the final bulk action."""

import uuid
from datetime import datetime

from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.lesson_library.models import Lesson, LessonTokenOccurrence
from glosano.modules.reader_state.models import BulkAction, ReaderPosition
from glosano.modules.reader_state.schemas import CompleteLessonResponse, CompletionSummary
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


async def snapshot_vocabulary(
    session: AsyncSession, *, user_id: uuid.UUID, lesson: Lesson
) -> CompletionSummary:
    occ = LessonTokenOccurrence

    # Provenance is assigned only when explicitly taken into study (FLQ-21),
    # including a formerly bulk-created known item. Its current status may differ.
    def added_count(model: type[TokenItem] | type[PhraseItem]):
        return (
            select(func.count())
            .select_from(model)
            .where(model.user_id == user_id, model.created_from_lesson_id == lesson.id)
            .scalar_subquery()
        )

    row = (
        (
            await session.execute(
                select(
                    func.count(occ.id).label("total_words"),
                    func.count(distinct(occ.normalized_text)).label("unique_words"),
                    func.count(distinct(occ.normalized_text))
                    .filter(TokenItem.status == "known")
                    .label("known_words"),
                    func.count(distinct(occ.normalized_text))
                    .filter(TokenItem.id.is_(None))
                    .label("new_words"),
                    func.count(distinct(occ.normalized_text))
                    .filter(TokenItem.status == "tracked")
                    .label("tracked_words"),
                    func.count(distinct(occ.normalized_text))
                    .filter(TokenItem.status == "ignored")
                    .label("ignored_words"),
                    added_count(TokenItem).label("added_words"),
                    added_count(PhraseItem).label("added_phrases"),
                )
                .select_from(occ)
                .outerjoin(
                    TokenItem,
                    and_(
                        TokenItem.user_id == user_id,
                        TokenItem.language_code == lesson.language_code,
                        TokenItem.token_text == occ.normalized_text,
                    ),
                )
                .where(occ.lesson_id == lesson.id, occ.is_word_like.is_(True))
            )
        )
        .mappings()
        .one()
    )
    return CompletionSummary(**dict(row), reading_days=0, marked_known_words=0)


def completion_response(action: BulkAction, completed_at: datetime) -> CompleteLessonResponse:
    return CompleteLessonResponse(
        action_id=action.id,
        created_count=len(action.payload_json.get("token_item_ids", [])),
        completed_at=completed_at,
        summary=action.payload_json.get("completion_summary"),
    )


async def get_completion_summary(
    session: AsyncSession, *, user_id: uuid.UUID, lesson_id: uuid.UUID
) -> CompleteLessonResponse | None:
    row = (
        await session.execute(
            select(BulkAction, ReaderPosition.completed_at)
            .join(ReaderPosition, ReaderPosition.completion_action_id == BulkAction.id)
            .where(
                ReaderPosition.user_id == user_id,
                ReaderPosition.lesson_id == lesson_id,
                ReaderPosition.completed_at.is_not(None),
                BulkAction.user_id == user_id,
                BulkAction.lesson_id == lesson_id,
                BulkAction.undone_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    action, completed_at = row
    return completion_response(action, completed_at)
