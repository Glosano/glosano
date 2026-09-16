"""Pydantic DTOs for reader-state APIs (spec §API-1: tokenized lesson content).

Wire keys `t/n/i/ws/p` are the wire contract consumed byte-for-byte by the
frontend reader — do not rename.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from flinq.core.languages import LearningLanguageCode
from flinq.modules.vocabulary.schemas import PrimaryTranslationOut


class WordToken(BaseModel):
    t: str
    n: str
    i: int


class WhitespaceToken(BaseModel):
    ws: str


class PunctToken(BaseModel):
    p: str


Token = WordToken | WhitespaceToken | PunctToken


class SentenceOut(BaseModel):
    seg_id: uuid.UUID
    index: int  # sentence ordinal (segment.ordinal)
    text: str
    normalized_text: str
    tokens: list[Token]


class ParagraphOut(BaseModel):
    sentences: list[SentenceOut]


class LessonContentResponse(BaseModel):
    lesson_id: uuid.UUID
    source_version: int = 1
    language_code: str
    word_count: int
    paragraphs: list[ParagraphOut]


class TokenStatusOut(BaseModel):
    s: str
    c: int | None = None


class TokenStatusesResponse(BaseModel):
    statuses: dict[str, TokenStatusOut]


class LessonVocabularyContext(BaseModel):
    segment_id: uuid.UUID
    token_ordinal: int = Field(ge=0)
    sentence_text: str


class LessonVocabularyItem(BaseModel):
    kind: Literal["token", "phrase"]
    item_id: uuid.UUID | None
    text: str
    display_text: str
    status: Literal["new", "tracked", "known", "ignored"]
    confidence: int | None = Field(default=None, ge=0, le=5)
    primary_translation: PrimaryTranslationOut | None
    added_here: bool
    context: LessonVocabularyContext | None


class LessonVocabularyResponse(BaseModel):
    lesson_id: uuid.UUID
    language_code: str
    items: list[LessonVocabularyItem]


class ReaderPositionPut(BaseModel):
    lesson_id: uuid.UUID
    source_version: int = Field(default=1, ge=1)
    view_mode: Literal["page", "sentence"]
    current_segment_id: uuid.UUID | None
    current_token_ordinal: int | None = Field(default=None, ge=0)


class ReaderPositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    completed_at: datetime | None = None
    completion_action_id: uuid.UUID | None = None
    view_mode: str
    current_segment_id: uuid.UUID | None
    current_token_ordinal: int | None


class CompleteLessonRequest(BaseModel):
    lesson_id: uuid.UUID
    source_version: int = Field(ge=1)
    view_mode: Literal["page", "sentence"]
    last_segment_id: uuid.UUID | None
    from_ordinal: int | None = Field(ge=0)
    to_ordinal: int | None = Field(ge=0)

    @model_validator(mode="after")
    def _check_range(self) -> Self:
        if (self.from_ordinal is None) != (self.to_ordinal is None):
            raise ValueError("both range bounds must be set or null")
        if (
            self.from_ordinal is not None
            and self.to_ordinal is not None
            and self.to_ordinal < self.from_ordinal
        ):
            raise ValueError("to_ordinal must be >= from_ordinal")
        return self


class BulkKnownRequest(BaseModel):
    lesson_id: uuid.UUID
    source_version: int = Field(default=1, ge=1)
    from_ordinal: int = Field(ge=0)
    to_ordinal: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_range(self) -> Self:
        if self.to_ordinal < self.from_ordinal:
            raise ValueError("to_ordinal must be >= from_ordinal")
        return self


class BulkKnownResponse(BaseModel):
    action_id: uuid.UUID
    created_count: int


class CompletionSummary(BaseModel):
    total_words: int = Field(ge=0)
    unique_words: int = Field(ge=0)
    known_words: int = Field(ge=0)
    new_words: int = Field(ge=0)
    tracked_words: int = Field(ge=0)
    ignored_words: int = Field(ge=0)
    added_words: int = Field(ge=0)
    added_phrases: int = Field(ge=0)
    reading_days: int = Field(ge=0)
    marked_known_words: int = Field(ge=0)


class CompleteLessonResponse(BulkKnownResponse):
    completed_at: datetime
    summary: CompletionSummary | None = None


class BulkUndoResponse(BaseModel):
    undone_count: int


class SegmentTranslationRequest(BaseModel):
    target_language_code: LearningLanguageCode


class SegmentTranslationResponse(BaseModel):
    text: str
    source: str
    model: str
    stored: bool
