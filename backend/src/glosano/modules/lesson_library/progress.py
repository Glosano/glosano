"""Прогресс чтения урока для карточки библиотеки (FLQ-8a).

Позиция и остаток новых слов считаются на лету. «Новое слово» — это
отсутствие TokenItem у пары (user, language, token_text), то есть факт,
общий для всех уроков языка: денормализованный счётчик на урок пришлось бы
инвалидировать веером при каждом изменении статуса слова. Обоснование —
docs/superpowers/specs/2026-07-25-library-reading-progress-design.md §3.4.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.lesson_library.models import Lesson, LessonTokenOccurrence
from glosano.modules.reader_state.models import ReaderPosition
from glosano.modules.vocabulary.models import TokenItem


@dataclass(frozen=True)
class LessonProgress:
    read_percent: int
    new_words_remaining: int
    completed_at: datetime | None = None
    last_activity_at: datetime | None = None


#: Урок, по которому агрегат не вернул строки (в тексте нет word-like токенов).
ZERO_PROGRESS = LessonProgress(read_percent=0, new_words_remaining=0)


def read_percent(position: int | None, max_ordinal: int | None) -> int:
    """Доля прочитанного, 0..100.

    Зеркало бара ридера (frontend/src/features/reader/ReaderPage.tsx:133-137):
    нет позиции или в уроке нет слов -> 0; урок из одного слова -> 100.
    """
    if position is None or max_ordinal is None:
        return 0
    if max_ordinal == 0:
        return 100
    # Use math.floor(x + 0.5) for round-half-up to match JS Math.round() semantics.
    # Python's round() uses round-half-to-even (banker's rounding), which would diverge
    # from the reader bar for exact .5 percentages (e.g. position=1, max_ordinal=8 → 12.5%).
    percent = math.floor(position / max_ordinal * 100 + 0.5)
    return max(0, min(100, percent))


async def progress_for_lessons(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    lang: str,
    lesson_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, LessonProgress]:
    """Прогресс по странице списка уроков — один агрегат на всю страницу.

    Ни один из LEFT JOIN не размножает строки: reader_positions уникален по
    (user_id, lesson_id), token_items — по (user_id, language_code,
    token_text). Поэтому MAX(rp.current_token_ordinal) — это способ протащить
    позицию через GROUP BY, а COUNT(DISTINCT ...) считает ровно то, что
    заявлено. LEFT JOIN от lessons сохраняет завершение материалов без слов.
    Подтверждённое завершение имеет приоритет над текущей позицией перечитывания.

    Инвариант, которым эта функция не владеет, но на который полагается:
    `token_items` соединяется по единому `lang`, а не по `language_code`
    каждого урока — это безопасно только потому, что вызывающий
    (`LessonRepo.list_continue` / `list_history_days`) уже отфильтровал
    `lesson_ids` по `Lesson.language_code == lang`. Если это перестанет быть
    так, счётчик новых слов начнёт смешивать словарь пользователя по разным
    языкам.
    """
    if not lesson_ids:
        return {}

    occ = LessonTokenOccurrence
    stmt = (
        select(
            Lesson.id,
            func.max(occ.ordinal_in_lesson),
            func.max(ReaderPosition.current_token_ordinal),
            func.max(ReaderPosition.completed_at),
            func.max(ReaderPosition.last_activity_at),
            func.count(distinct(occ.normalized_text)).filter(
                TokenItem.id.is_(None),
                occ.normalized_text != "",
                occ.ordinal_in_lesson > func.coalesce(ReaderPosition.current_token_ordinal, -1),
            ),
        )
        .select_from(Lesson)
        .outerjoin(occ, and_(occ.lesson_id == Lesson.id, occ.is_word_like.is_(True)))
        .outerjoin(
            ReaderPosition,
            and_(
                ReaderPosition.lesson_id == Lesson.id,
                ReaderPosition.user_id == user_id,
            ),
        )
        .outerjoin(
            TokenItem,
            and_(
                TokenItem.user_id == user_id,
                TokenItem.language_code == lang,
                TokenItem.token_text == occ.normalized_text,
            ),
        )
        .where(Lesson.id.in_(lesson_ids))
        .group_by(Lesson.id)
    )

    rows = (await session.execute(stmt)).all()
    return {
        lesson_id: LessonProgress(
            read_percent=100 if completed_at else read_percent(position, max_ordinal),
            completed_at=completed_at,
            last_activity_at=last_activity_at,
            new_words_remaining=new_remaining,
        )
        for lesson_id, max_ordinal, position, completed_at, last_activity_at, new_remaining in rows
    }
