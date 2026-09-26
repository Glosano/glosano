"""Bulk-known + undo (spec ADR-0005): mark new words in an ordinal range known.

Only words with NO existing TokenItem for the user get a `known` row —
`tracked`/`known`/`ignored` items are left untouched. The insert uses
client-side UUIDs with `ON CONFLICT DO NOTHING` + `RETURNING` so the action
payload lists only the ids genuinely created here, which is exactly what
undo needs to reverse the action without touching anything else.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.lesson_library.models import Lesson, LessonTokenOccurrence
from glosano.modules.reader_state.activity import touch_lesson_activity
from glosano.modules.reader_state.models import BulkAction, ReaderPosition
from glosano.modules.statistics.service import record_reading
from glosano.modules.vocabulary.models import TokenItem


class ActionNotFound(Exception): ...  # noqa: N818 — mapped to 404 by the router


class ActionAlreadyUndone(Exception): ...  # noqa: N818 — mapped to 409 by the router


async def bulk_mark_known(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    lesson: Lesson,
    from_ordinal: int,
    to_ordinal: int,
    commit: bool = True,
    request_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, int]:
    # Перелистывание и завершение (которое тоже идёт через bulk_mark_known) —
    # это работа с материалом (FLQ-36). Строка reader_positions блокируется
    # первой, до статистики и слов: complete_lesson берёт её FOR UPDATE раньше
    # остального, и одинаковый порядок блокировок исключает взаимоблокировку.
    await touch_lesson_activity(session, user_id=user_id, lesson_id=lesson.id)
    await record_reading(
        session, user_id=user_id, lesson=lesson, from_ordinal=from_ordinal, to_ordinal=to_ordinal
    )
    texts = set(
        await session.scalars(
            select(LessonTokenOccurrence.normalized_text)
            .distinct()
            .where(
                LessonTokenOccurrence.lesson_id == lesson.id,
                LessonTokenOccurrence.is_word_like.is_(True),
                LessonTokenOccurrence.ordinal_in_lesson.between(from_ordinal, to_ordinal),
            )
        )
    )
    if texts:
        # created_from_lesson_id тут не проставляется (решение человека, FLQ-21):
        # bulk-known срабатывает автоматически на каждом перелистывании
        # страницы, поэтому провенанс урока занял бы почти весь словарь урока
        # просто от чтения, при этом _apply_provenance не перезаписывает
        # непустой провенанс — то же слово, встреченное позже в другом уроке
        # и взятое в работу, не смогло бы попасть в очередь этого урока.
        stmt = (
            pg_insert(TokenItem)
            .values(
                [
                    {
                        "id": uuid.uuid4(),
                        "user_id": user_id,
                        "language_code": lesson.language_code,
                        "token_text": t,
                        "status": "known",
                        "confidence": None,
                        "added_by": "bulk",
                    }
                    for t in sorted(texts)
                ]
            )
            .on_conflict_do_nothing(constraint="uq_token_items_user_lang_text")
            .returning(TokenItem.id)
        )
        created_ids = list((await session.execute(stmt)).scalars().all())
    else:
        created_ids = []

    action = BulkAction(
        user_id=user_id,
        lesson_id=lesson.id,
        action_type="bulk_known",
        request_id=request_id,
        source_version=lesson.current_source_version,
        page_fingerprint=f"{from_ordinal}:{to_ordinal}",
        payload_json={"token_item_ids": [str(i) for i in created_ids]},
    )
    session.add(action)
    await session.flush()
    if commit:
        await session.commit()
    return action.id, len(created_ids)


async def undo_bulk_action(
    session: AsyncSession, *, user_id: uuid.UUID, action_id: uuid.UUID
) -> int:
    lesson_id = await session.scalar(
        select(BulkAction.lesson_id).where(
            BulkAction.id == action_id, BulkAction.user_id == user_id
        )
    )
    if lesson_id is None:
        raise ActionNotFound
    # Same lock order as content editing: lesson before its reader state/actions.
    await session.execute(
        select(Lesson.id).where(Lesson.id == lesson_id).with_for_update(read=True)
    )
    action = await session.scalar(
        select(BulkAction)
        .where(BulkAction.id == action_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if action is None or action.user_id != user_id:
        raise ActionNotFound
    if action.payload_json.get("invalidated"):
        raise ActionNotFound
    if action.undone_at is not None:
        raise ActionAlreadyUndone
    await session.execute(
        update(ReaderPosition)
        .where(ReaderPosition.user_id == user_id, ReaderPosition.completion_action_id == action_id)
        .values(completed_at=None, completion_action_id=None)
    )
    ids = [uuid.UUID(x) for x in action.payload_json.get("token_item_ids", [])]
    undone = 0
    if ids:
        result = await session.execute(
            delete(TokenItem)
            .where(
                TokenItem.id.in_(ids),
                TokenItem.status == "known",
                TokenItem.added_by == "bulk",
            )
            .returning(TokenItem.id)
        )
        undone = len(list(result.scalars().all()))
    action.undone_at = func.now()
    await session.commit()
    return undone


async def invalidate_bulk_actions(session: AsyncSession, lesson_id: uuid.UUID) -> None:
    """Reset Undo but retain request identity across source revisions."""
    await session.execute(
        delete(BulkAction).where(BulkAction.lesson_id == lesson_id, BulkAction.request_id.is_(None))
    )
    await session.execute(
        update(BulkAction)
        .where(BulkAction.lesson_id == lesson_id)
        .values(payload_json=BulkAction.payload_json.op("||")({"invalidated": True}))
    )
