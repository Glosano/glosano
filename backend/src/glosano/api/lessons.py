"""Lessons API: list, async import (202 + enqueue), and status polling."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, UploadFile, status
from loguru import logger
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import get_session
from glosano.core.lesson_upload import MAX_LESSON_FILE_BYTES
from glosano.modules.lesson_library import service, video_import
from glosano.modules.lesson_library.models import Lesson, LessonImportJob, LessonSource
from glosano.modules.lesson_library.progress import ZERO_PROGRESS, progress_for_lessons
from glosano.modules.lesson_library.repo import LessonRepo
from glosano.modules.lesson_library.schemas import (
    CreateLessonRequest,
    ImportErrorOut,
    ImportYouTubeRequest,
    LessonCreatedResponse,
    LessonEditResponse,
    LessonListResponse,
    LessonStatusResponse,
    LessonSummary,
    UpdateLessonRequest,
)
from glosano.modules.lesson_library.youtube import VideoImportError
from glosano.modules.reader_state.positions import get_position
from glosano.modules.reader_state.schemas import LessonMedia, ReaderPositionOut
from glosano.worker.tasks import enqueue_lesson_import

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


def _require_user(request: Request) -> uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return user_id


@router.get("", response_model=LessonListResponse)
async def list_lessons(
    request: Request,
    lang: str,
    tab: str = "lessons",
    q: str | None = None,
    visibility: str = "all",
    page: int = 1,
    page_size: int = 25,
    session: AsyncSession = Depends(get_session),
) -> LessonListResponse:
    user_id = _require_user(request)
    items, total = await LessonRepo(session).list_for_user(
        user_id=user_id,
        lang=lang,
        q=q,
        visibility=visibility,
        tab=tab,
        page=page,
        page_size=page_size,
    )
    progress = await progress_for_lessons(
        session, user_id=user_id, lang=lang, lesson_ids=[item.id for item in items]
    )
    sources = await session.scalars(
        select(LessonSource)
        .join(Lesson, Lesson.id == LessonSource.lesson_id)
        .where(
            Lesson.id.in_([item.id for item in items]),
            LessonSource.version_number == Lesson.current_source_version,
        )
    )
    source_types = {source.lesson_id: source.source_type for source in sources}
    summaries = []
    for item in items:
        item_progress = progress.get(item.id, ZERO_PROGRESS)
        summaries.append(
            LessonSummary.model_validate(item).model_copy(
                update={
                    "source_type": source_types.get(item.id),
                    "read_percent": item_progress.read_percent,
                    "completed_at": item_progress.completed_at,
                    "new_words_remaining": item_progress.new_words_remaining,
                    "can_manage": item.owner_user_id == user_id,
                }
            )
        )

    return LessonListResponse(
        items=summaries,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=LessonCreatedResponse)
async def create_lesson(
    body: CreateLessonRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LessonCreatedResponse:
    return await _create_and_enqueue(body, _require_user(request), session)


async def _create_and_enqueue(
    body: CreateLessonRequest,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    original_filename: str | None = None,
) -> LessonCreatedResponse:
    lesson, job_id = await service.create_lesson_for_import(
        owner_user_id=user_id,
        title=body.title,
        language_code=body.language_code,
        raw_text=body.raw_text,
        visibility=body.visibility,
        repo=LessonRepo(session),
        original_filename=original_filename,
    )
    lesson_id = lesson.id
    lesson_status = lesson.status
    # Commit so the background worker (which opens its own session) sees the rows.
    await session.commit()
    # If the queue is unavailable, do NOT strand the lesson in `processing`
    # forever: mark it failed and surface a 503 so the client can retry.
    try:
        await enqueue_lesson_import(lesson_id, job_id)
    except Exception as exc:  # any enqueue/transport failure must not strand the lesson
        logger.warning("enqueue_lesson_import failed for {}: {}", lesson_id, exc)
        await service.mark_import_failed(
            session, lesson_id=lesson_id, job_id=job_id, error=f"enqueue failed: {exc}"
        )
        await session.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "could not queue lesson import"
        ) from exc
    return LessonCreatedResponse(id=lesson_id, status=lesson_status)


# Browsers may report Markdown as plain text or omit its MIME type entirely.
_FILE_MIME_TYPES = {
    ".txt": {"text/plain", "application/octet-stream", ""},
    ".md": {"text/plain", "text/markdown", "text/x-markdown", "application/octet-stream", ""},
}


@router.post(
    "/import-file", status_code=status.HTTP_202_ACCEPTED, response_model=LessonCreatedResponse
)
async def import_lesson_file(
    request: Request,
    file: UploadFile,
    language_code: str = Form(),
    title: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> LessonCreatedResponse:
    user_id = _require_user(request)
    try:
        # Never interpret a client filename as a path on the server.
        filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        if len(filename) > 255:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid lesson metadata")
        stem, separator, extension = filename.rpartition(".")
        suffix = f".{extension.lower()}" if separator else ""
        mime = (file.content_type or "").split(";", 1)[0].strip().lower()
        if suffix not in _FILE_MIME_TYPES or mime not in _FILE_MIME_TYPES[suffix]:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported lesson file")
        content = await file.read(MAX_LESSON_FILE_BYTES + 1)
        if len(content) > MAX_LESSON_FILE_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "lesson file too large")
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "lesson file must be UTF-8"
            ) from exc
        if not raw_text.strip() or "\x00" in raw_text:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "lesson file must contain text"
            )
        try:
            body = CreateLessonRequest(
                title=(title if title is not None else stem).strip(),
                language_code=language_code,
                raw_text=raw_text,
                visibility="private",
            )
        except ValidationError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid lesson metadata"
            ) from exc
    finally:
        await file.close()
    return await _create_and_enqueue(body, user_id, session, original_filename=filename)


async def _enqueue_video(session: AsyncSession, lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
    await session.commit()
    try:
        await enqueue_lesson_import(lesson_id, job_id)
    except Exception:
        await video_import.fail_attempt(
            session, job_id, VideoImportError("queue_unavailable", True)
        )
        await session.commit()
        raise HTTPException(503, "queue_unavailable") from None


@router.post("/import-youtube", status_code=202, response_model=LessonCreatedResponse)
async def import_youtube(
    body: ImportYouTubeRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> LessonCreatedResponse:
    try:
        lesson, job, created = await video_import.create_video_import(
            session,
            user_id=_require_user(request),
            url=body.url,
            language_code=body.language_code,
            request_id=body.request_id,
        )
    except VideoImportError as exc:
        raise HTTPException(422, exc.code) from None
    except video_import.VideoConflictError as exc:
        raise HTTPException(409, str(exc)) from None
    result = LessonCreatedResponse(id=lesson.id, status=lesson.status)
    if created:
        await _enqueue_video(session, lesson.id, job.id)
    return result


@router.post("/{lesson_id}/retry-import", status_code=202, response_model=LessonCreatedResponse)
async def retry_import(
    lesson_id: uuid.UUID, request: Request, session: AsyncSession = Depends(get_session)
) -> LessonCreatedResponse:
    try:
        lesson, job = await video_import.retry_video_import(
            session, lesson_id, _require_user(request)
        )
    except service.LessonNotFoundError:
        raise HTTPException(404) from None
    except video_import.VideoConflictError as exc:
        raise HTTPException(409, str(exc)) from None
    result = LessonCreatedResponse(id=lesson.id, status=lesson.status)
    await _enqueue_video(session, lesson.id, job.id)
    return result


@router.get("/{lesson_id}", response_model=LessonStatusResponse)
async def get_lesson(
    lesson_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LessonStatusResponse:
    user_id = _require_user(request)
    lesson = await LessonRepo(session).get_lesson(lesson_id)
    if lesson is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if lesson.owner_user_id != user_id and lesson.visibility != "shared":
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    resp = LessonStatusResponse.model_validate(lesson)
    media = await video_import.current_media(session, lesson)
    resp.media = LessonMedia.model_validate(media) if media else None
    if lesson.status == "failed":
        job = await session.scalar(
            select(LessonImportJob)
            .where(
                LessonImportJob.lesson_id == lesson_id, LessonImportJob.job_type == "import_youtube"
            )
            .order_by(LessonImportJob.created_at.desc())
            .limit(1)
        )
        if job and job.error_message:
            resp.import_error = ImportErrorOut(
                code=job.error_message, retryable=job.error_message in video_import.RETRYABLE_ERRORS
            )
    position = await get_position(session, user_id=user_id, lesson_id=lesson_id)
    resp.reader_position = ReaderPositionOut.model_validate(position) if position else None
    return resp


@router.get("/{lesson_id}/edit", response_model=LessonEditResponse)
async def get_lesson_for_edit(
    lesson_id: uuid.UUID, request: Request, session: AsyncSession = Depends(get_session)
) -> LessonEditResponse:
    try:
        lesson = await service.get_owned_lesson(
            session, lesson_id=lesson_id, user_id=_require_user(request)
        )
    except service.LessonNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from exc
    return await video_import.edit_response(session, lesson)


@router.patch("/{lesson_id}", response_model=LessonEditResponse)
async def update_lesson(
    lesson_id: uuid.UUID,
    body: UpdateLessonRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LessonEditResponse:
    try:
        lesson = await service.get_owned_lesson(
            session, lesson_id=lesson_id, user_id=_require_user(request), lock=True
        )
        source = await video_import.current_source(session, lesson)
        if source and source.source_type == "youtube":
            if lesson.status == "processing":
                raise service.LessonNotProcessableError
            if body.raw_text is not None:
                raise VideoImportError("video_raw_text_forbidden")
            lesson = await video_import.edit_video(
                session, lesson, body.title, body.source_version, body.fragments
            )
        else:
            if (
                body.raw_text is None
                or body.fragments is not None
                or body.source_version is not None
            ):
                raise VideoImportError("raw_text_required")
            lesson = await service.update_lesson(
                session,
                lesson_id=lesson_id,
                user_id=_require_user(request),
                title=body.title,
                raw_text=body.raw_text,
            )
    except VideoImportError as exc:
        raise HTTPException(422, exc.code) from None
    except video_import.VideoConflictError as exc:
        raise HTTPException(409, str(exc)) from None
    except service.LessonNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from exc
    except service.LessonNotProcessableError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "lesson is still processing") from exc
    return await video_import.edit_response(session, lesson)


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(
    lesson_id: uuid.UUID, request: Request, session: AsyncSession = Depends(get_session)
) -> Response:
    try:
        await service.delete_lesson(session, lesson_id=lesson_id, user_id=_require_user(request))
    except service.LessonNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
