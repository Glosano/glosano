"""Pydantic-схемы API /api/review (FLQ-7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


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


class ExerciseRequest(BaseModel):
    kind: Literal["example", "cloze", "reverse", "translation_task", "writing"]
    review_item_id: uuid.UUID | None = None
    review_item_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _check_ids(self) -> ExerciseRequest:
        if self.kind == "writing":
            if not self.review_item_ids:
                raise ValueError("writing requires review_item_ids")
        elif self.review_item_id is None:
            raise ValueError(f"{self.kind} requires review_item_id")
        return self


class ExerciseResponse(BaseModel):
    payload: dict[str, Any]  # структура зависит от kind (spec §5); валидирована сервисом
    model: str
    latency_ms: int


class FeedbackRequest(BaseModel):
    review_item_id: uuid.UUID
    sentence_translation: str = Field(min_length=1, max_length=500)
    user_text: str = Field(min_length=1, max_length=1000)


class FeedbackResponse(BaseModel):
    feedback: str
