"""Supported learning language catalog (ADR-0012); UI languages remain EN/RU."""

from typing import Literal, get_args

LearningLanguageCode = Literal["en", "ru", "pt", "es", "fr", "de", "zh-Hans", "ja", "ar", "hi"]
SUPPORTED_LEARNING_LANGUAGES = frozenset(get_args(LearningLanguageCode))
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh-Hans": "Simplified Chinese",
    "ja": "Japanese",
    "ar": "Arabic",
    "hi": "Hindi",
}
