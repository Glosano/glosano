"""Transactional, leased YouTube acquisition and version-preserving editing."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.modules.lesson_library.models import (
    Lesson,
    LessonImportJob,
    LessonMediaSource,
    LessonSegment,
    LessonSource,
)
from glosano.modules.lesson_library.repo import LessonRepo
from glosano.modules.lesson_library.schemas import FragmentEdit, FragmentOut, LessonEditResponse
from glosano.modules.lesson_library.service import (
    content_hash,
    get_owned_lesson,
    process_lesson_import,
)
from glosano.modules.lesson_library.video_segments import Fragment, prepare_fragments
from glosano.modules.lesson_library.youtube import (
    VideoImportError,
    YouTubeTranscriptProvider,
    parse_youtube_url,
)
from glosano.modules.reader_state.bulk import invalidate_bulk_actions
from glosano.modules.reader_state.models import ReaderPosition
from glosano.modules.reader_state.schemas import LessonMedia
from glosano.modules.statistics.models import DailyReadOccurrence
from glosano.modules.vocabulary.models import PhraseItem, TokenItem


class VideoConflictError(Exception):
    pass


async def request_lock(
    session: AsyncSession, user_id: uuid.UUID, request_id: uuid.UUID, namespace: str
) -> None:
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"{namespace}:{user_id}:{request_id}"},
    )


async def current_source(session: AsyncSession, lesson: Lesson) -> LessonSource | None:
    return await session.scalar(
        select(LessonSource)
        .where(
            LessonSource.lesson_id == lesson.id,
            LessonSource.version_number == lesson.current_source_version,
        )
        .order_by(LessonSource.created_at.desc())
        .limit(1)
    )


async def current_media(session: AsyncSession, lesson: Lesson) -> LessonMediaSource | None:
    return await session.scalar(
        select(LessonMediaSource)
        .join(LessonSource, LessonSource.id == LessonMediaSource.source_id)
        .where(
            LessonMediaSource.lesson_id == lesson.id,
            LessonSource.version_number == lesson.current_source_version,
        )
    )


async def create_video_import(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    url: str,
    language_code: str,
    request_id: uuid.UUID,
) -> tuple[Lesson, LessonImportJob, bool]:
    video_id = parse_youtube_url(url)
    await request_lock(session, user_id, request_id, "import")
    existing = await session.scalar(
        select(LessonImportJob).where(
            LessonImportJob.requested_by_user_id == user_id,
            LessonImportJob.request_id == request_id,
        )
    )
    payload = {"video_id": video_id, "language_code": language_code, "source_version": 1}
    if existing is not None:
        if existing.payload_json != payload:
            raise VideoConflictError("request_id_reused")
        lesson = await session.get(Lesson, existing.lesson_id)
        assert lesson is not None
        return lesson, existing, False
    repo = LessonRepo(session)
    lesson = await repo.create_processing_lesson(
        owner_user_id=user_id,
        title=f"YouTube · {video_id}",
        language_code=language_code,
        raw_text="",
        visibility="private",
    )
    source = await repo.add_source(
        lesson_id=lesson.id, content_hash=content_hash(""), source_type="youtube"
    )
    source.source_uri = f"https://www.youtube.com/watch?v={video_id}"
    job = await repo.add_import_job(
        lesson_id=lesson.id, requested_by_user_id=user_id, job_type="import_youtube"
    )
    job.request_id = request_id
    job.payload_json = payload
    job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=180)
    await session.flush()
    return lesson, job, True


async def fail_attempt(session: AsyncSession, job_id: uuid.UUID, error: VideoImportError) -> None:
    repo = LessonRepo(session)
    job = await repo.lock_job(job_id)
    if job is None or job.status not in {"pending", "running"}:
        return
    lesson = await repo.lock_lesson(job.lesson_id)
    job.status = "failed"
    job.error_message = error.code
    job.finished_at = datetime.now(UTC)
    if lesson is not None and lesson.status == "processing":
        lesson.status = "failed"


async def expire_imports(session: AsyncSession) -> int:
    jobs = list(
        await session.scalars(
            select(LessonImportJob.id)
            .where(
                LessonImportJob.job_type == "import_youtube",
                LessonImportJob.status.in_(["pending", "running"]),
                LessonImportJob.lease_expires_at <= datetime.now(UTC),
            )
            .order_by(LessonImportJob.id)
        )
    )
    expired = 0
    for job_id in jobs:
        job = await LessonRepo(session).lock_job(job_id)
        # The initial ID scan may have observed a pre-claim lease while a worker
        # was renewing it. Decide expiration only after obtaining the job lock.
        if job is None:
            continue
        await session.refresh(job)
        if (
            job.status not in {"pending", "running"}
            or job.lease_expires_at is None
            or job.lease_expires_at > datetime.now(UTC)
        ):
            continue
        await fail_attempt(session, job_id, VideoImportError("import_expired", True))
        expired += 1
    return expired


async def retry_video_import(
    session: AsyncSession, lesson_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Lesson, LessonImportJob]:
    lesson = await get_owned_lesson(session, lesson_id=lesson_id, user_id=user_id, lock=True)
    jobs = list(
        await session.scalars(
            select(LessonImportJob)
            .where(
                LessonImportJob.lesson_id == lesson_id, LessonImportJob.job_type == "import_youtube"
            )
            .order_by(LessonImportJob.created_at.desc())
        )
    )
    if not jobs:
        raise VideoConflictError("not_video_import")
    old = jobs[0]
    if (
        old.status in {"pending", "running"}
        and old.lease_expires_at
        and old.lease_expires_at <= datetime.now(UTC)
    ):
        await fail_attempt(session, old.id, VideoImportError("import_expired", True))
    if lesson.status != "failed" or old.status != "failed":
        raise VideoConflictError("import_not_failed")
    if old.error_message not in RETRYABLE_ERRORS:
        raise VideoConflictError("import_not_retryable")
    lesson.status = "processing"
    job = await LessonRepo(session).add_import_job(
        lesson_id=lesson_id, requested_by_user_id=user_id, job_type="import_youtube"
    )
    job.payload_json = dict(old.payload_json or {})
    job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=180)
    return lesson, job


RETRYABLE_ERRORS = {"network_error", "import_expired", "import_failed", "queue_unavailable"}


def prepared_segments(lesson_id: uuid.UUID, fragments: list[Fragment]) -> list[LessonSegment]:
    segments = []
    offset = 0
    for i, fragment in enumerate(fragments):
        segments.append(
            LessonSegment(
                lesson_id=lesson_id,
                ordinal=i,
                segment_type="sentence",
                text=fragment.text,
                start_char_offset=offset,
                end_char_offset=offset + len(fragment.text),
                media_start_ms=fragment.media_start_ms,
                media_end_ms=fragment.media_end_ms,
                cue_start=fragment.cue_start,
                cue_end=fragment.cue_end,
                cue_intervals=fragment.cue_intervals,
            )
        )
        offset += len(fragment.text) + 2
    return segments


async def run_video_import(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
    async with session_scope() as session:
        repo = LessonRepo(session)
        job = await repo.lock_job(job_id)
        if job is None or job.lesson_id != lesson_id or job.status != "pending":
            return
        lesson = await repo.lock_lesson(lesson_id)
        if lesson is None or lesson.status != "processing":
            return
        if job.lease_expires_at and job.lease_expires_at <= datetime.now(UTC):
            await fail_attempt(session, job_id, VideoImportError("import_expired", True))
            return
        job.status = "running"
        job.started_at = datetime.now(UTC)
        job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=150)
        payload = dict(job.payload_json or {})
    try:
        result = await YouTubeTranscriptProvider().acquire(
            payload["video_id"], payload["language_code"]
        )
        snapshot, fragments = prepare_fragments(result.cues, payload["language_code"])
        async with session_scope() as session:
            repo = LessonRepo(session)
            job = await repo.lock_job(job_id)
            if job is None or job.status != "running":
                return
            lesson = await repo.lock_lesson(lesson_id)
            if (
                lesson is None
                or lesson.status != "processing"
                or lesson.current_source_version != payload["source_version"]
            ):
                return
            if job.lease_expires_at is None or job.lease_expires_at <= datetime.now(UTC):
                await fail_attempt(session, job_id, VideoImportError("import_expired", True))
                return
            source = await current_source(session, lesson)
            assert source is not None
            lesson.raw_text = "\n\n".join(f.text for f in fragments)
            lesson.title = result.title
            source.content_hash = content_hash(lesson.raw_text)
            source.author = result.author
            session.add(
                LessonMediaSource(
                    source_id=source.id,
                    lesson_id=lesson_id,
                    video_id=result.video_id,
                    canonical_url=f"https://www.youtube.com/watch?v={result.video_id}",
                    title=result.title,
                    author=result.author,
                    language_code=result.language_code,
                    is_generated=result.is_generated,
                    cue_snapshot=snapshot,
                )
            )
            await process_lesson_import(
                session, lesson_id, prepared=prepared_segments(lesson_id, fragments)
            )
            job.status = "done"
            job.finished_at = datetime.now(UTC)
    except Exception as exc:
        error = (
            exc if isinstance(exc, VideoImportError) else VideoImportError("import_failed", True)
        )
        async with session_scope() as session:
            await fail_attempt(session, job_id, error)


async def edit_response(session: AsyncSession, lesson: Lesson) -> LessonEditResponse:
    response = LessonEditResponse.model_validate(lesson)
    response.source_version = lesson.current_source_version
    media = await current_media(session, lesson)
    if media is not None:
        response.media = LessonMedia.model_validate(media)
        segments = await session.scalars(
            select(LessonSegment)
            .where(LessonSegment.lesson_id == lesson.id)
            .order_by(LessonSegment.ordinal)
        )
        response.fragments = [
            FragmentOut(
                seg_id=s.id,
                text=s.text,
                media_start_ms=s.media_start_ms,
                media_end_ms=s.media_end_ms,
            )
            for s in segments
        ]
    return response


async def edit_video(
    session: AsyncSession,
    lesson: Lesson,
    title: str,
    source_version: int | None,
    fragments: list[FragmentEdit] | None,
) -> Lesson:
    if source_version != lesson.current_source_version:
        raise VideoConflictError("source_version_conflict")
    media = await current_media(session, lesson)
    segments = list(
        await session.scalars(
            select(LessonSegment)
            .where(LessonSegment.lesson_id == lesson.id)
            .order_by(LessonSegment.ordinal)
        )
    )
    if media is None or not fragments or [f.seg_id for f in fragments] != [s.id for s in segments]:
        raise VideoImportError("invalid_fragments")
    lesson.title = title.strip()
    raw_text = "\n\n".join(f.text for f in fragments)
    if len(raw_text.encode("utf-8")) > 5 * 1024 * 1024:
        raise VideoImportError("limit_exceeded")
    if raw_text == lesson.raw_text:
        return lesson
    prepared = [
        Fragment(
            f.text,
            s.media_start_ms or 0,
            s.media_end_ms or 0,
            s.cue_start or 0,
            s.cue_end or 0,
            s.cue_intervals or [],
        )
        for f, s in zip(fragments, segments, strict=True)
    ]
    lesson.raw_text = raw_text
    lesson.current_source_version += 1
    source = await LessonRepo(session).add_source(
        lesson_id=lesson.id,
        content_hash=content_hash(raw_text),
        source_type="youtube",
        version_number=lesson.current_source_version,
    )
    source.source_uri = media.canonical_url
    source.author = media.author
    session.add(
        LessonMediaSource(
            source_id=source.id,
            lesson_id=lesson.id,
            provider=media.provider,
            video_id=media.video_id,
            canonical_url=media.canonical_url,
            title=media.title,
            author=media.author,
            language_code=media.language_code,
            is_generated=media.is_generated,
            cue_snapshot=media.cue_snapshot,
            preparation_version=media.preparation_version,
            user_edited=True,
        )
    )
    await invalidate_bulk_actions(session, lesson.id)
    for model in (ReaderPosition, DailyReadOccurrence):
        await session.execute(delete(model).where(model.lesson_id == lesson.id))
    for model in (TokenItem, PhraseItem):
        await session.execute(
            update(model)
            .where(model.created_from_lesson_id == lesson.id)
            .values(created_from_segment_id=None)
        )
    lesson.status = "processing"
    await process_lesson_import(session, lesson.id, prepared=prepared_segments(lesson.id, prepared))
    return lesson
