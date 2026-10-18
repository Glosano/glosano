"""Pydantic response models for dictionary lookup."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from glosano.core.languages import LearningLanguageCode


class DictionaryExampleOut(BaseModel):
    text: str
    translation: str | None


class DictionarySenseOut(BaseModel):
    sense_index: int
    translation: str
    usage_note: str | None
    examples: list[DictionaryExampleOut]


class DictionaryEntryOut(BaseModel):
    headword: str
    part_of_speech: str | None
    senses: list[DictionarySenseOut]


class AttributionOut(BaseModel):
    source: str
    license: str
    url: str


class DictionaryLookupResponse(BaseModel):
    availability: Literal["available", "not_installed"] = "available"
    entries: list[DictionaryEntryOut]
    attribution: AttributionOut


class ExternalDictionaryOut(BaseModel):
    ref: str  # "builtin:<id>" | "custom:<uuid>"
    kind: Literal["builtin", "custom"]
    name: str
    url_template: str  # only {word} left
    word_encoding: Literal["default", "no_slash"]
    custom_id: uuid.UUID | None
    all_languages: bool


class ExternalDictionariesOut(BaseModel):
    visible: list[ExternalDictionaryOut]
    available: list[ExternalDictionaryOut]


class CustomDictionaryIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    url_template: str  # raw; validated in the service
    all_languages: bool
    source_language_code: LearningLanguageCode
    target_language_code: LearningLanguageCode


class LayoutIn(BaseModel):
    visible: list[str] = Field(max_length=64)
