"""SRS review API (FLQ-7)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import get_session
from flinq.modules.ai_translation.provider import ProviderRejected, ProviderUnavailable
from flinq.modules.ai_translation.service import AIDisabled
from flinq.modules.review import exercises, service
from flinq.modules.review.schemas import (
    AnswerRequest,
    AnswerResponse,
    CountsResponse,
    DailyOut,
    ExerciseRequest,
    ExerciseResponse,
    FeedbackRequest,
    FeedbackResponse,
    QueueItemOut,
    QueueResponse,
)

router = APIRouter(prefix="/api/review", tags=["review"])

LangCode = Literal["en", "ru", "pt"]


def _require_user(request: Request) -> uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return user_id


@router.get("/queue", response_model=QueueResponse)
async def queue(
    request: Request,
    lang: LangCode,
    session: Annotated[AsyncSession, Depends(get_session)],
    mode: Literal["due", "new", "practice"] = "due",
    lesson_id: uuid.UUID | None = None,
) -> QueueResponse:
    user_id = _require_user(request)
    try:
        items, daily = await service.get_queue(
            session, user_id=user_id, language_code=lang, mode=mode, lesson_id=lesson_id
        )
    except service.LessonNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return QueueResponse(
        items=[
            QueueItemOut(
                review_item_id=i.review_item_id,
                item_kind=cast('Literal["token", "phrase"]', i.item_kind),
                item_id=i.item_id,
                text=i.text,
                confidence=i.confidence,
                translation=i.translation,
                notes=i.notes,
                context_sentence=i.context_sentence,
            )
            for i in items
        ],
        daily=DailyOut(
            limit=daily.limit, done_today=daily.done_today, limit_reached=daily.limit_reached
        ),
    )


@router.post("/answer", response_model=AnswerResponse)
async def answer(
    request: Request,
    body: AnswerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AnswerResponse:
    user_id = _require_user(request)
    try:
        res = await service.answer(
            session,
            user_id=user_id,
            review_item_id=body.review_item_id,
            quality=body.quality,
        )
    except service.ReviewItemNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return AnswerResponse(
        new_confidence=res.new_confidence,
        new_status=cast('Literal["tracked", "known"]', res.new_status),
        due_at=res.due_at,
        done_today=res.done_today,
    )


@router.get("/counts", response_model=CountsResponse)
async def counts(
    request: Request,
    lang: LangCode,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CountsResponse:
    user_id = _require_user(request)
    c = await service.get_counts(session, user_id=user_id, language_code=lang)
    return CountsResponse(due=c.due, new=c.new, practice=c.practice, ai_enabled=c.ai_enabled)


@router.post("/exercise", response_model=ExerciseResponse)
async def exercise(
    request: Request,
    body: ExerciseRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ExerciseResponse:
    user_id = _require_user(request)
    try:
        res = await exercises.generate_exercise(
            session,
            user_id=user_id,
            kind=body.kind,
            review_item_id=body.review_item_id,
            review_item_ids=body.review_item_ids,
        )
    except AIDisabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="ai_disabled") from None
    except (ProviderUnavailable, ProviderRejected):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ai_provider_error") from None
    except exercises.ExerciseParseError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="exercise_parse_error") from None
    except service.ReviewItemNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return ExerciseResponse(payload=res.payload, model=res.model, latency_ms=res.latency_ms)


@router.post("/exercise/feedback", response_model=FeedbackResponse)
async def exercise_feedback(
    request: Request,
    body: FeedbackRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FeedbackResponse:
    user_id = _require_user(request)
    try:
        res = await exercises.translation_feedback(
            session,
            user_id=user_id,
            review_item_id=body.review_item_id,
            sentence_translation=body.sentence_translation,
            user_text=body.user_text,
        )
    except AIDisabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="ai_disabled") from None
    except (ProviderUnavailable, ProviderRejected):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ai_provider_error") from None
    except exercises.ExerciseParseError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="exercise_parse_error") from None
    except service.ReviewItemNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from None
    return FeedbackResponse(feedback=str(res.payload["feedback"]))
