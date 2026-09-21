"""Verified server-text snapshots and safe source navigation."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.chat.models import Citation
from glosano.modules.chat.schemas import CitationRequest, ParagraphCitationRequest
from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from glosano.modules.lesson_library.tokenization import RegexSegmenter


async def readable(s: AsyncSession, uid: uuid.UUID, lid: uuid.UUID) -> Lesson:
    lesson = await s.scalar(
        select(Lesson)
        .where(Lesson.id == lid)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if lesson is None or (lesson.owner_user_id != uid and lesson.visibility != "shared"):
        raise HTTPException(404, "source_unavailable")
    if lesson.status != "ready":
        raise HTTPException(409, "source_not_ready")
    return lesson


def paragraph_snapshot(lesson: Lesson, start: int, end: int) -> tuple[str, int, int]:
    spans = [
        p
        for p in RegexSegmenter(lesson.language_code).split_paragraphs(lesson.raw_text)
        if p.end > start and p.start < end
    ]
    if not spans:
        raise HTTPException(422, "invalid_selection")
    context_start, context_end = spans[0].start, spans[-1].end
    surrounding = lesson.raw_text[context_start:context_end]
    if end - start > 4000 or len(surrounding) > 12000:
        raise HTTPException(422, "citation_too_large")
    return surrounding, start - context_start, end - context_start


async def prepare(s: AsyncSession, uid: uuid.UUID, body: CitationRequest) -> Citation:
    lesson = await readable(s, uid, body.lesson_id)
    if lesson.current_source_version != body.source_version:
        raise HTTPException(409, "source_changed")
    tokens = list(
        (
            await s.scalars(
                select(LessonTokenOccurrence)
                .where(
                    LessonTokenOccurrence.lesson_id == lesson.id,
                    LessonTokenOccurrence.ordinal_in_lesson.between(
                        body.from_ordinal, body.to_ordinal
                    ),
                )
                .order_by(LessonTokenOccurrence.ordinal_in_lesson)
            )
        ).all()
    )
    if (
        not tokens
        or tokens[0].ordinal_in_lesson != body.from_ordinal
        or tokens[-1].ordinal_in_lesson != body.to_ordinal
    ):
        raise HTTPException(422, "invalid_selection")
    start, end = tokens[0].start_char_offset, tokens[-1].end_char_offset
    segments = list(
        (
            await s.scalars(
                select(LessonSegment)
                .where(
                    LessonSegment.lesson_id == lesson.id,
                    LessonSegment.end_char_offset > start,
                    LessonSegment.start_char_offset < end,
                )
                .order_by(LessonSegment.ordinal)
            )
        ).all()
    )
    if not segments or not (0 <= start < end <= len(lesson.raw_text)):
        raise HTTPException(422, "invalid_selection")
    selected = lesson.raw_text[start:end]
    surrounding, relative_start, relative_end = paragraph_snapshot(lesson, start, end)
    row = Citation(
        user_id=uid,
        lesson_id=lesson.id,
        source_version=lesson.current_source_version,
        title=lesson.title,
        language_code=lesson.language_code,
        selected_text=selected,
        context_text=surrounding,
        from_ordinal=body.from_ordinal,
        to_ordinal=body.to_ordinal,
        context_start_offset=relative_start,
        context_end_offset=relative_end,
        start_offset=start,
        end_offset=end,
        media_start_ms=segments[0].media_start_ms,
        media_end_ms=segments[-1].media_end_ms,
    )
    s.add(row)
    await s.flush()
    return row


async def prepare_paragraph(
    s: AsyncSession, uid: uuid.UUID, body: ParagraphCitationRequest
) -> Citation:
    lesson = await readable(s, uid, body.lesson_id)
    if lesson.current_source_version != body.source_version:
        raise HTTPException(409, "source_changed")
    segment = await s.scalar(
        select(LessonSegment).where(
            LessonSegment.id == body.segment_id,
            LessonSegment.lesson_id == lesson.id,
            LessonSegment.segment_type == "sentence",
        )
    )
    if segment is None:
        raise HTTPException(404, "segment_not_found")
    paragraph = next(
        (
            p
            for p in RegexSegmenter(lesson.language_code).split_paragraphs(lesson.raw_text)
            if p.start <= segment.start_char_offset and p.end >= segment.end_char_offset
        ),
        None,
    )
    if paragraph is None:
        raise HTTPException(422, "invalid_selection")
    text, _, _ = paragraph_snapshot(lesson, paragraph.start, paragraph.end)
    occurrences = list(
        (
            await s.scalars(
                select(LessonTokenOccurrence)
                .where(
                    LessonTokenOccurrence.lesson_id == lesson.id,
                    LessonTokenOccurrence.start_char_offset >= paragraph.start,
                    LessonTokenOccurrence.end_char_offset <= paragraph.end,
                )
                .order_by(LessonTokenOccurrence.ordinal_in_lesson)
            )
        ).all()
    )
    if not occurrences:
        raise HTTPException(422, "invalid_selection")
    first, last = occurrences[0], occurrences[-1]
    last_segment = await s.get(LessonSegment, last.segment_id)
    first_segment = await s.get(LessonSegment, first.segment_id)
    row = Citation(
        user_id=uid,
        lesson_id=lesson.id,
        source_version=body.source_version,
        title=lesson.title,
        language_code=lesson.language_code,
        selected_text=text,
        context_text=text,
        from_ordinal=first.ordinal_in_lesson,
        to_ordinal=last.ordinal_in_lesson,
        start_offset=paragraph.start,
        end_offset=paragraph.end,
        context_start_offset=0,
        context_end_offset=len(text),
        media_start_ms=first_segment.media_start_ms if first_segment else None,
        media_end_ms=last_segment.media_end_ms if last_segment else None,
    )
    s.add(row)
    await s.flush()
    return row


async def owned(s: AsyncSession, uid: uuid.UUID, ids: list[uuid.UUID]) -> list[Citation]:
    rows: list[Citation] = []
    for ident in dict.fromkeys(ids):
        row = await s.scalar(
            select(Citation).where(
                Citation.id == ident, Citation.user_id == uid, Citation.message_id.is_(None)
            )
        )
        if row is None:
            raise HTTPException(404, "citation_not_found")
        rows.append(row)
    return rows


async def verify_send(s: AsyncSession, uid: uuid.UUID, rows: list[Citation]) -> None:
    # Stable ordering avoids deadlocks when two users cite shared lessons in reverse order.
    for row in sorted(rows, key=lambda r: str(r.lesson_id)):
        if row.lesson_id is None:
            raise HTTPException(409, "source_unavailable")
        lesson = await readable(s, uid, row.lesson_id)
        if (
            lesson.current_source_version != row.source_version
            or lesson.raw_text[row.start_offset : row.end_offset] != row.selected_text
        ):
            raise HTTPException(409, "source_changed")
        # Upgrade legacy unsent sentence citations; sent snapshots remain immutable.
        row.context_text, row.context_start_offset, row.context_end_offset = paragraph_snapshot(
            lesson, row.start_offset, row.end_offset
        )


async def output(s: AsyncSession, uid: uuid.UUID, row: Citation) -> dict[str, Any]:
    lesson = await s.get(Lesson, row.lesson_id) if row.lesson_id else None
    available = (
        lesson is not None
        and lesson.status == "ready"
        and (lesson.owner_user_id == uid or lesson.visibility == "shared")
    )
    current_version = lesson.current_source_version if available and lesson else None
    paragraph_index = None
    if (
        available
        and lesson
        and current_version == row.source_version
        and row.selected_text == row.context_text
    ):
        paragraph_index = next(
            (
                i
                for i, p in enumerate(
                    RegexSegmenter(lesson.language_code).split_paragraphs(lesson.raw_text)
                )
                if p.start == row.start_offset and p.end == row.end_offset
            ),
            None,
        )
    return {
        "paragraph_index": paragraph_index,
        "id": row.id,
        "lesson_id": row.lesson_id if available else None,
        "source_version": row.source_version,
        "title": row.title,
        "language_code": row.language_code,
        "selected_text": row.selected_text,
        "context_text": row.context_text,
        "from_ordinal": row.from_ordinal,
        "to_ordinal": row.to_ordinal,
        "context_start_offset": row.context_start_offset,
        "context_end_offset": row.context_end_offset,
        "start_offset": row.start_offset,
        "end_offset": row.end_offset,
        "media_start_ms": row.media_start_ms,
        "media_end_ms": row.media_end_ms,
        "source_available": available,
        "current_source_version": current_version,
        "source_current": available and current_version == row.source_version,
    }
