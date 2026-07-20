"""SRS review API (FLQ-7)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import get_session
from flinq.modules.review import service
from flinq.modules.review.schemas import (
    AnswerRequest,
    AnswerResponse,
    CountsResponse,
    DailyOut,
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
