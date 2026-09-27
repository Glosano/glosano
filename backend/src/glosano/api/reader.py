"""Reader API: tokenized lesson content and reader state (FLQ-4)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import SessionDep
from glosano.core.languages import LearningLanguageCode
from glosano.modules.ai_translation import service as ai_translation_service
from glosano.modules.ai_translation.provider import ProviderRejected, ProviderUnavailable
from glosano.modules.identity.service import translation_target
from glosano.modules.lesson_library.models import Lesson
from glosano.modules.reader_state.access import (
    LessonForbidden,
    LessonNotFound,
    LessonNotReady,
    get_readable_lesson,
)
from glosano.modules.reader_state.bulk import (
    ActionAlreadyUndone,
    ActionNotFound,
    bulk_mark_known,
    undo_bulk_action,
)
from glosano.modules.reader_state.completion import InvalidFinalFragment, complete_lesson
from glosano.modules.reader_state.completion_summary import get_completion_summary
from glosano.modules.reader_state.content import build_lesson_content
from glosano.modules.reader_state.positions import upsert_position
from glosano.modules.reader_state.schemas import (
    BulkKnownRequest,
    BulkKnownResponse,
    BulkUndoResponse,
    CompleteLessonRequest,
    CompleteLessonResponse,
    LessonContentResponse,
    LessonVocabularyResponse,
    ReaderPositionPut,
    SegmentTranslationRequest,
    SegmentTranslationResponse,
    TokenStatusesResponse,
)
from glosano.modules.reader_state.statuses import lesson_token_statuses
from glosano.modules.reader_state.translations import SegmentNotFound, get_or_translate_segment
from glosano.modules.reader_state.vocabulary import build_lesson_vocabulary

router = APIRouter(prefix="/api", tags=["reader"])


def _require_user(request: Request) -> uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return user_id


async def _load_lesson(
    session: AsyncSession,
    lesson_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    require_ready: bool = True,
    lock_content: bool = False,
) -> Lesson:
    if lock_content:
        # Keep revision checks, ordinal writes and multi-query content assembly
        # on one version while allowing readers to run concurrently (ADR-0013).
        await session.execute(
            select(Lesson).where(Lesson.id == lesson_id).with_for_update(read=True)
        )
    try:
        return await get_readable_lesson(session, lesson_id, user_id, require_ready=require_ready)
    except LessonNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    except LessonForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN) from None
    except LessonNotReady:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="lesson_not_ready") from None


def _check_source_version(lesson: Lesson, source_version: int) -> None:
    if lesson.current_source_version != source_version:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="lesson_version_changed")


@router.get("/lessons/{lesson_id}/content", response_model=LessonContentResponse)
async def lesson_content(
    lesson_id: uuid.UUID,
    request: Request,
    session: SessionDep,
) -> LessonContentResponse:
    user_id = _require_user(request)
    lesson = await _load_lesson(session, lesson_id, user_id, lock_content=True)
    return await build_lesson_content(session, lesson)


@router.get("/lessons/{lesson_id}/token-statuses", response_model=TokenStatusesResponse)
async def lesson_token_statuses_route(
    lesson_id: uuid.UUID,
    request: Request,
    session: SessionDep,
) -> TokenStatusesResponse:
    user_id = _require_user(request)
    lesson = await _load_lesson(session, lesson_id, user_id)
    statuses = await lesson_token_statuses(session, lesson=lesson, user_id=user_id)
    return TokenStatusesResponse(statuses=statuses)


@router.get("/lessons/{lesson_id}/vocabulary", response_model=LessonVocabularyResponse)
async def lesson_vocabulary(
    lesson_id: uuid.UUID,
    target: LearningLanguageCode,
    request: Request,
    session: SessionDep,
) -> LessonVocabularyResponse:
    user_id = _require_user(request)
    lesson = await _load_lesson(session, lesson_id, user_id)
    return await build_lesson_vocabulary(
        session,
        lesson=lesson,
        user_id=user_id,
        target=target,
    )


@router.put("/reader/positions", status_code=status.HTTP_204_NO_CONTENT)
async def put_reader_position(
    body: ReaderPositionPut,
    request: Request,
    session: SessionDep,
) -> None:
    user_id = _require_user(request)
    # Positions may be written for a lesson still processing (e.g. mode preference).
    lesson = await _load_lesson(
        session, body.lesson_id, user_id, require_ready=False, lock_content=True
    )
    _check_source_version(lesson, body.source_version)
    await upsert_position(
        session,
        user_id=user_id,
        lesson_id=body.lesson_id,
        view_mode=body.view_mode,
        current_segment_id=body.current_segment_id,
        current_token_ordinal=body.current_token_ordinal,
    )


@router.post(
    "/lessons/{lesson_id}/segments/{segment_id}/translation",
    response_model=SegmentTranslationResponse,
)
async def segment_translation(
    lesson_id: uuid.UUID,
    segment_id: uuid.UUID,
    body: SegmentTranslationRequest,
    request: Request,
    session: SessionDep,
) -> SegmentTranslationResponse:
    user_id = _require_user(request)
    lesson = await _load_lesson(session, lesson_id, user_id)
    try:
        row, stored = await get_or_translate_segment(
            session,
            user_id=user_id,
            lesson=lesson,
            segment_id=segment_id,
            target_language_code=await translation_target(session, user_id),
        )
    except SegmentNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    except ai_translation_service.AIDisabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="ai_disabled") from None
    except (ProviderUnavailable, ProviderRejected):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ai_provider_error") from None
    except ai_translation_service.AIEmptyResponse:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ai_empty_response") from None
    return SegmentTranslationResponse(
        text=row.translation_text,
        source=row.source,
        model=row.model,
        stored=stored,
    )


@router.post("/reader/bulk-known", response_model=BulkKnownResponse)
async def bulk_known(
    body: BulkKnownRequest,
    request: Request,
    session: SessionDep,
) -> BulkKnownResponse:
    user_id = _require_user(request)
    from sqlalchemy import select

    from glosano.modules.lesson_library.video_import import request_lock
    from glosano.modules.reader_state.models import BulkAction

    if body.request_id is not None:
        await request_lock(session, user_id, body.request_id, "bulk")
        previous = await session.scalar(
            select(BulkAction).where(
                BulkAction.user_id == user_id, BulkAction.request_id == body.request_id
            )
        )
        if previous is not None:
            if (
                previous.lesson_id != body.lesson_id
                or previous.source_version != body.source_version
                or previous.page_fingerprint != f"{body.from_ordinal}:{body.to_ordinal}"
            ):
                raise HTTPException(409, "request_id_reused")
            if previous.payload_json.get("invalidated"):
                raise HTTPException(409, "source_version_conflict")
            return BulkKnownResponse(
                action_id=previous.id,
                created_count=len(previous.payload_json.get("token_item_ids", [])),
                undone=previous.undone_at is not None,
            )
    lesson = await _load_lesson(session, body.lesson_id, user_id, lock_content=True)
    _check_source_version(lesson, body.source_version)
    action_id, created_count = await bulk_mark_known(
        session,
        user_id=user_id,
        lesson=lesson,
        from_ordinal=body.from_ordinal,
        to_ordinal=body.to_ordinal,
        request_id=body.request_id,
    )
    return BulkKnownResponse(action_id=action_id, created_count=created_count)


@router.post("/reader/bulk-actions/{action_id}/undo", response_model=BulkUndoResponse)
async def undo_bulk_known(
    action_id: uuid.UUID,
    request: Request,
    session: SessionDep,
) -> BulkUndoResponse:
    user_id = _require_user(request)
    try:
        undone_count = await undo_bulk_action(session, user_id=user_id, action_id=action_id)
    except ActionNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    except ActionAlreadyUndone:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="already_undone") from None
    return BulkUndoResponse(undone_count=undone_count)


@router.post("/reader/complete", response_model=CompleteLessonResponse)
async def complete_reader_lesson(
    body: CompleteLessonRequest,
    request: Request,
    session: SessionDep,
) -> CompleteLessonResponse:
    user_id = _require_user(request)
    lesson = await _load_lesson(session, body.lesson_id, user_id, lock_content=True)
    _check_source_version(lesson, body.source_version)
    try:
        return await complete_lesson(session, user_id=user_id, lesson=lesson, body=body)
    except InvalidFinalFragment:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid_final_fragment"
        ) from None


@router.get("/lessons/{lesson_id}/completion-summary", response_model=CompleteLessonResponse)
async def reader_completion_summary(
    session: SessionDep,
    lesson_id: uuid.UUID,
    request: Request,
    action_id: uuid.UUID | None = None,
) -> CompleteLessonResponse:
    user_id = _require_user(request)
    await _load_lesson(session, lesson_id, user_id, lock_content=True)
    result = await get_completion_summary(session, user_id=user_id, lesson_id=lesson_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="lesson_not_completed")
    if action_id is not None and result.action_id != action_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="completion_changed")
    return result
