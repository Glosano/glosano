"""Pydantic DTOs for the identity module (auth + me endpoints)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

SUPPORTED_LEARNING_LANGUAGES = frozenset({"en", "ru", "pt"})
SUPPORTED_UI_LANGUAGES = frozenset({"en", "ru"})


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = True


class OnboardingRequest(BaseModel):
    ui_language: str
    learning_languages: list[str] = Field(min_length=1)
    translation_language: str | None = None

    @field_validator("ui_language")
    @classmethod
    def _ui_language_supported(cls, v: str) -> str:
        if v not in SUPPORTED_UI_LANGUAGES:
            raise ValueError(f"unsupported UI language: {v}")
        return v

    @field_validator("learning_languages")
    @classmethod
    def _learning_languages_supported(cls, v: list[str]) -> list[str]:
        for code in v:
            if code not in SUPPORTED_LEARNING_LANGUAGES:
                raise ValueError(f"unsupported learning language: {code}")
        return list(dict.fromkeys(v))

    @field_validator("translation_language")
    @classmethod
    def _translation_language_supported(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_LEARNING_LANGUAGES:
            raise ValueError(f"unsupported translation language: {v}")
        return v


class DeleteMeRequest(BaseModel):
    password: str


class SetLastLanguageRequest(BaseModel):
    language_code: str

    @field_validator("language_code")
    @classmethod
    def _supported(cls, v: str) -> str:
        if v not in SUPPORTED_LEARNING_LANGUAGES:
            raise ValueError(f"unsupported language: {v}")
        return v


class MeResponse(BaseModel):
    id: uuid.UUID
    email: str
    role: Literal["learner", "admin"]
    display_name: str
    ui_language_code: str
    preferred_translation_language_code: str
    daily_goal_minutes: int
    daily_goal_reviews: int
    learning_languages: list[str]
    last_learning_language_code: str | None
    needs_onboarding: bool
    onboarded_at: datetime | None


class UpdateProfileRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name", mode="before")
    @classmethod
    def _trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class UpdatePreferencesRequest(BaseModel):
    ui_language: Literal["en", "ru"]
    learning_languages: list[Literal["en", "ru", "pt"]] = Field(min_length=1)
    daily_goal_minutes: int = Field(ge=1, le=1440, strict=True)
    daily_goal_reviews: int = Field(ge=1, le=10000, strict=True)

    @field_validator("learning_languages")
    @classmethod
    def _deduplicate(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=128)
