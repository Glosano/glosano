"""Pydantic DTOs for lessons API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from flinq.core.languages import SUPPORTED_LEARNING_LANGUAGES
from flinq.modules.reader_state.schemas import ReaderPositionOut


class CreateLessonRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    language_code: str
    raw_text: str = Field(min_length=1)
    visibility: Literal["private", "shared"] = "private"

    @field_validator("language_code")
    @classmethod
    def _supported(cls, v: str) -> str:
        if v not in SUPPORTED_LEARNING_LANGUAGES:
            raise ValueError(f"unsupported language: {v}")
        return v


class LessonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    language_code: str
    word_count: int
    visibility: str
    status: str
    created_at: datetime
    # Считаются на лету в progress.py; у ORM-модели Lesson таких атрибутов нет,
    # поэтому нужны значения по умолчанию — model_validate(lesson) их не найдёт.
    read_percent: int = 0
    new_words_remaining: int = 0
    can_manage: bool = False


class LessonListResponse(BaseModel):
    items: list[LessonSummary]
    total: int
    page: int
    page_size: int


class LessonCreatedResponse(BaseModel):
    id: uuid.UUID
    status: str


class LessonStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    language_code: str
    status: str
    word_count: int
    segment_count: int
    visibility: str
    created_at: datetime
    reader_position: ReaderPositionOut | None = None


class LessonEditResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    raw_text: str
    language_code: str
    status: str


class UpdateLessonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    raw_text: str = Field(min_length=1)

    @field_validator("title", "raw_text")
    @classmethod
    def _nonblank(cls, value: str) -> str:
        if not value.strip() or "\x00" in value:
            raise ValueError("must contain non-empty text without null characters")
        return value
