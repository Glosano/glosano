"""Bounded command inputs; extra source content is never trusted."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from glosano.core.languages import LearningLanguageCode

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
ExerciseKind = Literal["single_choice", "gap", "free_response"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CitationRequest(Input):
    lesson_id: uuid.UUID
    source_version: int = Field(ge=1)
    from_ordinal: int = Field(ge=0)
    to_ordinal: int = Field(ge=0)
    context: Literal["sentence", "paragraph"] = "paragraph"

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.to_ordinal < self.from_ordinal or self.to_ordinal - self.from_ordinal > 500:
            raise ValueError("invalid selection range")
        return self


class ParagraphCitationRequest(Input):
    lesson_id: uuid.UUID
    source_version: int = Field(ge=1)
    segment_id: uuid.UUID


class DraftWrite(Input):
    revision: int = Field(ge=0)
    text: str = Field(default="", max_length=16000)
    citation_ids: list[uuid.UUID] = Field(default_factory=list[uuid.UUID], max_length=8)
    exercise_id: uuid.UUID | None = None
    attempt_id: uuid.UUID | None = None
    answers: dict[uuid.UUID, Annotated[str, Field(max_length=4000)]] = Field(
        default_factory=dict[uuid.UUID, str], max_length=30
    )


class SendRequest(Input):
    operation_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    draft_revision: int = Field(ge=0)
    learning_language_code: LearningLanguageCode | None = None
    kind: Literal["reply", "exercise"] = "reply"
    exercise_kind: ExerciseKind | None = None

    @model_validator(mode="after")
    def exercise_type(self) -> Self:
        if self.conversation_id is None and self.learning_language_code is None:
            raise ValueError("learning_language_code required for a new conversation")
        if (self.kind == "exercise") != (self.exercise_kind is not None):
            raise ValueError("exercise_kind required only for exercise generation")
        return self


class RenameRequest(Input):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class AttemptRequest(Input):
    operation_id: uuid.UUID
    answer: ShortText


class EvaluationRequest(Input):
    operation_id: uuid.UUID


class Option(Input):
    id: Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_-]{1,40}$")]
    text: ShortText


class SingleChoice(Input):
    kind: Literal["single_choice"]
    prompt: ShortText
    options: list[Option] = Field(min_length=2, max_length=8)
    answer_id: str

    @model_validator(mode="after")
    def valid_key(self) -> Self:
        ids = [o.id for o in self.options]
        if len(set(ids)) != len(ids) or self.answer_id not in ids:
            raise ValueError("unique option IDs and one valid answer required")
        return self


class Gap(Input):
    kind: Literal["gap"]
    prompt: ShortText
    accepted_answers: list[ShortText] = Field(min_length=1, max_length=20)
    case_sensitive: bool = False

    @model_validator(mode="after")
    def one_gap(self) -> Self:
        if self.prompt.count("{{gap}}") != 1:
            raise ValueError("exactly one {{gap}} placeholder required")
        return self


class FreeResponse(Input):
    kind: Literal["free_response"]
    prompt: ShortText
    goal: ShortText
    rubric: ShortText
    model_answer: ShortText


ExerciseDefinition = Annotated[SingleChoice | Gap | FreeResponse, Field(discriminator="kind")]
