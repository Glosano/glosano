"""Pydantic-схемы API /api/review (FLQ-7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class QueueItemOut(BaseModel):
    review_item_id: uuid.UUID
    item_kind: Literal["token", "phrase"]
    item_id: uuid.UUID
    text: str
    confidence: int
    translation: str | None
    notes: str | None
    context_sentence: str | None


class DailyOut(BaseModel):
    limit: int
    done_today: int
    limit_reached: bool


class QueueResponse(BaseModel):
    items: list[QueueItemOut]
    daily: DailyOut


class AnswerRequest(BaseModel):
    review_item_id: uuid.UUID
    quality: int = Field(ge=0, le=5)


class AnswerResponse(BaseModel):
    new_confidence: int | None
    new_status: Literal["tracked", "known"]
    due_at: datetime
    done_today: int


class CountsResponse(BaseModel):
    due: int
    new: int
    practice: int
    ai_enabled: bool
