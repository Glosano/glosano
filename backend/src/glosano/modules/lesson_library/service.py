"""Lesson library service: lesson creation and the import pipeline."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.lesson_library.models import (
    Lesson,
    LessonSegment,
    LessonTokenOccurrence,
)
from glosano.modules.lesson_library.repo import LessonRepo
from glosano.modules.lesson_library.tokenization import RegexSegmenter, tokenize
from glosano.modules.reader_state.bulk import invalidate_bulk_actions
from glosano.modules.reader_state.models import ReaderPosition
from glosano.modules.statistics.models import DailyReadOccurrence
from glosano.modules.vocabulary.models import PhraseItem, TokenItem

# Ordinary import deliveries cannot overwrite ready content. Explicit edits
# create a source version before reprocessing in the same transaction (ADR-0013).
_PROCESSABLE = {"processing", "failed"}


class LessonNotFoundError(Exception):
    """Raised when a lesson id does not exist."""


class LessonNotProcessableError(Exception):
    """Raised when import is attempted on a lesson that is not re-runnable."""


def _normalize_newlines(raw_text: str) -> str:
    """Canonicalize line endings to \\n so offsets and segmentation are stable."""
    return raw_text.replace("\r\n", "\n").replace("\r", "\n")


def content_hash(raw_text: str) -> str:
    return hashlib.sha256(raw_text.encode("utf-8")).hexdigest()


async def create_lesson_for_import(
    *,
    owner_user_id: uuid.UUID,
    title: str,
    language_code: str,
    raw_text: str,
    visibility: str,
    repo: LessonRepo,
    original_filename: str | None = None,
) -> tuple[Lesson, uuid.UUID]:
    """Create a processing lesson + v1 source + pending job. Returns (lesson, job_id)."""
    canonical = _normalize_newlines(raw_text)
    lesson = await repo.create_processing_lesson(
        owner_user_id=owner_user_id,
        title=title,
        language_code=language_code,
        raw_text=canonical,
        visibility=visibility,
    )
    await repo.add_source(
        lesson_id=lesson.id,
        content_hash=content_hash(canonical),
        source_type="file" if original_filename is not None else "manual",
        original_filename=original_filename,
    )
    job = await repo.add_import_job(lesson_id=lesson.id, requested_by_user_id=owner_user_id)
    return lesson, job.id


async def mark_import_failed(
    session: AsyncSession,
    *,
    lesson_id: uuid.UUID,
    job_id: uuid.UUID,
    error: str,
) -> None:
    """Flip a lesson + its import job to failed (used when enqueue cannot happen).

    Never downgrades a lesson that already reached ready. Caller commits.
    """
    repo = LessonRepo(session)
    lesson = await repo.get_lesson(lesson_id)
    if lesson is not None and lesson.status != "ready":
        lesson.status = "failed"
    job = await repo.get_job(job_id)
    if job is not None:
        job.status = "failed"
        job.error_message = error
        job.finished_at = datetime.now(UTC)
    await session.flush()


async def get_owned_lesson(
    session: AsyncSession, *, lesson_id: uuid.UUID, user_id: uuid.UUID, lock: bool = False
) -> Lesson:
    repo = LessonRepo(session)
    lesson = await repo.get_lesson(lesson_id)
    if lesson is None or lesson.owner_user_id != user_id:
        raise LessonNotFoundError(str(lesson_id))
    if lock:
        await repo.lock_import_jobs(lesson_id)
        lesson = await repo.lock_lesson(lesson_id)
        if lesson is None or lesson.owner_user_id != user_id:
            raise LessonNotFoundError(str(lesson_id))
        # The row may have changed while we waited for a worker's transaction.
        await session.refresh(lesson)
    return lesson


async def update_lesson(
    session: AsyncSession, *, lesson_id: uuid.UUID, user_id: uuid.UUID, title: str, raw_text: str
) -> Lesson:
    """Apply an explicit source revision atomically; caller commits or rolls back."""
    lesson = await get_owned_lesson(session, lesson_id=lesson_id, user_id=user_id, lock=True)
    if lesson.status == "processing":
        raise LessonNotProcessableError("lesson is still processing")
    canonical = _normalize_newlines(raw_text)
    lesson.title = title.strip()
    if canonical != lesson.raw_text:
        lesson.raw_text = canonical
        lesson.current_source_version += 1
        repo = LessonRepo(session)
        await repo.add_source(
            lesson_id=lesson_id,
            content_hash=content_hash(canonical),
            version_number=lesson.current_source_version,
        )
        # Ordinals and segment IDs refer to the old content. Historical totals
        # and personal learning items are independent and must survive.
        await invalidate_bulk_actions(session, lesson_id)
        for model in (ReaderPosition, DailyReadOccurrence):
            await session.execute(delete(model).where(model.lesson_id == lesson_id))
        for model in (TokenItem, PhraseItem):
            await session.execute(
                update(model)
                .where(model.created_from_lesson_id == lesson_id)
                .values(created_from_segment_id=None)
            )
        lesson.status = "processing"
        await process_lesson_import(session, lesson_id)
    await session.flush()
    return lesson


async def delete_lesson(session: AsyncSession, *, lesson_id: uuid.UUID, user_id: uuid.UUID) -> None:
    lesson = await get_owned_lesson(session, lesson_id=lesson_id, user_id=user_id, lock=True)
    for model in (TokenItem, PhraseItem):
        await session.execute(
            update(model)
            .where(model.created_from_lesson_id == lesson_id)
            .values(created_from_segment_id=None)
        )
    # Cascades remove lesson facts/state; vocabulary provenance uses SET NULL.
    await session.delete(lesson)
    await session.flush()


async def process_lesson_import(
    session: AsyncSession, lesson_id: uuid.UUID, *, prepared: list[LessonSegment] | None = None
) -> None:
    """Segment + tokenize a lesson's text into facts, then mark it ready.

    Idempotent and concurrency-safe: the lesson row is locked FOR UPDATE and its
    status re-checked under the lock, so duplicate/concurrent runs serialize and
    a ready lesson is never mutated. Existing facts are deleted before re-insert.
    Allowed only while the lesson status is in {processing, failed}.
    """
    repo = LessonRepo(session)
    lesson = await repo.lock_lesson(lesson_id)  # FOR UPDATE: serialize concurrent runs
    if lesson is None:
        raise LessonNotFoundError(str(lesson_id))
    if lesson.status not in _PROCESSABLE:  # re-checked while holding the row lock
        raise LessonNotProcessableError(f"lesson {lesson_id} is {lesson.status}")

    await repo.delete_facts(lesson_id)

    segmenter = RegexSegmenter(lesson.language_code)
    word_count = 0
    segment_ordinal = 0
    occ_ordinal = 0

    if prepared is None:
        prepared = [
            LessonSegment(
                lesson_id=lesson_id,
                ordinal=i,
                segment_type="sentence",
                text=sentence.text,
                start_char_offset=sentence.start,
                end_char_offset=sentence.end,
            )
            for i, sentence in enumerate(
                sentence
                for paragraph in segmenter.split_paragraphs(lesson.raw_text)
                for sentence in segmenter.split_sentences(
                    paragraph.text, base_offset=paragraph.start
                )
            )
        ]
    for segment in prepared:
        session.add(segment)
        await session.flush()  # assign segment.id for the occurrence FK

        for seg_idx, tok in enumerate(
            tokenize(
                segment.text,
                base_offset=segment.start_char_offset,
                language_code=lesson.language_code,
            )
        ):
            session.add(
                LessonTokenOccurrence(
                    lesson_id=lesson_id,
                    segment_id=segment.id,
                    ordinal_in_lesson=occ_ordinal,
                    ordinal_in_segment=seg_idx,
                    surface_text=tok.surface_text,
                    normalized_text=tok.normalized_text,
                    start_char_offset=tok.start_char_offset,
                    end_char_offset=tok.end_char_offset,
                    is_word_like=tok.is_word_like,
                )
            )
            occ_ordinal += 1
            if tok.is_word_like:
                word_count += 1

        segment_ordinal += 1

    lesson.word_count = word_count
    lesson.segment_count = segment_ordinal
    lesson.status = "ready"
    await session.flush()
