"""Pydantic DTOs for lessons API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from glosano.core.languages import SUPPORTED_LEARNING_LANGUAGES
from glosano.modules.reader_state.schemas import LessonMedia, ReaderPositionOut


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
    source_type: str | None = None
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
    completed_at: datetime | None = None


class LessonListResponse(BaseModel):
    items: list[LessonSummary]
    total: int
    page: int
    page_size: int


class LessonCreatedResponse(BaseModel):
    id: uuid.UUID
    status: str


class ImportErrorOut(BaseModel):
    code: str
    retryable: bool


class LessonStatusResponse(BaseModel):
    media: LessonMedia | None = None
    import_error: ImportErrorOut | None = None
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


class FragmentOut(BaseModel):
    seg_id: uuid.UUID
    text: str
    media_start_ms: int | None = None
    media_end_ms: int | None = None


class LessonEditResponse(BaseModel):
    source_version: int = 1
    media: LessonMedia | None = None
    fragments: list[FragmentOut] | None = None
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    raw_text: str
    language_code: str
    status: str


class FragmentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seg_id: uuid.UUID
    text: str = Field(min_length=1)

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        if not value.strip() or "\x00" in value or "\n" in value or "\r" in value:
            raise ValueError("fragment must be nonempty single-line text")
        return value.strip()


class UpdateLessonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    raw_text: str | None = Field(default=None, min_length=1)
    source_version: int | None = Field(default=None, ge=1)
    fragments: list[FragmentEdit] | None = None

    @field_validator("title", "raw_text")
    @classmethod
    def _nonblank(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or "\x00" in value):
            raise ValueError("must contain non-empty text without null characters")
        return value


class ImportYouTubeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(max_length=2048)
    language_code: str
    request_id: uuid.UUID

    @field_validator("language_code")
    @classmethod
    def _supported(cls, value: str) -> str:
        if value not in SUPPORTED_LEARNING_LANGUAGES:
            raise ValueError("unsupported language")
        return value
