"""SRS review service (FLQ-7). Session-first module functions.

Lifecycle-инвариант (domain model §10.1): tracked item ⇔ активный review_item.
sync_review_item/deactivate_review_items вызываются из write-путей vocabulary
ДО их commit — сами не коммитят.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.modules.identity.models import UserSettings
from flinq.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.sm2 import INITIAL_STATE, state_to_json
from flinq.modules.vocabulary.models import PersonalNote, PersonalTranslation, PhraseItem, TokenItem


async def sync_review_item(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    item_kind: str,
    item_id: uuid.UUID,
    language_code: str,
    status: str,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(UTC)
    existing = (
        (
            await session.execute(
                select(ReviewItem).where(
                    ReviewItem.user_id == user_id,
                    ReviewItem.item_kind == item_kind,
                    ReviewItem.item_id == item_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if status == "tracked":
        if existing is None:
            session.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind=item_kind,
                    item_id=item_id,
                    language_code=language_code,
                    is_active=True,
                    algorithm_state_json=state_to_json(INITIAL_STATE),
                    due_at=now,
                )
            )
        elif not existing.is_active:
            # Реактивация (known/ignored -> tracked): свежая траектория (spec §3).
            existing.is_active = True
            existing.algorithm_state_json = state_to_json(INITIAL_STATE)
            existing.due_at = now
        # Уже активный: ручная смена confidence SRS state не трогает.
    elif existing is not None and existing.is_active:
        existing.is_active = False


async def deactivate_review_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    item_kind: str,
    item_ids: list[uuid.UUID],
) -> None:
    await session.execute(
        update(ReviewItem)
        .where(
            ReviewItem.user_id == user_id,
            ReviewItem.item_kind == item_kind,
            ReviewItem.item_id.in_(item_ids),
            ReviewItem.is_active.is_(True),
        )
        .values(is_active=False)
    )


MAX_QUEUE_SIZE = 100
DEFAULT_DAILY_LIMIT = 20


class LessonNotFound(Exception):  # noqa: N818 -- matches vocabulary exception naming
    """Lesson does not exist or is not owned by the user."""


@dataclass
class QueueItem:
    review_item_id: uuid.UUID
    item_kind: str
    item_id: uuid.UUID
    text: str
    confidence: int
    translation: str | None
    notes: str | None
    context_sentence: str | None


@dataclass
class DailyInfo:
    limit: int
    done_today: int
    limit_reached: bool


def _day_start_utc(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


async def _daily_info(session: AsyncSession, *, user_id: uuid.UUID, now: datetime) -> DailyInfo:
    settings = await session.get(UserSettings, user_id)
    limit = settings.daily_goal_reviews if settings is not None else DEFAULT_DAILY_LIMIT
    done_today = (
        await session.execute(
            select(func.count())
            .select_from(ReviewEvent)
            .where(ReviewEvent.user_id == user_id, ReviewEvent.reviewed_at >= _day_start_utc(now))
        )
    ).scalar_one()
    return DailyInfo(limit=limit, done_today=done_today, limit_reached=done_today >= limit)


async def _build_queue_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    rows: list[tuple[ReviewItem, TokenItem | PhraseItem]],
) -> list[QueueItem]:
    """Обогатить пары (review_item, vocab_item) переводом/заметкой/контекстом."""
    settings = await session.get(UserSettings, user_id)
    preferred_target = settings.preferred_translation_language_code if settings else None

    refs = [(ri.item_kind, ri.item_id) for ri, _ in rows]
    translations: dict[tuple[str, uuid.UUID], str] = {}
    notes: dict[tuple[str, uuid.UUID], str] = {}
    if refs:
        t_rows = (
            await session.execute(
                select(PersonalTranslation).where(
                    PersonalTranslation.owner_user_id == user_id,
                    PersonalTranslation.is_primary.is_(True),
                )
            )
        ).scalars()
        for t in t_rows:
            key = (t.item_kind, t.item_id)
            if key not in refs:
                continue
            # предпочесть перевод на preferred_translation_language_code
            if key not in translations or t.target_language_code == preferred_target:
                translations[key] = t.translation_text
        n_rows = (
            await session.execute(select(PersonalNote).where(PersonalNote.owner_user_id == user_id))
        ).scalars()
        for n in n_rows:
            if (n.item_kind, n.item_id) in refs:
                notes[(n.item_kind, n.item_id)] = n.note_text

    # Контекст токенов: created_from_occurrence_id -> occurrence -> segment.text
    occ_by_key: dict[tuple[str, uuid.UUID], uuid.UUID] = {
        ("token", item.id): item.created_from_occurrence_id
        for _, item in rows
        if isinstance(item, TokenItem) and item.created_from_occurrence_id is not None
    }
    contexts: dict[uuid.UUID, str] = {}
    if occ_by_key:
        ctx_rows = await session.execute(
            select(LessonTokenOccurrence.id, LessonSegment.text)
            .join(LessonSegment, LessonTokenOccurrence.segment_id == LessonSegment.id)
            .where(LessonTokenOccurrence.id.in_(occ_by_key.values()))
        )
        for occ_id, seg_text in ctx_rows.all():
            contexts[occ_id] = seg_text

    out: list[QueueItem] = []
    for ri, item in rows:
        key = (ri.item_kind, ri.item_id)
        text_value = item.token_text if isinstance(item, TokenItem) else item.display_text
        occ_id = occ_by_key.get(key)
        out.append(
            QueueItem(
                review_item_id=ri.id,
                item_kind=ri.item_kind,
                item_id=ri.item_id,
                text=text_value,
                confidence=item.confidence if item.confidence is not None else 0,
                translation=translations.get(key),
                notes=notes.get(key),
                context_sentence=contexts.get(occ_id) if occ_id else None,
            )
        )
    return out


async def get_queue(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: str,
    lesson_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> tuple[list[QueueItem], DailyInfo]:
    now = now or datetime.now(UTC)
    daily = await _daily_info(session, user_id=user_id, now=now)

    if lesson_id is not None:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFound(str(lesson_id))
        stmt = (
            select(ReviewItem, TokenItem)
            .join(TokenItem, ReviewItem.item_id == TokenItem.id)
            .join(
                LessonTokenOccurrence,
                LessonTokenOccurrence.normalized_text == TokenItem.token_text,
            )
            .where(
                LessonTokenOccurrence.lesson_id == lesson_id,
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == "token",
                ReviewItem.is_active.is_(True),
                TokenItem.user_id == user_id,
                TokenItem.language_code == lesson.language_code,
                TokenItem.status == "tracked",
            )
            .distinct()
        )
        pairs = [(ri, item) for ri, item in (await session.execute(stmt)).all()]
        # due первыми, внутри групп — по due_at
        pairs.sort(key=lambda p: (p[0].due_at > now, p[0].due_at))
        # мягкий лимит: lesson-режим не блокируется
        daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily

    if daily.limit_reached:
        return [], daily

    def _due_stmt(kind: str, model: type[TokenItem] | type[PhraseItem]):
        return (
            select(ReviewItem, model)
            .join(model, ReviewItem.item_id == model.id)
            .where(
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == kind,
                ReviewItem.language_code == language_code,
                ReviewItem.is_active.is_(True),
                ReviewItem.due_at <= now,
                model.status == "tracked",
            )
        )

    token_result = await session.execute(_due_stmt("token", TokenItem))
    phrase_result = await session.execute(_due_stmt("phrase", PhraseItem))
    token_pairs = [(ri, it) for ri, it in token_result.all()]
    phrase_pairs = [(ri, it) for ri, it in phrase_result.all()]
    pairs = sorted(token_pairs + phrase_pairs, key=lambda p: p[0].due_at)
    remaining = max(0, daily.limit - daily.done_today)
    pairs = pairs[: min(remaining, MAX_QUEUE_SIZE)]
    return await _build_queue_items(session, user_id=user_id, rows=pairs), daily
