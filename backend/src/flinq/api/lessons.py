"""Lessons API: list, async import (202 + enqueue), and status polling."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, status
from loguru import logger
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import get_session
from flinq.core.lesson_upload import MAX_LESSON_FILE_BYTES
from flinq.modules.lesson_library import service
from flinq.modules.lesson_library.progress import ZERO_PROGRESS, progress_for_lessons
from flinq.modules.lesson_library.repo import LessonRepo
from flinq.modules.lesson_library.schemas import (
    CreateLessonRequest,
    LessonCreatedResponse,
    LessonListResponse,
    LessonStatusResponse,
    LessonSummary,
)
from flinq.modules.reader_state.positions import get_position
from flinq.modules.reader_state.schemas import ReaderPositionOut
from flinq.worker.tasks import enqueue_lesson_import

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
    summaries = []
    for item in items:
        item_progress = progress.get(item.id, ZERO_PROGRESS)
        summaries.append(
            LessonSummary.model_validate(item).model_copy(
                update={
                    "read_percent": item_progress.read_percent,
                    "new_words_remaining": item_progress.new_words_remaining,
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
    position = await get_position(session, user_id=user_id, lesson_id=lesson_id)
    resp.reader_position = ReaderPositionOut.model_validate(position) if position else None
    return resp
