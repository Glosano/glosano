"""SRS review service (FLQ-7). Session-first module functions.

Lifecycle-инвариант (domain model §10.1): tracked item ⇔ активный review_item.
sync_review_item/deactivate_review_items вызываются из write-путей vocabulary
ДО их commit — сами не коммитят.
"""

from __future__ import annotations

import random
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, func, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.config import get_settings
from flinq.modules.identity.models import UserSettings
from flinq.modules.lesson_library.models import Lesson, LessonSegment
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.sm2 import INITIAL_STATE, apply_answer, state_from_json, state_to_json
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
NEW_SESSION_LIMIT = 20
PRACTICE_SESSION_LIMIT = 5

VOCAB_MODEL_BY_KIND: dict[str, type[TokenItem] | type[PhraseItem]] = {
    "token": TokenItem,
    "phrase": PhraseItem,
}


class LessonNotFound(Exception):  # noqa: N818 -- matches vocabulary exception naming
    """Lesson does not exist or is not owned by the user."""


def _lesson_scope(
    model: type[TokenItem] | type[PhraseItem], lesson: Lesson
) -> list[ColumnElement[bool]]:
    """Единый предикат скоупа урока — используется очередью (все режимы) и
    счётчиками, чтобы число на плитке и размер сессии совпадали. Дополнительно
    сверяем язык записи относительно языка урока: defense-in-depth на случай
    рассинхрона данных (write-путь такое запрещает, но старые/битые записи не
    должны всплывать)."""
    return [
        model.created_from_lesson_id == lesson.id,
        model.language_code == lesson.language_code,
    ]


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


@dataclass
class CountsInfo:
    due: int
    new: int
    practice: int
    ai_enabled: bool


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
    ref_set = set(refs)
    translations: dict[tuple[str, uuid.UUID], str] = {}
    notes: dict[tuple[str, uuid.UUID], str] = {}
    if refs:
        t_rows = (
            await session.execute(
                select(PersonalTranslation).where(
                    PersonalTranslation.owner_user_id == user_id,
                    PersonalTranslation.is_primary.is_(True),
                    tuple_(PersonalTranslation.item_kind, PersonalTranslation.item_id).in_(refs),
                )
            )
        ).scalars()
        for t in t_rows:
            key = (t.item_kind, t.item_id)
            if key not in ref_set:
                continue
            # предпочесть перевод на preferred_translation_language_code
            if key not in translations or t.target_language_code == preferred_target:
                translations[key] = t.translation_text
        n_rows = (
            await session.execute(
                select(PersonalNote).where(
                    PersonalNote.owner_user_id == user_id,
                    tuple_(PersonalNote.item_kind, PersonalNote.item_id).in_(refs),
                )
            )
        ).scalars()
        for n in n_rows:
            if (n.item_kind, n.item_id) in ref_set:
                notes[(n.item_kind, n.item_id)] = n.note_text

    # Контекст: created_from_segment_id -> lesson_segments.text (слова и фразы)
    seg_by_key: dict[tuple[str, uuid.UUID], uuid.UUID] = {
        (ri.item_kind, item.id): item.created_from_segment_id
        for ri, item in rows
        if item.created_from_segment_id is not None
    }
    contexts: dict[uuid.UUID, str] = {}
    if seg_by_key:
        ctx_rows = await session.execute(
            select(LessonSegment.id, LessonSegment.text).where(
                LessonSegment.id.in_(set(seg_by_key.values()))
            )
        )
        for seg_id, seg_text in ctx_rows.all():
            contexts[seg_id] = seg_text

    out: list[QueueItem] = []
    for ri, item in rows:
        key = (ri.item_kind, ri.item_id)
        text_value = item.token_text if isinstance(item, TokenItem) else item.display_text
        seg_id = seg_by_key.get(key)
        out.append(
            QueueItem(
                review_item_id=ri.id,
                item_kind=ri.item_kind,
                item_id=ri.item_id,
                text=text_value,
                confidence=item.confidence if item.confidence is not None else 0,
                translation=translations.get(key),
                notes=notes.get(key),
                context_sentence=contexts.get(seg_id) if seg_id else None,
            )
        )
    return out


async def get_queue(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: str,
    mode: str = "due",
    lesson_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> tuple[list[QueueItem], DailyInfo]:
    now = now or datetime.now(UTC)
    daily = await _daily_info(session, user_id=user_id, now=now)

    lesson: Lesson | None = None
    if lesson_id is not None:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFound(str(lesson_id))

    def _mode_stmt(kind: str, model: type[TokenItem] | type[PhraseItem]):
        stmt = (
            select(ReviewItem, model)
            .join(model, ReviewItem.item_id == model.id)
            .where(
                ReviewItem.user_id == user_id,
                ReviewItem.item_kind == kind,
                ReviewItem.language_code == language_code,
                ReviewItem.is_active.is_(True),
                model.status == "tracked",
            )
        )
        if lesson is not None:
            stmt = stmt.where(*_lesson_scope(model, lesson))
        return stmt

    if mode == "new":
        # мягкий лимит: в скоупе урока mini-review не блокируется дневным
        # лимитом — так же, как due/practice-режимы урока.
        if lesson_id is not None:
            fetch = NEW_SESSION_LIMIT
        else:
            if daily.limit_reached:
                return [], daily
            fetch = min(NEW_SESSION_LIMIT, max(0, daily.limit - daily.done_today))
        pairs: list[tuple[ReviewItem, TokenItem | PhraseItem]] = []
        for kind, model in VOCAB_MODEL_BY_KIND.items():
            stmt = (
                _mode_stmt(kind, model)
                .where(ReviewItem.last_reviewed_at.is_(None))
                .order_by(ReviewItem.created_at.desc())
                .limit(fetch)
            )
            pairs.extend((ri, it) for ri, it in (await session.execute(stmt)).all())
        pairs.sort(key=lambda p: p[0].created_at, reverse=True)
        pairs = pairs[:fetch]
        if lesson_id is not None:
            daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily

    if mode == "practice":
        pairs: list[tuple[ReviewItem, TokenItem | PhraseItem]] = []
        for kind, model in VOCAB_MODEL_BY_KIND.items():
            stmt = (
                _mode_stmt(kind, model)
                .where(model.confidence >= 4)
                .order_by(func.random())
                .limit(PRACTICE_SESSION_LIMIT)
            )
            pairs.extend((ri, it) for ri, it in (await session.execute(stmt)).all())
        random.shuffle(pairs)
        pairs = pairs[:PRACTICE_SESSION_LIMIT]
        daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily

    # mode == "due" (по умолчанию)
    if lesson_id is not None:
        assert lesson is not None
        pairs: list[tuple[ReviewItem, TokenItem | PhraseItem]] = []
        for kind, model in VOCAB_MODEL_BY_KIND.items():
            stmt = _mode_stmt(kind, model)
            pairs.extend((ri, it) for ri, it in (await session.execute(stmt)).all())
        # due первыми, внутри групп — по due_at
        pairs.sort(key=lambda p: (p[0].due_at > now, p[0].due_at))
        # мягкий лимит: lesson-режим не блокируется
        daily = DailyInfo(limit=daily.limit, done_today=daily.done_today, limit_reached=False)
        return await _build_queue_items(session, user_id=user_id, rows=pairs), daily

    if daily.limit_reached:
        return [], daily

    # remaining/MAX_QUEUE_SIZE bound each query in SQL — the Python merge below
    # only sorts+slices two already-bounded, already-sorted lists, so it stays correct.
    remaining = max(0, daily.limit - daily.done_today)
    fetch_limit = min(remaining, MAX_QUEUE_SIZE)

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
            .order_by(ReviewItem.due_at.asc())
            .limit(fetch_limit)
        )

    token_result = await session.execute(_due_stmt("token", TokenItem))
    phrase_result = await session.execute(_due_stmt("phrase", PhraseItem))
    token_pairs = [(ri, it) for ri, it in token_result.all()]
    phrase_pairs = [(ri, it) for ri, it in phrase_result.all()]
    pairs = sorted(token_pairs + phrase_pairs, key=lambda p: p[0].due_at)
    pairs = pairs[:fetch_limit]
    return await _build_queue_items(session, user_id=user_id, rows=pairs), daily


class ReviewItemNotFound(Exception):  # noqa: N818 -- matches vocabulary exception naming
    """Review item does not exist, is inactive, or is not owned by the user."""


@dataclass
class AnswerResult:
    new_confidence: int | None
    new_status: str
    due_at: datetime
    done_today: int


async def answer(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    review_item_id: uuid.UUID,
    quality: int,
    now: datetime | None = None,
) -> AnswerResult:
    now = now or datetime.now(UTC)
    ri = await session.get(ReviewItem, review_item_id)
    if ri is None or ri.user_id != user_id or not ri.is_active:
        raise ReviewItemNotFound(str(review_item_id))
    item = await session.get(VOCAB_MODEL_BY_KIND[ri.item_kind], ri.item_id)
    if item is None or item.user_id != user_id or item.status != "tracked":
        raise ReviewItemNotFound(str(review_item_id))

    prev_confidence = item.confidence if item.confidence is not None else 0
    prev_due = ri.due_at

    new_state, due_at = apply_answer(
        state_from_json(ri.algorithm_state_json), quality=quality, now=now
    )
    ri.algorithm_state_json = state_to_json(new_state)
    ri.due_at = due_at
    ri.last_reviewed_at = now

    new_confidence: int | None
    if quality >= 4 and prev_confidence >= 5:
        # Graduation (spec §3): q>=4 при confidence 5 -> known, review закрывается.
        item.status = "known"
        item.confidence = None
        ri.is_active = False
        new_confidence = None
        new_status = "known"
    else:
        if quality >= 4:
            new_confidence = min(5, prev_confidence + 1)
        elif quality == 3:
            new_confidence = prev_confidence
        else:
            new_confidence = max(0, prev_confidence - 1)
        item.confidence = new_confidence
        new_status = "tracked"

    session.add(
        ReviewEvent(
            review_item_id=ri.id,
            user_id=user_id,
            answer_value="correct" if quality >= 3 else "wrong",
            quality=quality,
            previous_confidence=prev_confidence,
            new_confidence=new_confidence,
            previous_due_at=prev_due,
            new_due_at=due_at,
            reviewed_at=now,
        )
    )
    await session.commit()
    daily = await _daily_info(session, user_id=user_id, now=now)
    return AnswerResult(
        new_confidence=new_confidence,
        new_status=new_status,
        due_at=due_at,
        done_today=daily.done_today,
    )


async def get_counts(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: str,
    lesson_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> CountsInfo:
    now = now or datetime.now(UTC)

    lesson: Lesson | None = None
    if lesson_id is not None:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFound(str(lesson_id))

    async def _count(
        extra_where: Callable[[type[TokenItem] | type[PhraseItem]], list[ColumnElement[bool]]],
    ) -> int:
        total = 0
        for kind, model in VOCAB_MODEL_BY_KIND.items():
            lesson_where = _lesson_scope(model, lesson) if lesson is not None else []
            stmt = (
                select(func.count())
                .select_from(ReviewItem)
                .join(model, ReviewItem.item_id == model.id)
                .where(
                    ReviewItem.user_id == user_id,
                    ReviewItem.item_kind == kind,
                    ReviewItem.language_code == language_code,
                    ReviewItem.is_active.is_(True),
                    model.status == "tracked",
                    *extra_where(model),
                    *lesson_where,
                )
            )
            total += (await session.execute(stmt)).scalar_one()
        return total

    # Внутри скоупа урока due-счётчик не фильтрует по due_at — зеркалит
    # lesson-ветку get_queue (FLQ-7: повторение урока = все слова урока,
    # due первыми), иначе число на плитке и размер сессии расходятся.
    # Вне скоупа урока — как раньше.
    due_extra = [] if lesson is not None else [ReviewItem.due_at <= now]
    due = await _count(lambda m: due_extra)
    new = await _count(lambda m: [ReviewItem.last_reviewed_at.is_(None)])
    practice = await _count(lambda m: [m.confidence >= 4])
    return CountsInfo(due=due, new=new, practice=practice, ai_enabled=get_settings().llm_enabled)
