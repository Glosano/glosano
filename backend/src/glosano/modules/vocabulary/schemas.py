"""Pydantic DTOs for the vocabulary WordCard API (FLQ-5)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from glosano.core.languages import LearningLanguageCode

LangCode = LearningLanguageCode
ItemStatus = Literal["tracked", "known", "ignored"]


class TranslationOut(BaseModel):
    id: uuid.UUID
    text: str
    target_language_code: str
    is_primary: bool
    source_type: str


class TranslationsBlock(BaseModel):
    primary: TranslationOut | None
    all: list[TranslationOut]


class LookupResponse(BaseModel):
    item_id: uuid.UUID | None
    status: Literal["new", "tracked", "known", "ignored"]
    confidence: int | None
    translations: TranslationsBlock
    note: str | None
    tags: list[str]
    ai_tags: list[str] = Field(default_factory=list)


class CreateItemRequest(BaseModel):
    kind: Literal["token", "phrase"] = "token"
    language_code: LangCode
    text: str = Field(min_length=1, max_length=256)
    status: ItemStatus
    confidence: int | None = Field(default=None, ge=0, le=5)
    lesson_id: uuid.UUID | None = None
    segment_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _confidence_matches_status(self) -> CreateItemRequest:
        if (self.status == "tracked") != (self.confidence is not None):
            raise ValueError("confidence required iff status == 'tracked'")
        return self


class PatchItemRequest(BaseModel):
    status: ItemStatus
    confidence: int | None = Field(default=None, ge=0, le=5)
    lesson_id: uuid.UUID | None = None
    segment_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _confidence_matches_status(self) -> PatchItemRequest:
        if (self.status == "tracked") != (self.confidence is not None):
            raise ValueError("confidence required iff status == 'tracked'")
        return self


class ItemStateResponse(BaseModel):
    item_id: uuid.UUID
    status: str
    confidence: int | None


class AddTranslationRequest(BaseModel):
    target_language_code: LangCode
    translation_text: str = Field(min_length=1, max_length=512)
    source_type: Literal["user", "ai", "dictionary"] = "user"


class UpdateTranslationRequest(BaseModel):
    translation_text: str = Field(min_length=1, max_length=512)


class TranslationListResponse(BaseModel):
    translations: list[TranslationOut]


class PutNoteRequest(BaseModel):
    note_text: str = Field(max_length=4000)


class NoteResponse(BaseModel):
    note: str


TagName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class AddTagRequest(BaseModel):
    tag_name: TagName
    source_type: Literal["user", "ai"] = "user"


class AddTagsRequest(BaseModel):
    tags: list[TagName] = Field(min_length=1, max_length=20)
    source_type: Literal["user", "ai"] = "user"


class TagsResponse(BaseModel):
    tags: list[str]


class PhraseListEntryOut(BaseModel):
    item_id: uuid.UUID
    phrase_text: str
    status: ItemStatus
    confidence: int | None


class PhraseListResponse(BaseModel):
    phrases: list[PhraseListEntryOut]


class PrimaryTranslationOut(BaseModel):
    text: str
    target_language_code: str


class VocabListItemOut(BaseModel):
    item_id: uuid.UUID
    kind: Literal["token", "phrase"]
    text: str
    status: Literal["tracked", "known", "ignored"]
    confidence: int | None
    primary_translation: PrimaryTranslationOut | None
    tags: list[str]
    ai_tags: list[str] = Field(default_factory=list)
    pos: str | None
    context: str | None
    created_at: datetime


class VocabListResponse(BaseModel):
    items: list[VocabListItemOut]
    total: int
    page: int
    page_size: int


class BulkActionRequest(BaseModel):
    item_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    action: Literal["set_known", "set_ignored", "delete", "add_tag"]
    tag_name: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def _tag_required_for_add_tag(self) -> BulkActionRequest:
        if self.action == "add_tag" and self.tag_name is None:
            raise ValueError("tag_name required for add_tag")
        return self


class BulkActionResponse(BaseModel):
    affected: int
